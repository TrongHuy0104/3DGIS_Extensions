(function waitForMap() {
    const viewport = document.querySelector('.ol-viewport');
    if (!viewport) { setTimeout(waitForMap, 1000); return; }
    setTimeout(initCtrlZ, 2000);
})();

function initCtrlZ() {
    if (window.__ctrlZHandler) document.removeEventListener('keydown', window.__ctrlZHandler, true);
    if (window.__featureClickHandler) document.removeEventListener('click', window.__featureClickHandler, true);

    // ===== SHARED findOlMap — single source of truth =====
    function findOlMap() {
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

    // Expose findOlMap cho autosave.js và selection.js dùng chung
    window.__findOlMap = findOlMap;

    const olMap = findOlMap();
    if (!olMap) { setTimeout(initCtrlZ, 3000); return; }

    // Expose olMap reference cho các module khác
    window.__olMap = olMap;

    window.__redoStack = [];
    // ===== UNDO STACK cho các hành động tổng quát (bulk delete, v.v.) =====
    // Khác với __redoStack (dành cho Ctrl+Y), __undoStack dành cho Ctrl+Z
    if (!window.__undoStack) window.__undoStack = [];
    // ===== FEATURE ORDER STACK (LIFO) =====
    // Track thứ tự feature được thêm vào map.
    // Feature vẽ mới nhất nằm cuối mảng → Ctrl+Z xóa nó trước.
    if (!window.__featureOrderStack) window.__featureOrderStack = [];

    // ===== Lắng nghe addfeature/removefeature để cập nhật order stack =====
    function setupFeatureTracking() {
        const trackedSources = new WeakSet();

        function attachToSource(src) {
            if (!src?.on || trackedSources.has(src)) return;
            trackedSources.add(src);

            src.on('addfeature', (e) => {
                const fid = e.feature?.getId?.();
                if (!fid) return;
                // Xóa nếu đã có (tránh trùng), rồi push lên cuối
                const idx = window.__featureOrderStack.indexOf(fid);
                if (idx !== -1) window.__featureOrderStack.splice(idx, 1);
                window.__featureOrderStack.push(fid);

                // ===== LAND TYPE: gắn loại đất vào feature mới =====
                const feature = e.feature;
                if (window.__currentLandType && !feature.get('__landType')) {
                    feature.set('__landType', window.__currentLandType);
                }
                // Áp dụng visual style nếu feature có landType
                applyLandTypeStyle(feature);
            });

            src.on('removefeature', (e) => {
                const fid = e.feature?.getId?.();
                if (!fid) return;
                const idx = window.__featureOrderStack.indexOf(fid);
                if (idx !== -1) window.__featureOrderStack.splice(idx, 1);
            });
        }

        function scanLayers(layer) {
            if (layer.getLayers) { layer.getLayers().forEach(scanLayers); return; }
            try {
                const src = layer.getSource?.();
                if (!src) return;
                attachToSource(src);
                // Populate stack với features hiện có (giữ thứ tự hiện tại)
                if (src.getFeatures) {
                    for (const f of src.getFeatures()) {
                        const fid = f.getId?.();
                        if (fid && !window.__featureOrderStack.includes(fid)) {
                            window.__featureOrderStack.push(fid);
                        }
                    }
                }
            } catch (e) { }
        }

        olMap.getLayers().forEach(scanLayers);

        // Bắt layer mới được thêm
        try {
            olMap.getLayers().on('add', (e) => {
                function scan(layer) {
                    if (layer.getLayers) { layer.getLayers().forEach(scan); return; }
                    try {
                        const src = layer.getSource?.();
                        if (src) attachToSource(src);
                    } catch (e) { }
                }
                scan(e.element);
            });
        } catch (e) { }

        // Re-scan định kỳ để bắt source swap
        setInterval(() => {
            try { olMap.getLayers().forEach(scanLayers); } catch (e) { }
        }, 5000);
    }

    setupFeatureTracking();

    function findFeatureById(featureId) {
        let result = { feature: null, source: null };
        function search(layer) {
            if (result.feature) return;
            if (layer.getLayers) { layer.getLayers().forEach(search); return; }
            try {
                const src = layer.getSource?.();
                if (!src?.getFeatureById) return;
                const f = src.getFeatureById(featureId);
                if (f) result = { feature: f, source: src };
            } catch (e) { }
        }
        olMap.getLayers().forEach(search);
        return result;
    }

    function deleteFeatureByDOM(featureId) {
        const row = document.querySelector(`div[data-feature-id="${featureId}"]`);
        if (!row) return false;
        const btn = row.querySelector('button.ant-btn-dangerous');
        if (!btn) return false;
        btn.click();
        return true;
    }

    // Expose cho selection.js dùng khi xóa features
    window.__deleteFeatureByDOM = deleteFeatureByDOM;
    window.__findFeatureById = findFeatureById;

    // ===== Tìm input GeoJSON — thử nhiều selector =====
    function findGeoJSONInput() {
        return document.querySelector('input[accept*=".geojson"]')
            || document.querySelector('input[accept*="geojson"]')
            || document.querySelector('input[accept*=".json"]')
            || document.querySelector('input[accept*="geo+json"]')
            || document.querySelector('input[type="file"][accept]');
    }

    // ===== LAND TYPE: Áp dụng visual style theo loại đất =====
    function applyLandTypeStyle(feature) {
        if (!feature) return;
        const code = feature.get('__landType');
        if (!code || !window.__getLandType) return;
        const info = window.__getLandType(code);
        if (!info) return;

        try {
            const rgb = info.rgb;
            const colorStr = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',1)';
            const fillStr = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0.25)';

            // Tìm OL Style classes từ feature hiện tại hoặc map layers
            const existingStyle = feature.getStyle?.();
            if (existingStyle && typeof existingStyle.clone === 'function') {
                const cloned = existingStyle.clone();
                const stroke = cloned.getStroke?.();
                if (stroke) stroke.setColor(colorStr);
                const fill = cloned.getFill?.();
                if (fill) fill.setColor(fillStr);
                feature.setStyle(cloned);
                return;
            }

            // Fallback: tạo style function mới
            feature.setStyle(function (f, resolution) {
                // Lấy layer style làm base
                let baseStyles = null;
                try {
                    olMap.getLayers().forEach(function scanLayer(layer) {
                        if (baseStyles) return;
                        if (layer.getLayers) { layer.getLayers().forEach(scanLayer); return; }
                        try {
                            const src = layer.getSource?.();
                            if (src?.getFeatureById?.(f.getId())) {
                                const ls = layer.getStyle?.();
                                if (typeof ls === 'function') {
                                    const r = ls(f, resolution);
                                    baseStyles = Array.isArray(r) ? r : (r ? [r] : null);
                                } else if (ls) {
                                    baseStyles = Array.isArray(ls) ? ls : [ls];
                                }
                            }
                        } catch (e) {}
                    });
                } catch (e) {}

                if (baseStyles && baseStyles.length > 0) {
                    return baseStyles.map(function (s) {
                        try {
                            const c = s.clone();
                            const st = c.getStroke?.();
                            if (st) st.setColor(colorStr);
                            const fi = c.getFill?.();
                            if (fi) fi.setColor(fillStr);
                            return c;
                        } catch (e) { return s; }
                    });
                }
                return null; // fallback to OL default
            });
        } catch (e) {
            console.warn('[CtrlZ] Failed to apply land type style:', e);
        }
    }
    // Expose cho land-type-ui.js và các module khác
    window.__applyLandTypeStyle = applyLandTypeStyle;

    // ===== REDO: Khôi phục feature bằng cách giả lập import GeoJSON =====
    function restoreFeatureByImport(entry) {
        let geometry;
        if (entry.geomType === 'LineString') {
            geometry = { type: 'LineString', coordinates: entry.coords };
        } else if (entry.geomType === 'Polygon') {
            geometry = { type: 'Polygon', coordinates: [[...entry.coords, entry.coords[0]]] };
        } else {
            geometry = { type: 'Point', coordinates: entry.coords[0] };
        }

        // Preserve landType trong properties nếu có
        const props = entry.landType ? { __landType: entry.landType } : null;

        const geojson = {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                geometry: geometry,
                properties: props,
                id: entry.featureId
            }]
        };

        const input = findGeoJSONInput();
        if (!input) return false;

        const blob = new Blob([JSON.stringify(geojson)], { type: 'application/geo+json' });
        const file = new File([blob], 'redo.geojson', { type: 'application/geo+json' });
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));

        // Sau khi restore, cần apply style lại (chờ feature được thêm)
        if (entry.landType) {
            setTimeout(() => {
                const { feature } = findFeatureById(entry.featureId);
                if (feature) {
                    feature.set('__landType', entry.landType);
                    applyLandTypeStyle(feature);
                }
            }, 500);
        }
        return true;
    }

    // Expose cho selection.js có thể dùng nếu cần
    window.__restoreFeatureByImport = restoreFeatureByImport;

    // ===== Helper: thông báo cho autosave biết features đã thay đổi =====
    function notifyFeaturesChanged() {
        document.dispatchEvent(new CustomEvent('3dg:features-changed'));
    }

    // ===== UNDO =====
    function undoOneCoord(featureId) {
        const { feature, source } = findFeatureById(featureId);
        if (!feature || !source) { deleteFeatureByDOM(featureId); return 'deleted'; }

        const geom = feature.getGeometry();
        const type = geom.getType();

        if (type === 'LineString') {
            const coords = geom.getCoordinates();
            const removedCoord = coords.pop();
            if (coords.length < 2) {
                window.__redoStack.push({
                    action: 'deleteFeature',
                    featureId: feature.getId(),
                    coords: [...coords, removedCoord],
                    geomType: 'LineString',
                    landType: feature.get('__landType') || null
                });
                deleteFeatureByDOM(featureId);
                return 'deleted';
            }
            window.__redoStack.push({
                action: 'removeCoord',
                featureId: feature.getId(),
                coord: removedCoord,
                geomType: 'LineString'
            });
            geom.setCoordinates(coords);
            return 'removed';

        } else if (type === 'Polygon') {
            const rings = geom.getCoordinates();
            const ring = rings[0];
            const removedCoord = ring.splice(ring.length - 2, 1)[0];
            ring[ring.length - 1] = ring[0];
            if (ring.length < 4) {
                window.__redoStack.push({
                    action: 'deleteFeature',
                    featureId: feature.getId(),
                    coords: [...ring.slice(0, -1), removedCoord],
                    geomType: 'Polygon',
                    landType: feature.get('__landType') || null
                });
                deleteFeatureByDOM(featureId);
                return 'deleted';
            }
            window.__redoStack.push({
                action: 'removeCoord',
                featureId: feature.getId(),
                coord: removedCoord,
                geomType: 'Polygon'
            });
            geom.setCoordinates([ring]);
            return 'removed';

        } else if (type === 'Point') {
            const coord = geom.getCoordinates();
            window.__redoStack.push({
                action: 'deleteFeature',
                featureId: feature.getId(),
                coords: [coord],
                geomType: 'Point',
                landType: feature.get('__landType') || null
            });
            deleteFeatureByDOM(featureId);
            return 'deleted';
        }
        return 'skip';
    }

    // ===== REDO =====
    function redoOneStep() {
        if (!window.__redoStack.length) return false;
        const entry = window.__redoStack.pop();

        if (entry.action === 'removeCoord') {
            const { feature } = findFeatureById(entry.featureId);
            if (!feature) return false;
            const geom = feature.getGeometry();

            if (entry.geomType === 'LineString') {
                const coords = geom.getCoordinates();
                coords.push(entry.coord);
                geom.setCoordinates(coords);
            } else if (entry.geomType === 'Polygon') {
                const rings = geom.getCoordinates();
                const ring = rings[0];
                ring.splice(ring.length - 1, 0, entry.coord);
                ring[ring.length - 1] = ring[0];
                geom.setCoordinates([ring]);
            }
            return true;

        } else if (entry.action === 'deleteFeature') {
            // Giả lập import GeoJSON để React tạo lại feature trong DOM + OL
            return restoreFeatureByImport(entry);
        }

        return false;
    }

    // ===== CLICK TRACKING =====
    window.__selectedFeatureId = null;
    window.__featureClickHandler = function (e) {
        if (e.target.closest('button.ant-btn-dangerous')) return;
        const row = e.target.closest('div[data-feature-id]');
        if (row) window.__selectedFeatureId = row.getAttribute('data-feature-id');
    };
    document.addEventListener('click', window.__featureClickHandler, true);

    // ===== KEYBOARD =====
    window.__ctrlZHandler = function (e) {
        if (!(e.ctrlKey || e.metaKey)) return;

        // Ctrl+Z: UNDO
        if (e.key === 'z' || e.key === 'Z') {
            e.preventDefault();
            e.stopPropagation(); // Chặn site/OL xử lý trùng

            try {

                // Đang vẽ → xóa điểm cuối của sketch
                const activeDraw = olMap.getInteractions().getArray()
                    .find(i => typeof i.removeLastPoint === 'function' && i.sketchFeature_ != null);
                if (activeDraw) { activeDraw.removeLastPoint(); olMap.render(); return; }

                // Kiểm tra __undoStack (bulk delete từ selection, v.v.)
                if (window.__undoStack && window.__undoStack.length > 0) {
                    const undoEntry = window.__undoStack.pop();
                    if (undoEntry.action === 'bulkDelete' && undoEntry.features) {
                        let restored = 0;
                        for (const feat of undoEntry.features) {
                            if (restoreFeatureByImport(feat)) restored++;
                        }
                        console.log(`[CtrlZ] ↩️ Undo bulk delete: restored ${restored}/${undoEntry.features.length}`);
                    }
                    olMap.render();
                    notifyFeaturesChanged();
                    return;
                }

                // Undo trên feature đang chọn (nếu feature vẫn tồn tại)
                if (window.__selectedFeatureId) {
                    const { feature: selFeature } = findFeatureById(window.__selectedFeatureId);
                    if (selFeature) {
                        // Feature tồn tại → thử undo coord
                        const r = undoOneCoord(window.__selectedFeatureId);
                        if (r === 'deleted') window.__selectedFeatureId = null;
                        if (r !== 'skip') { olMap.render(); notifyFeaturesChanged(); return; }
                    }
                    // Feature không tồn tại hoặc skip → xóa stale ID, tiếp tục xuống LIFO
                    window.__selectedFeatureId = null;
                }

                // Undo theo thứ tự LIFO (feature vẽ sau → xóa trước)
                if (window.__featureOrderStack.length > 0) {
                    for (let i = window.__featureOrderStack.length - 1; i >= 0; i--) {
                        const fid = window.__featureOrderStack[i];
                        const r = undoOneCoord(fid);
                        if (r === 'removed' || r === 'deleted') {
                            olMap.render(); notifyFeaturesChanged(); return;
                        }
                    }
                } else {
                    // Fallback: duyệt DOM rows nếu stack rỗng
                    const rows = document.querySelectorAll('div[data-feature-id]');
                    for (let i = rows.length - 1; i >= 0; i--) {
                        const r = undoOneCoord(rows[i].getAttribute('data-feature-id'));
                        if (r === 'removed' || r === 'deleted') { olMap.render(); notifyFeaturesChanged(); return; }
                    }
                }
                olMap.render();
                notifyFeaturesChanged();
            } catch (err) {
                console.error('[CtrlZ] Lỗi khi undo:', err);
            }
            return;
        }

        // Ctrl+Y: REDO
        if (e.key === 'y' || e.key === 'Y') {
            e.preventDefault();
            e.stopPropagation(); // Chặn site xử lý trùng
            try {
                redoOneStep();
                olMap.render();
                notifyFeaturesChanged();
            } catch (err) {
                console.error('[CtrlZ] Lỗi khi redo:', err);
            }
        }
    };
    // Capture phase: đảm bảo handler chạy TRƯỚC site/OL handlers
    document.addEventListener('keydown', window.__ctrlZHandler, true);

    // Dispatch map-ready event cho autosave.js và selection.js
    console.log('[CtrlZ] ✅ Map found & initialized. Dispatching 3dg:map-ready');
    document.dispatchEvent(new CustomEvent('3dg:map-ready', { detail: { map: olMap } }));
}
