// ============================================================
//  SPLIT TOOL — Chia LineString tại giao điểm
//  Double-click vào vị trí giao nhau giữa 2 LineString
//  → đường được click bị chia thành 2 Feature tại điểm giao.
// ============================================================

(function () {
    'use strict';

    const DEBUG = false;
    function log(...args) { if (DEBUG) console.log('[Split]', ...args); }

    let olMap = null;
    let isActive = false;

    // Phase: 'select' (vẽ vùng) hoặc 'split' (double-click để cắt)
    let splitPhase = 'select';
    let _selectedExtent = null; // [minX, minY, maxX, maxY]
    let _cachedIntersections = []; // Cache để không tính lại mỗi mousemove
    let _splitPointCoords = [];    // Tọa độ các điểm đã split (để highlight xanh lá)

    // Overlay layer hiển thị các điểm giao nhau khi hover
    let highlightLayer = null;
    let highlightSource = null;

    // Listeners cần cleanup khi tắt tool
    let _pointermoveKey = null;

    // Tolerance (pixel) cho double-click snap vào intersection
    const CLICK_TOLERANCE = 10;

    // ==================== TÌM MAP ====================
    function findOlMap() {
        if (window.__findOlMap) return window.__findOlMap();
        const viewport = document.querySelector('.ol-viewport');
        if (!viewport) return null;
        let el = viewport.parentElement;
        while (el && el !== document.body) {
            const key = Object.keys(el).find(k => k.startsWith('__reactFiber'));
            if (key) {
                let node = el[key];
                for (let d = 0; d < 200 && node; d++) {
                    try {
                        let s = node.memoizedState;
                        while (s) {
                            if (s.queue === null && s.memoizedState?.current) {
                                const cur = s.memoizedState.current;
                                if (typeof cur?.getInteractions === 'function' && typeof cur?.getLayers === 'function') return cur;
                            }
                            s = s.next;
                        }
                    } catch (e) { }
                    node = node.return;
                }
                break;
            }
            el = el.parentElement;
        }
        return null;
    }

    // ==================== COLLECT ALL LINESTRINGS ====================
    // Thu thập feature LineString, lọc theo extent nếu có
    function collectLineStrings(extent) {
        const results = [];
        function walk(layer) {
            if (layer.getLayers) { layer.getLayers().forEach(walk); return; }
            try {
                const src = layer.getSource?.();
                if (!src?.getFeatures) return;
                // Dùng getFeaturesInExtent nếu có extent
                const features = extent && src.getFeaturesInExtent
                    ? src.getFeaturesInExtent(extent)
                    : src.getFeatures();
                for (const f of features) {
                    const geom = f.getGeometry?.();
                    if (geom && geom.getType() === 'LineString') {
                        // Kiểm tra thêm: geometry có giao với extent?
                        if (extent) {
                            const ge = geom.getExtent();
                            if (ge[2] < extent[0] || ge[0] > extent[2] ||
                                ge[3] < extent[1] || ge[1] > extent[3]) continue;
                        }
                        results.push({ feature: f, source: src, layer });
                    }
                }
            } catch (e) { }
        }
        try { olMap.getLayers().forEach(walk); } catch (e) { }
        return results;
    }

    // ==================== SEGMENT INTERSECTION ====================
    // Tính giao điểm 2 đoạn thẳng p1-p2 và p3-p4
    // Trả về [x, y] hoặc null nếu không giao
    function segmentIntersection(p1, p2, p3, p4) {
        const dx1 = p2[0] - p1[0];
        const dy1 = p2[1] - p1[1];
        const dx2 = p4[0] - p3[0];
        const dy2 = p4[1] - p3[1];

        const denom = dx1 * dy2 - dy1 * dx2;

        // Chuẩn hóa denom theo độ dài các segment để tránh sai số với tọa độ lớn
        const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
        const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
        const scale = len1 * len2;
        if (scale < 1e-20) return null; // segment suy biến
        if (Math.abs(denom) / scale < 1e-10) return null; // song song

        const dx3 = p3[0] - p1[0];
        const dy3 = p3[1] - p1[1];

        const t = (dx3 * dy2 - dy3 * dx2) / denom;
        const u = (dx3 * dy1 - dy3 * dx1) / denom;

        // Chỉ giao khi cả 2 param nằm trong [0, 1]
        // Tolerance rộng hơn để bắt được giao điểm sát đầu mút
        const EPS = 1e-6;
        if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;

        // Clamp về [0, 1] để tránh tọa độ nằm ngoài segment
        const tc = Math.max(0, Math.min(1, t));

        return [
            p1[0] + tc * dx1,
            p1[1] + tc * dy1
        ];
    }

    // ==================== FIND INTERSECTIONS ====================
    // Tìm tất cả giao điểm giữa feature A và các LineString khác trên map
    function findIntersections(targetFeature) {
        const targetCoords = targetFeature.getGeometry().getCoordinates();
        const allLines = collectLineStrings();
        const intersections = [];

        for (const { feature: otherFeature } of allLines) {
            if (otherFeature === targetFeature) continue;

            const otherCoords = otherFeature.getGeometry().getCoordinates();

            // Kiểm tra từng cặp segment
            for (let i = 0; i < targetCoords.length - 1; i++) {
                for (let j = 0; j < otherCoords.length - 1; j++) {
                    const pt = segmentIntersection(
                        targetCoords[i], targetCoords[i + 1],
                        otherCoords[j], otherCoords[j + 1]
                    );
                    if (pt) {
                        intersections.push(pt);
                    }
                }
            }
        }

        return intersections;
    }

    // ==================== FIND ALL INTERSECTIONS ====================
    // Tìm giao điểm giữa các LineString trong extent
    function findAllIntersections(extent) {
        const allLines = collectLineStrings(extent);
        const intersections = [];

        log('Scanning', allLines.length, 'LineStrings in extent');

        const DEDUP_DIST = 1e-8;
        function isDuplicate(pt) {
            for (let k = 0; k < intersections.length; k++) {
                const dx = intersections[k][0] - pt[0];
                const dy = intersections[k][1] - pt[1];
                if (dx * dx + dy * dy < DEDUP_DIST * DEDUP_DIST) return true;
            }
            return false;
        }

        for (let a = 0; a < allLines.length; a++) {
            const coordsA = allLines[a].feature.getGeometry().getCoordinates();
            for (let b = a + 1; b < allLines.length; b++) {
                const coordsB = allLines[b].feature.getGeometry().getCoordinates();

                for (let i = 0; i < coordsA.length - 1; i++) {
                    for (let j = 0; j < coordsB.length - 1; j++) {
                        const pt = segmentIntersection(
                            coordsA[i], coordsA[i + 1],
                            coordsB[j], coordsB[j + 1]
                        );
                        if (pt && !isDuplicate(pt)) {
                            // Lọc: giao điểm phải nằm trong extent
                            if (extent) {
                                if (pt[0] < extent[0] || pt[0] > extent[2] ||
                                    pt[1] < extent[1] || pt[1] > extent[3]) continue;
                            }
                            intersections.push(pt);
                        }
                    }
                }
            }
        }

        console.log('[Split] Found', intersections.length, 'intersections in selected area (' + allLines.length + ' lines)');
        return intersections;
    }

    // ==================== FIND SPLIT POINT ====================
    // Tìm giao điểm gần nhất với vị trí click (trong tolerance)
    function findSplitPoint(clickCoord, feature) {
        const intersections = findIntersections(feature);
        if (intersections.length === 0) return null;

        let bestPt = null;
        let bestDist = Infinity;

        for (const pt of intersections) {
            const dx = pt[0] - clickCoord[0];
            const dy = pt[1] - clickCoord[1];
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < bestDist) {
                bestDist = dist;
                bestPt = pt;
            }
        }

        // Chuyển tolerance từ pixel sang map units
        const view = olMap.getView();
        const resolution = view.getResolution();
        const toleranceMap = CLICK_TOLERANCE * resolution;

        if (bestDist > toleranceMap) return null;

        return bestPt;
    }

    // ==================== INSERT VERTEX IF NEEDED ====================
    // Nếu splitPoint chưa là vertex hiện có → chèn vào đúng segment
    // Trả về index của vertex tại splitPoint
    function insertVertexIfNeeded(coords, splitPoint) {
        const EPS = 1e-9;

        // Kiểm tra xem splitPoint đã là vertex chưa
        for (let i = 0; i < coords.length; i++) {
            if (Math.abs(coords[i][0] - splitPoint[0]) < EPS &&
                Math.abs(coords[i][1] - splitPoint[1]) < EPS) {
                return i;
            }
        }

        // Tìm segment chứa splitPoint
        for (let i = 0; i < coords.length - 1; i++) {
            const p1 = coords[i];
            const p2 = coords[i + 1];

            // Kiểm tra splitPoint có nằm trên segment p1-p2 không
            const dx = p2[0] - p1[0];
            const dy = p2[1] - p1[1];
            const lenSq = dx * dx + dy * dy;
            if (lenSq < EPS) continue;

            // Project splitPoint lên đoạn thẳng
            const t = ((splitPoint[0] - p1[0]) * dx + (splitPoint[1] - p1[1]) * dy) / lenSq;
            if (t < -0.01 || t > 1.01) continue;

            // Kiểm tra khoảng cách từ splitPoint đến đường thẳng
            const projX = p1[0] + t * dx;
            const projY = p1[1] + t * dy;
            const distSq = (splitPoint[0] - projX) ** 2 + (splitPoint[1] - projY) ** 2;

            if (distSq < 1e-6) {
                // Chèn vertex mới vào giữa segment
                coords.splice(i + 1, 0, [splitPoint[0], splitPoint[1]]);
                return i + 1;
            }
        }

        return -1; // không tìm được segment (lỗi)
    }

    // ==================== SPLIT LINE ====================
    // Chia mảng coordinates thành 2 phần tại splitIndex
    // Phần 1: coords[0..splitIndex]
    // Phần 2: coords[splitIndex..end]
    function splitLine(coords, splitIndex) {
        if (splitIndex <= 0 || splitIndex >= coords.length - 1) {
            return null; // không split đầu hoặc cuối
        }

        const part1 = coords.slice(0, splitIndex + 1);
        const part2 = coords.slice(splitIndex);

        // Đảm bảo mỗi phần có ít nhất 2 điểm
        if (part1.length < 2 || part2.length < 2) return null;

        return [part1, part2];
    }

    // ==================== REPLACE FEATURE (DOM-SYNC) ====================
    // Xóa feature cũ qua DOM + Import features mới qua GeoJSON
    // → React biết và cập nhật panel "Biên tập dữ liệu"

    function findGeoJSONInput() {
        return document.querySelector('input[accept*=".geojson"]')
            || document.querySelector('input[accept*="geojson"]')
            || document.querySelector('input[accept*=".json"]')
            || document.querySelector('input[accept*="geo+json"]')
            || document.querySelector('input[type="file"][accept]');
    }

    function importFeaturesViaGeoJSON(coordsList) {
        const features = coordsList.map(function (coords, i) {
            return {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: coords },
                properties: null
            };
        });

        const geojson = {
            type: 'FeatureCollection',
            features: features
        };

        const input = findGeoJSONInput();
        if (!input) {
            console.warn('[Split] GeoJSON input not found, cannot import to DOM');
            return false;
        }

        const blob = new Blob([JSON.stringify(geojson)], { type: 'application/geo+json' });
        const file = new File([blob], 'split.geojson', { type: 'application/geo+json' });
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));

        console.log('[Split] Imported', features.length, 'features via GeoJSON');
        return true;
    }

    function replaceFeature(oldFeature, newCoordsList, source) {
        const oldId = oldFeature.getId?.();
        const oldProps = oldFeature.getProperties();
        delete oldProps.geometry;

        // Lưu original coords TRƯỚC khi thao tác
        const originalCoords = oldFeature.getGeometry().getCoordinates().map(function (c) { return [c[0], c[1]]; });

        const undoEntry = {
            action: 'split',
            originalFeatureId: oldId,
            originalCoords: originalCoords,
            originalProperties: { ...oldProps },
            newFeatureIds: []
        };

        console.log('[Split] Before: source has', source.getFeatures().length, 'features');

        // === Bước 1: Xóa feature cũ qua DOM (React sync) ===
        let deletedByDOM = false;
        if (oldId && window.__deleteFeatureByDOM) {
            deletedByDOM = window.__deleteFeatureByDOM(oldId);
            console.log('[Split] Delete via DOM:', deletedByDOM ? 'OK' : 'FAILED');
        }

        // Fallback: xóa trực tiếp từ source
        if (!deletedByDOM) {
            try {
                source.removeFeature(oldFeature);
                console.log('[Split] Removed via OL source (fallback)');
            } catch (e) {
                console.error('[Split] Error removing feature:', e);
                return false;
            }
        }

        // === Bước 2: Import features mới qua GeoJSON (React sync) ===
        // Chờ DOM xử lý xóa xong rồi mới import
        const coordsToImport = newCoordsList.map(function (coords) {
            return coords.map(function (c) { return [c[0], c[1]]; });
        });

        setTimeout(function () {
            const imported = importFeaturesViaGeoJSON(coordsToImport);

            if (!imported) {
                // Fallback: thêm trực tiếp vào source
                console.log('[Split] Fallback: adding features directly to source');
                for (let i = 0; i < newCoordsList.length; i++) {
                    const newFeature = oldFeature.clone();
                    const newGeom = newFeature.getGeometry().clone();
                    newGeom.setCoordinates(newCoordsList[i]);
                    newFeature.setGeometry(newGeom);

                    const newId = oldId
                        ? oldId + '_split_' + i + '_' + Date.now()
                        : 'split_' + Date.now() + '_' + i;
                    newFeature.setId(newId);
                    undoEntry.newFeatureIds.push(newId);

                    source.addFeature(newFeature);
                }
            }

            console.log('[Split] After: source has', source.getFeatures().length, 'features');
        }, 300); // 300ms cho DOM xử lý xóa

        // Push undo
        if (window.__undoStack) {
            undoEntry._source = source;
            window.__undoStack.push(undoEntry);
        }

        return true;
    }

    // ==================== HOVER PREVIEW ====================
    // Khi di chuột gần giao điểm, highlight đường sẽ bị cắt
    let _previewFeature = null;       // Feature đang được highlight
    let _previewSource = null;
    let _previewOriginalStyle = null; // Style gốc để restore
    let _domMousemoveHandler = null;

    // Tính khoảng cách vuông góc từ điểm P đến đoạn thẳng AB
    function perpendicularDistance(p, a, b) {
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const lenSq = dx * dx + dy * dy;
        if (lenSq < 1e-12) {
            // Đoạn thẳng suy biến thành điểm
            return Math.sqrt((p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2);
        }
        // Khoảng cách = |cross product| / |AB|
        const cross = Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx);
        return cross / Math.sqrt(lenSq);
    }

    // Tìm khoảng cách vuông góc nhỏ nhất từ P đến LineString
    function minPerpendicularDist(p, coords) {
        let minDist = Infinity;
        for (let i = 0; i < coords.length - 1; i++) {
            const d = perpendicularDistance(p, coords[i], coords[i + 1]);
            if (d < minDist) minDist = d;
        }
        return minDist;
    }

    // Tìm đường gần chuột nhất dựa trên khoảng cách vuông góc
    function findTargetLineAtPoint(mouseCoord) {
        const allLines = collectLineStrings();
        const view = olMap.getView();
        const resolution = view.getResolution();
        const toleranceMap = CLICK_TOLERANCE * 2 * resolution;

        let bestFeature = null;
        let bestSource = null;
        let bestDist = Infinity;

        for (const { feature, source } of allLines) {
            const coords = feature.getGeometry().getCoordinates();
            const dist = minPerpendicularDist(mouseCoord, coords);

            if (dist < toleranceMap && dist < bestDist) {
                bestDist = dist;
                bestFeature = feature;
                bestSource = source;
            }
        }

        return bestFeature ? { feature: bestFeature, source: bestSource } : null;
    }

    function setPreview(feature, source) {
        if (_previewFeature === feature) return; // không đổi
        clearPreview();

        if (!feature) return;

        _previewFeature = feature;
        _previewSource = source;
        _previewOriginalStyle = feature.getStyle?.() || null;

        // Highlight bằng style nổi bật
        const baseStyle = _previewOriginalStyle || feature.get('__layerStyle') || null;
        try {
            // Tạo style highlight: đường dày hơn, màu cyan
            const layer = _previewSource ? null : null;
            // Dùng cách đơn giản: set style function
            feature.setStyle(function (f, res) {
                // Lấy style gốc từ layer
                let styles = [];
                if (typeof baseStyle === 'function') {
                    const r = baseStyle(f, res);
                    styles = Array.isArray(r) ? r : (r ? [r] : []);
                } else if (baseStyle) {
                    styles = Array.isArray(baseStyle) ? baseStyle : [baseStyle];
                }

                // Nếu không có style gốc, thử lấy từ layer
                if (styles.length === 0) {
                    const allL = collectLineStrings();
                    for (const entry of allL) {
                        if (entry.feature === f) {
                            const layerStyle = entry.layer?.getStyle?.();
                            if (typeof layerStyle === 'function') {
                                const r = layerStyle(f, res);
                                styles = Array.isArray(r) ? r : (r ? [r] : []);
                            } else if (layerStyle) {
                                styles = Array.isArray(layerStyle) ? layerStyle : [layerStyle];
                            }
                            break;
                        }
                    }
                }

                if (styles.length === 0) return null;

                return styles.map(function (s) {
                    try {
                        const cloned = s.clone();
                        const stroke = cloned.getStroke?.();
                        if (stroke) {
                            // Check nếu feature đi qua điểm đã split → xanh lá
                            var isSplitResult = false;
                            if (_splitPointCoords.length > 0) {
                                try {
                                    var fCoords = f.getGeometry().getCoordinates();
                                    outer: for (var si = 0; si < _splitPointCoords.length; si++) {
                                        var sp = _splitPointCoords[si];
                                        for (var ci = 0; ci < fCoords.length; ci++) {
                                            var ddx = fCoords[ci][0] - sp[0];
                                            var ddy = fCoords[ci][1] - sp[1];
                                            if (ddx * ddx + ddy * ddy < 4) {
                                                isSplitResult = true;
                                                break outer;
                                            }
                                        }
                                    }
                                } catch(e) {}
                            }
                            stroke.setColor(isSplitResult ? 'rgba(0, 200, 80, 0.9)' : 'rgba(0, 200, 255, 0.9)');
                            stroke.setWidth((s.getStroke?.()?.getWidth?.() || 2) + 3);
                        }
                        return cloned;
                    } catch (e) { return s; }
                });
            });
        } catch (e) {
            log('Preview style error:', e);
        }

        olMap.render();
    }

    function clearPreview() {
        if (_previewFeature) {
            try {
                _previewFeature.setStyle(_previewOriginalStyle);
            } catch (e) { }
            olMap.render();
        }
        _previewFeature = null;
        _previewSource = null;
        _previewOriginalStyle = null;
    }

    // ==================== BOX SELECTION ====================
    let _boxStart = null;       // Pixel [x, y] khi mousedown
    let _boxDrawing = false;
    let _boxRectEl = null;      // DOM element hình chữ nhật
    let _domMouseupHandler = null;
    let _domPointerdownHandler = null;
    let _domPointermoveHandler = null;

    function createBoxRect() {
        if (_boxRectEl) return _boxRectEl;
        _boxRectEl = document.createElement('div');
        _boxRectEl.style.cssText =
            'position: fixed; border: 2px dashed rgba(0, 200, 255, 0.8);' +
            'background: rgba(0, 200, 255, 0.1); pointer-events: none;' +
            'z-index: 9999; display: none;';
        document.body.appendChild(_boxRectEl);
        return _boxRectEl;
    }

    function updateBoxRect(startX, startY, endX, endY) {
        const rect = createBoxRect();
        const x = Math.min(startX, endX);
        const y = Math.min(startY, endY);
        const w = Math.abs(endX - startX);
        const h = Math.abs(endY - startY);
        rect.style.left = x + 'px';
        rect.style.top = y + 'px';
        rect.style.width = w + 'px';
        rect.style.height = h + 'px';
        rect.style.display = 'block';
    }

    function hideBoxRect() {
        if (_boxRectEl) _boxRectEl.style.display = 'none';
    }

    function removeBoxRect() {
        if (_boxRectEl) { _boxRectEl.remove(); _boxRectEl = null; }
    }

    // Pointer events — OL dùng pointer events nội bộ
    function handlePointerdown(e) {
        if (!isActive) return;
        if (!e.shiftKey) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        if (e.button === 0) {
            _boxStart = [e.clientX, e.clientY];
            _boxDrawing = true;
            console.log('[Split] Shift+pointerdown — box started');
        }
    }

    // pointermove: vẽ box khi đang kéo (mousemove bị suppress do preventDefault trên pointerdown)
    function handlePointermove(e) {
        if (!isActive || !_boxDrawing || !_boxStart) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        updateBoxRect(_boxStart[0], _boxStart[1], e.clientX, e.clientY);
    }

    function handlePointerup(e) {
        if (!isActive || !_boxDrawing || !_boxStart) return;
        console.log('[Split] pointerup — box selection ended');
        _boxDrawing = false;
        hideBoxRect();

        const dx = Math.abs(e.clientX - _boxStart[0]);
        const dy = Math.abs(e.clientY - _boxStart[1]);

        // Chỉ xử lý nếu kéo đủ lớn (> 20px)
        if (dx < 20 && dy < 20) {
            _boxStart = null;
            return;
        }

        // Tính extent từ pixel → map coordinate
        const viewport = document.querySelector('.ol-viewport');
        if (!viewport) return;
        const rect = viewport.getBoundingClientRect();

        const p1 = [_boxStart[0] - rect.left, _boxStart[1] - rect.top];
        const p2 = [e.clientX - rect.left, e.clientY - rect.top];

        const c1 = olMap.getCoordinateFromPixel(p1);
        const c2 = olMap.getCoordinateFromPixel(p2);
        if (!c1 || !c2) return;

        _selectedExtent = [
            Math.min(c1[0], c2[0]),
            Math.min(c1[1], c2[1]),
            Math.max(c1[0], c2[0]),
            Math.max(c1[1], c2[1])
        ];

        _boxStart = null;

        // Chuyển sang phase split
        enterSplitPhase();
    }

    function enterSplitPhase() {
        splitPhase = 'split';

        // Tìm giao điểm trong vùng chọn
        clearMarkers();
        _cachedIntersections = findAllIntersections(_selectedExtent);

        for (var i = 0; i < _cachedIntersections.length; i++) {
            createIntersectionMarker(_cachedIntersections[i]);
        }

        if (_cachedIntersections.length === 0) {
            showSplitToast('Kh\u00f4ng t\u00ecm th\u1ea5y giao \u0111i\u1ec3m trong v\u00f9ng ch\u1ecdn. Shift+k\u00e9o l\u1ea1i \u0111\u1ec3 ch\u1ecdn v\u00f9ng kh\u00e1c.', 'info');
        } else {
            showSplitToast('\u2702 T\u00ecm th\u1ea5y ' + _cachedIntersections.length + ' giao \u0111i\u1ec3m. Double-click \u0111\u1ec3 chia. Shift+k\u00e9o l\u1ea1i \u0111\u1ec3 ch\u1ecdn v\u00f9ng kh\u00e1c.', 'info');
        }
    }

    // Mousemove: hover preview khi đã chọn vùng
    function handleMousemovePreview(e) {
        if (!isActive || !olMap) return;

        // Bỏ qua khi đang kéo box (pointermove xử lý)
        if (_boxDrawing) return;

        // Phase: split — hover preview
        if (splitPhase !== 'split' || _cachedIntersections.length === 0) {
            clearPreview();
            return;
        }

        const viewport = document.querySelector('.ol-viewport');
        if (!viewport) return;

        const rect = viewport.getBoundingClientRect();
        const pixel = [e.clientX - rect.left, e.clientY - rect.top];
        const coord = olMap.getCoordinateFromPixel(pixel);
        if (!coord) return;

        // Tìm giao điểm gần chuột nhất (dùng cache)
        const view = olMap.getView();
        const resolution = view.getResolution();
        const toleranceMap = CLICK_TOLERANCE * 2 * resolution;

        let nearestIntersection = null;
        let nearestDist = Infinity;

        for (const pt of _cachedIntersections) {
            const dx = pt[0] - coord[0];
            const dy = pt[1] - coord[1];
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < toleranceMap && dist < nearestDist) {
                nearestDist = dist;
                nearestIntersection = pt;
            }
        }

        if (!nearestIntersection) {
            clearPreview();
            return;
        }

        // Tìm đường gần chuột nhất
        const target = findTargetLineAtPoint(coord);
        if (target) {
            setPreview(target.feature, target.source);
        } else {
            clearPreview();
        }
    }

    // ==================== HANDLE SPLIT ====================
    // Handler chính cho double-click
    function handleSplit(evt) {
        if (!isActive) return;

        const clickCoord = evt.coordinate;
        log('Double-click at', clickCoord);

        // Ưu tiên dùng đường đang preview (đã xác định bởi hover)
        let targetFeature = _previewFeature;
        let targetSource = _previewSource;

        // Fallback: tìm bằng khoảng cách vuông góc
        if (!targetFeature) {
            const target = findTargetLineAtPoint(clickCoord);
            if (target) {
                targetFeature = target.feature;
                targetSource = target.source;
            }
        }

        if (!targetFeature) {
            log('No LineString found near click');
            return;
        }

        console.log('[Split] Target line:', targetFeature.getId?.() || '(no id)');

        // Clear preview trước khi split
        clearPreview();

        // Tìm split point (giao điểm gần nhất trên đường target)
        const splitPoint = findSplitPoint(clickCoord, targetFeature);
        if (!splitPoint) {
            log('No intersection found near click on this feature');
            showSplitToast('Kh\u00f4ng t\u00ecm th\u1ea5y giao \u0111i\u1ec3m t\u1ea1i v\u1ecb tr\u00ed n\u00e0y', 'info');
            return;
        }

        // Clone coordinates
        const coords = targetFeature.getGeometry().getCoordinates().map(function (c) { return [c[0], c[1]]; });

        // Chèn vertex nếu cần
        const splitIndex = insertVertexIfNeeded(coords, splitPoint);
        if (splitIndex < 0) {
            log('Failed to insert vertex');
            showSplitToast('L\u1ed7i: kh\u00f4ng th\u1ec3 ch\u00e8n \u0111i\u1ec3m c\u1eaft', 'error');
            return;
        }

        // Không split đầu hoặc cuối
        if (splitIndex === 0 || splitIndex === coords.length - 1) {
            log('Cannot split at start or end of line');
            showSplitToast('Kh\u00f4ng th\u1ec3 c\u1eaft t\u1ea1i \u0111\u1ea7u ho\u1eb7c cu\u1ed1i \u0111\u01b0\u1eddng', 'info');
            return;
        }

        // Split
        const parts = splitLine(coords, splitIndex);
        if (!parts) {
            log('Split failed');
            showSplitToast('L\u1ed7i: kh\u00f4ng th\u1ec3 chia \u0111\u01b0\u1eddng', 'error');
            return;
        }

        // Replace
        const success = replaceFeature(targetFeature, parts, targetSource);
        if (success) {
            olMap.render();
            showSplitToast('\u2702 \u0110\u00e3 chia \u0111\u01b0\u1eddng th\u00e0nh ' + parts.length + ' ph\u1ea7n', 'success');
            console.log('[Split] \u2705 Split into', parts.length, 'parts');

            // GIỮ marker — đường còn lại vẫn cần split tại điểm này

            // Lưu splitPoint để highlight xanh lá khi hover
            _splitPointCoords.push([splitPoint[0], splitPoint[1]]);

            // Th\u00f4ng b\u00e1o cho autosave
            document.dispatchEvent(new CustomEvent('3dg:features-changed'));
        }
    }

    // ==================== INTERSECTION HIGHLIGHT ====================
    // Hiển thị các điểm giao nhau trên map khi tool active

    function createHighlightLayer() {
        if (highlightLayer) return;

        // Tạo vector source + layer cho highlight dots
        // Dùng OL classes từ global (injected bởi website)
        try {
            // Truy cập OL classes qua map instance
            const existingLayers = olMap.getLayers().getArray();
            let VectorLayer = null;
            let VectorSource = null;
            let Style = null;
            let CircleStyle = null;
            let Fill = null;
            let Stroke = null;

            // Tìm constructor từ existing layers
            for (const layer of existingLayers) {
                if (layer.getSource?.()?.getFeatures && !VectorLayer) {
                    VectorLayer = layer.constructor;
                    VectorSource = layer.getSource().constructor;

                    // Tìm Style classes từ layer style
                    const layerStyle = layer.getStyle?.();
                    if (typeof layerStyle === 'function') {
                        // Thử lấy style constructor
                        try {
                            const features = layer.getSource().getFeatures();
                            if (features.length > 0) {
                                const styles = layerStyle(features[0], olMap.getView().getResolution());
                                const arr = Array.isArray(styles) ? styles : [styles];
                                if (arr[0]) {
                                    Style = arr[0].constructor;
                                    if (arr[0].getFill?.()) Fill = arr[0].getFill().constructor;
                                    if (arr[0].getStroke?.()) Stroke = arr[0].getStroke().constructor;
                                    if (arr[0].getImage?.()) CircleStyle = arr[0].getImage().constructor;
                                }
                            }
                        } catch (e) { }
                    }
                    break;
                }
            }

            if (!VectorLayer || !VectorSource) {
                log('Cannot find OL VectorLayer/VectorSource constructors');
                return;
            }

            highlightSource = new VectorSource();
            highlightLayer = new VectorLayer({
                source: highlightSource,
                zIndex: 9999
            });

            // Set style cho highlight points
            if (Style && Fill && Stroke) {
                try {
                    highlightLayer.setStyle(new Style({
                        image: new CircleStyle({
                            radius: 6,
                            fill: new Fill({ color: 'rgba(255, 80, 0, 0.8)' }),
                            stroke: new Stroke({ color: '#fff', width: 2 })
                        })
                    }));
                } catch (e) {
                    log('Failed to set highlight style, using default');
                }
            }

            olMap.addLayer(highlightLayer);
            log('Highlight layer created');

        } catch (e) {
            console.error('[Split] Error creating highlight layer:', e);
        }
    }

    function removeHighlightLayer() {
        if (highlightLayer) {
            try { olMap.removeLayer(highlightLayer); } catch (e) { }
            highlightLayer = null;
            highlightSource = null;
        }
    }

    function updateIntersectionHighlight() {
        if (!highlightSource) return;

        highlightSource.clear();

        const intersections = findAllIntersections();
        if (intersections.length === 0) return;

        // Tạo point features cho mỗi giao điểm
        // Cần tìm OL Point geometry constructor
        try {
            const allLines = collectLineStrings();
            if (allLines.length === 0) return;

            // Lấy geometry constructor từ existing feature
            const sampleGeom = allLines[0].feature.getGeometry();
            const sampleFeature = allLines[0].feature;

            for (const pt of intersections) {
                // Clone feature và đổi geometry thành Point
                const pointFeature = sampleFeature.clone();
                // Tạo Point geometry
                const pointGeom = sampleGeom.clone();

                // Thử set type = Point bằng cách dùng setCoordinates với tọa độ đơn
                // OpenLayers Point geometry khác LineString, cần tìm cách khác

                // Fallback: dùng overlay element thay vì feature
                // Tạo DOM element cho mỗi intersection point
                createIntersectionMarker(pt);
            }
        } catch (e) {
            log('Error updating highlight:', e);
        }
    }

    // Sử dụng DOM overlay markers trong container riêng
    // (KHÔNG đặt trong .ol-viewport để tránh bị React xóa khi re-render)
    let _markerElements = [];
    let _markerContainer = null;

    function getMarkerContainer() {
        if (_markerContainer && _markerContainer.parentNode) return _markerContainer;

        const viewport = document.querySelector('.ol-viewport');
        if (!viewport) return null;

        // Tạo container nằm NGOÀI .ol-viewport nhưng overlay lên map
        const mapEl = viewport.parentElement || viewport;
        _markerContainer = document.createElement('div');
        _markerContainer.id = '__3dg-split-markers';
        _markerContainer.style.cssText =
            'position: absolute; top: 0; left: 0; width: 100%; height: 100%;' +
            'pointer-events: none; z-index: 5; overflow: hidden;';

        // Đảm bảo parent có position relative
        if (getComputedStyle(mapEl).position === 'static') {
            mapEl.style.position = 'relative';
        }
        mapEl.appendChild(_markerContainer);

        return _markerContainer;
    }

    function createIntersectionMarker(coord) {
        const pixel = olMap.getPixelFromCoordinate(coord);
        if (!pixel) return;

        const container = getMarkerContainer();
        if (!container) return;

        const marker = document.createElement('div');
        marker.className = '__3dg-split-marker';
        marker.style.cssText =
            'position: absolute;' +
            'width: 12px; height: 12px;' +
            'border-radius: 50%;' +
            'background: rgba(255, 80, 0, 0.8);' +
            'border: 2px solid #fff;' +
            'box-shadow: 0 0 6px rgba(255, 80, 0, 0.5);' +
            'pointer-events: none;' +
            'z-index: 10;' +
            'transform: translate(-50%, -50%);' +
            'left: ' + pixel[0] + 'px;' +
            'top: ' + pixel[1] + 'px;';

        // Lưu coordinate để update vị trí khi pan/zoom
        marker.__coord = coord;
        container.appendChild(marker);
        _markerElements.push(marker);
    }

    function updateMarkerPositions() {
        for (const marker of _markerElements) {
            const pixel = olMap.getPixelFromCoordinate(marker.__coord);
            if (pixel) {
                marker.style.left = pixel[0] + 'px';
                marker.style.top = pixel[1] + 'px';
            }
        }
    }

    function clearMarkers() {
        for (const marker of _markerElements) {
            marker.remove();
        }
        _markerElements = [];
    }

    // Xóa 1 marker tại tọa độ cụ thể
    function removeMarkerAt(coord) {
        var MATCH_DIST = 2; // map units
        for (var i = _markerElements.length - 1; i >= 0; i--) {
            var mc = _markerElements[i].__coord;
            var dx = mc[0] - coord[0];
            var dy = mc[1] - coord[1];
            if (dx * dx + dy * dy < MATCH_DIST * MATCH_DIST) {
                _markerElements[i].remove();
                _markerElements.splice(i, 1);
                console.log('[Split] Removed marker at', coord);
                return;
            }
        }
    }

    // Refresh nhẹ nhàng: so sánh markers hiện tại với intersections mới
    // Giữ markers cũ, chỉ thêm mới / xóa thừa
    function refreshMarkers() {
        if (!isActive || !olMap) return;

        var newIntersections = findAllIntersections(_selectedExtent);
        _cachedIntersections = newIntersections; // Update cache
        var MATCH_DIST = 1;

        // Tìm markers cần xóa
        for (var i = _markerElements.length - 1; i >= 0; i--) {
            var marker = _markerElements[i];
            var mc = marker.__coord;
            var found = false;
            for (var k = 0; k < newIntersections.length; k++) {
                var dx = mc[0] - newIntersections[k][0];
                var dy = mc[1] - newIntersections[k][1];
                if (dx * dx + dy * dy < MATCH_DIST * MATCH_DIST) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                marker.remove();
                _markerElements.splice(i, 1);
            }
        }

        // Thêm markers mới
        for (var j = 0; j < newIntersections.length; j++) {
            var pt = newIntersections[j];
            var exists = false;
            for (var m = 0; m < _markerElements.length; m++) {
                var mc2 = _markerElements[m].__coord;
                var dx2 = mc2[0] - pt[0];
                var dy2 = mc2[1] - pt[1];
                if (dx2 * dx2 + dy2 * dy2 < MATCH_DIST * MATCH_DIST) {
                    exists = true;
                    break;
                }
            }
            if (!exists) {
                createIntersectionMarker(pt);
            }
        }

        updateMarkerPositions();
    }

    // ==================== TOAST ====================
    function showSplitToast(msg, type) {
        // Reuse selection toast system nếu có
        const container = document.getElementById('sel-toast-container');
        if (container) {
            const toast = document.createElement('div');
            toast.className = 'sel-toast ' + type;
            toast.textContent = msg;
            container.appendChild(toast);
            toast.addEventListener('animationend', (e) => {
                if (e.animationName === 'sel-toast-out') toast.remove();
            });
            return;
        }
        // Fallback: console
        console.log('[Split]', msg);
    }

    // ==================== INJECT CSS ====================
    function injectSplitStyles() {
        const STYLE_ID = '__3dg-split-style';
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .ol-viewport.__split-mode { cursor: crosshair !important; }
            .ol-viewport.__split-mode * { cursor: crosshair !important; }
        `;
        document.head.appendChild(style);
    }

    // ==================== ACTIVATE / DEACTIVATE ====================

    let _domDblclickHandler = null;
    let _domClickBlocker = null;
    let _disableDrawInterval = null;

    // Chặn dblclick ở tầng DOM (capture phase) TRƯỚC khi OL nhận được
    function domDblclickHandler(e) {
        if (!isActive) return;

        // Chặn event lan tới OL → không finishDrawing / zoom
        e.stopImmediatePropagation();
        e.preventDefault();

        // Chỉ split khi đã chọn vùng
        if (splitPhase !== 'split') return;

        // Tính toán coordinate từ pixel
        var viewport = document.querySelector('.ol-viewport');
        if (!viewport) return;

        var rect = viewport.getBoundingClientRect();
        var pixel = [e.clientX - rect.left, e.clientY - rect.top];
        var coordinate = olMap.getCoordinateFromPixel(pixel);
        if (!coordinate) return;

        // Gọi handleSplit với evt giả lập
        handleSplit({
            coordinate: coordinate,
            pixel: pixel,
            preventDefault: function () { },
            stopPropagation: function () { }
        });
    }

    // Chặn click thứ 2 của double-click (ngăn OL thêm vertex)
    let _lastClickTime = 0;
    function domClickBlocker(e) {
        if (!isActive) return;
        const now = Date.now();
        if (now - _lastClickTime < 400) {
            // Click thứ 2 trong khoảng dblclick → chặn
            e.stopImmediatePropagation();
            e.preventDefault();
        }
        _lastClickTime = now;
    }

    // Vô hiệu hóa Draw/DragBox/Select interactions (gọi định kỳ vì React re-create)
    function disableDrawInteractions() {
        try {
            olMap.getInteractions().forEach(function (interaction) {
                var name = interaction.constructor.name || '';

                // DoubleClickZoom
                if (name === 'DoubleClickZoom' || name.includes('DoubleClick')) {
                    if (interaction.getActive()) {
                        interaction.__splitDisabled = true;
                        interaction.setActive(false);
                    }
                }

                // Draw interactions
                if (typeof interaction.removeLastPoint === 'function' &&
                    typeof interaction.finishDrawing === 'function') {
                    if (interaction.getActive()) {
                        interaction.__splitDisabled = true;
                        interaction.setActive(false);
                    }
                }

                // DragBox (Shift+drag selection box)
                if (name === 'DragBox' || name.includes('DragBox') ||
                    (typeof interaction.getGeometry === 'function' && name !== 'Draw')) {
                    if (interaction.getActive()) {
                        interaction.__splitDisabled = true;
                        interaction.setActive(false);
                    }
                }

                // Select interaction
                if (name === 'Select' || name.includes('Select') ||
                    (typeof interaction.getFeatures === 'function' && typeof interaction.getStyle === 'function')) {
                    if (interaction.getActive()) {
                        interaction.__splitDisabled = true;
                        interaction.setActive(false);
                    }
                }
            });
        } catch (e) { }
    }

    function reEnableInteractions() {
        try {
            olMap.getInteractions().forEach(function (interaction) {
                if (interaction.__splitDisabled) {
                    interaction.setActive(true);
                    delete interaction.__splitDisabled;
                }
            });
        } catch (e) { }
    }

    function activateSplitTool() {
        if (isActive) return;
        isActive = true;
        window.__splitToolActive = true;
        splitPhase = 'select';
        _selectedExtent = null;
        _cachedIntersections = [];
        _splitPointCoords = [];

        var viewport = document.querySelector('.ol-viewport');
        if (!viewport) return;

        viewport.classList.add('__split-mode');

        _domDblclickHandler = domDblclickHandler;
        viewport.addEventListener('dblclick', _domDblclickHandler, true);

        _domClickBlocker = domClickBlocker;
        viewport.addEventListener('click', _domClickBlocker, true);

        _domMousemoveHandler = handleMousemovePreview;
        viewport.addEventListener('mousemove', _domMousemoveHandler, false);

        _domMouseupHandler = handlePointerup;
        _domPointerdownHandler = handlePointerdown;
        _domPointermoveHandler = handlePointermove;
        viewport.addEventListener('pointerup', _domMouseupHandler, true);
        viewport.addEventListener('pointerdown', _domPointerdownHandler, true);
        viewport.addEventListener('pointermove', _domPointermoveHandler, true);

        _pointermoveKey = olMap.on('moveend', function () {
            updateMarkerPositions();
        });

        disableDrawInteractions();
        _disableDrawInterval = setInterval(disableDrawInteractions, 1000);

        showSplitToast('\u2702 Shift+k\u00e9o \u0111\u1ec3 ch\u1ecdn v\u00f9ng t\u00ecm giao \u0111i\u1ec3m', 'info');
        console.log('[Split] \u2705 Split tool activated (Shift+drag to select area)');
    }

    function deactivateSplitTool() {
        if (!isActive) return;
        isActive = false;
        window.__splitToolActive = false;
        splitPhase = 'select';
        _selectedExtent = null;
        _cachedIntersections = [];
        _splitPointCoords = [];
        _boxStart = null;
        _boxDrawing = false;

        var viewport = document.querySelector('.ol-viewport');
        if (viewport) {
            viewport.classList.remove('__split-mode');
            if (_domDblclickHandler) {
                viewport.removeEventListener('dblclick', _domDblclickHandler, true);
                _domDblclickHandler = null;
            }
            if (_domClickBlocker) {
                viewport.removeEventListener('click', _domClickBlocker, true);
                _domClickBlocker = null;
            }
            if (_domMousemoveHandler) {
                viewport.removeEventListener('mousemove', _domMousemoveHandler, false);
                _domMousemoveHandler = null;
            }
            if (_domMouseupHandler) {
                viewport.removeEventListener('pointerup', _domMouseupHandler, true);
                _domMouseupHandler = null;
            }
            if (_domPointerdownHandler) {
                viewport.removeEventListener('pointerdown', _domPointerdownHandler, true);
                _domPointerdownHandler = null;
            }
            if (_domPointermoveHandler) {
                viewport.removeEventListener('pointermove', _domPointermoveHandler, true);
                _domPointermoveHandler = null;
            }
        }

        clearPreview();
        hideBoxRect();
        removeBoxRect();

        if (_pointermoveKey) {
            try { olMap.un('moveend', _pointermoveKey.listener || _pointermoveKey); } catch (e) { }
            _pointermoveKey = null;
        }

        if (_disableDrawInterval) {
            clearInterval(_disableDrawInterval);
            _disableDrawInterval = null;
        }

        clearMarkers();
        if (_markerContainer && _markerContainer.parentNode) {
            _markerContainer.remove();
            _markerContainer = null;
        }

        reEnableInteractions();
        removeHighlightLayer();

        showSplitToast('Split tool t\u1eaft', 'info');
        console.log('[Split] Split tool deactivated');
    }

    function toggleSplitTool() {
        if (isActive) {
            deactivateSplitTool();
        } else {
            activateSplitTool();
        }
        return isActive;
    }

    // Expose cho taskbar
    window.__toggleSplitTool = toggleSplitTool;
    window.__splitToolActive = false;

    // ==================== UNDO SUPPORT ====================
    // Đăng ký handler để Ctrl+Z có thể undo split
    // inject.js đã có logic đọc __undoStack, ta chỉ cần đảm bảo
    // entry có đủ thông tin để khôi phục

    // Override: khi inject.js gặp action === 'split', khôi phục feature gốc
    function setupUndoSupport() {
        const originalHandler = window.__ctrlZHandler;
        if (!originalHandler) return;

        // Wrap handler để xử lý split undo
        document.removeEventListener('keydown', originalHandler, true);

        const wrappedHandler = function (e) {
            if (!(e.ctrlKey || e.metaKey)) { originalHandler(e); return; }

            if (e.key === 'z' || e.key === 'Z') {
                // Kiểm tra stack có entry split không
                if (window.__undoStack && window.__undoStack.length > 0) {
                    const top = window.__undoStack[window.__undoStack.length - 1];
                    if (top.action === 'split') {
                        e.preventDefault();
                        e.stopPropagation();

                        const entry = window.__undoStack.pop();
                        undoSplit(entry);
                        return;
                    }
                }
                // Không phải split → delegate cho handler gốc
                originalHandler(e);
                return;
            }

            // Các phím khác → delegate
            originalHandler(e);
        };

        window.__ctrlZHandler = wrappedHandler;
        document.addEventListener('keydown', wrappedHandler, true);
    }

    function undoSplit(entry) {
        const source = entry._source;
        if (!source) return;

        // Xóa các features mới
        for (const newId of entry.newFeatureIds) {
            try {
                const f = source.getFeatureById(newId);
                if (f) source.removeFeature(f);
            } catch (e) { }
        }

        // Khôi phục feature gốc
        try {
            const allLines = collectLineStrings();
            if (allLines.length > 0) {
                const sampleFeature = allLines[0].feature;
                const restoredFeature = sampleFeature.clone();
                restoredFeature.getGeometry().setCoordinates(entry.originalCoords);
                if (entry.originalFeatureId) {
                    restoredFeature.setId(entry.originalFeatureId);
                }
                // Restore properties
                for (const [key, val] of Object.entries(entry.originalProperties)) {
                    if (key !== 'geometry') {
                        restoredFeature.set(key, val);
                    }
                }
                source.addFeature(restoredFeature);
            }
        } catch (e) {
            console.error('[Split] Error restoring feature:', e);
        }

        olMap.render();

        // Update markers nếu tool active
        if (isActive) {
            clearMarkers();
            const intersections = findAllIntersections();
            for (const pt of intersections) {
                createIntersectionMarker(pt);
            }
        }

        showSplitToast('↩ Undo split thành công', 'success');
        console.log('[Split] ↩ Undo split');

        document.dispatchEvent(new CustomEvent('3dg:features-changed'));
    }

    // ==================== INIT ====================

    function initSplit() {
        olMap = window.__olMap || findOlMap();
        if (!olMap) {
            setTimeout(initSplit, 3000);
            return;
        }

        injectSplitStyles();
        setupUndoSupport();

        // Alt+S: toggle split mode
        document.addEventListener('keydown', function (e) {
            if (e.altKey && !e.ctrlKey && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
                e.preventDefault();
                e.stopPropagation();
                toggleSplitTool();
            }
        }, true);

        console.log('[Split] \u2705 Split tool ready. Alt+S to toggle');
    }

    // Listen map-ready event
    if (window.__olMap) {
        setTimeout(initSplit, 500);
    } else {
        document.addEventListener('3dg:map-ready', () => {
            setTimeout(initSplit, 500);
        }, { once: true });

        // Safety fallback
        setTimeout(() => {
            if (!olMap) {
                (function waitForMap() {
                    if (!document.querySelector('.ol-viewport')) {
                        setTimeout(waitForMap, 1000);
                        return;
                    }
                    setTimeout(initSplit, 3500);
                })();
            }
        }, 10000);
    }

})();
