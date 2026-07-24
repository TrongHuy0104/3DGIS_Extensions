// ============================================================
//  CTRL+Z/Y UNDO/REDO + AUTO-SAVE cho OpenLayers Map (3dg.vn)
//  - Ctrl+Z: Undo coordinate / xóa feature
//  - Ctrl+Y: Redo coordinate / khôi phục feature
//  - Ctrl+S: Lưu ngay
//  - Tự động lưu features vào localStorage khi có thay đổi
//  - Tự động khôi phục khi reload / mở lại trang
//  - UI floating indicator + restore prompt
// ============================================================

(function () {
    'use strict';

    // ==================== CẤU HÌNH ====================
    const STORAGE_KEY = '__3dg_autosave_' + location.pathname.replace(/[^a-zA-Z0-9]/g, '_');
    const DEBOUNCE_MS = 2000;
    const LOOP_MS = 3000;       // Unified control loop interval
    const TOAST_MS = 4000;
    const DEBUG = false;        // Bật true để xem verbose logs

    // ==================== SHARED STATE ====================
    let olMap = null;
    let saveTimer = null;
    let hasInitialized = false;
    let lastSavedHash = '';
    let lastSavedCount = 0;
    let panelVisible = false;

    const layerSourceMap = new WeakMap();
    const listenedFeatures = new WeakSet();

    let _staleCache = { ts: 0, result: true };
    let _domDirty = false;

    // Ctrl+Z/Y state
    window.__redoStack = [];
    window.__selectedFeatureId = null;
    window.__featureOrderStack = []; // Track thứ tự feature được thêm (LIFO)

    function log(...args) { if (DEBUG) console.log('[Inject]', ...args); }

    // ==================== TÌM MAP ====================
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

    // Kiểm tra olMap có còn gắn vào DOM không (cached 1.5s)
    function isMapStale() {
        const now = Date.now();
        if (now - _staleCache.ts < 1500) return _staleCache.result;
        let stale = false;
        if (!olMap) { stale = true; }
        else try {
            const target = olMap.getTargetElement?.();
            if (target && !document.contains(target)) stale = true;
            else olMap.getLayers(); // Throws nếu disposed
        } catch (e) { stale = true; }
        _staleCache = { ts: now, result: stale };
        return stale;
    }

    function refreshMap() {
        if (!isMapStale()) return false;
        console.log('[Inject] 🔄 Map stale! Re-finding...');
        const newMap = findOlMap();
        if (!newMap || newMap === olMap) {
            log('❌ Không tìm thấy map mới');
            return false;
        }
        olMap = newMap;
        _staleCache = { ts: Date.now(), result: false };
        console.log('[Inject] ✅ Map mới found, re-attaching listeners');
        setupAutoSaveListeners();
        return true;
    }

    // ==================== AUTOSAVE: EXTRACT & HASH ====================
    function extractFeatures() {
        const features = [];
        const seenIds = new Set();
        if (isMapStale()) {
            const found = refreshMap();
            if (!found) return { type: 'FeatureCollection', features };
        }
        function collect(layer) {
            if (layer.getLayers) { layer.getLayers().forEach(collect); return; }
            try {
                const src = layer.getSource?.();
                if (!src?.getFeatures) return;
                for (const f of src.getFeatures()) {
                    const geom = f.getGeometry();
                    if (!geom) continue;
                    const fid = f.getId();
                    if (fid && seenIds.has(fid)) continue;
                    if (fid) seenIds.add(fid);
                    const type = geom.getType();
                    const coordinates = geom.getCoordinates();
                    features.push({
                        type: 'Feature',
                        id: fid,
                        geometry: { type, coordinates },
                        properties: null
                    });
                }
            } catch (e) { }
        }
        try {
            olMap.getLayers().forEach(collect);
        } catch (e) {
            console.warn('[Inject] extractFeatures failed:', e);
        }
        return { type: 'FeatureCollection', features };
    }

    function countDOMFeatures() {
        return document.querySelectorAll('div[data-feature-id]').length;
    }

    // djb2 hash
    function quickHash(geojson) {
        if (!geojson.features.length) return 'empty';
        const str = geojson.features.map(f =>
            f.id + ':' + f.geometry.type + ':' + JSON.stringify(f.geometry.coordinates)
        ).join('|');
        let hash = 5381;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
        }
        return hash.toString(36);
    }

    // ==================== AUTOSAVE: LƯU / TẢI ====================
    function save(preExtracted) {
        try {
            const geojson = preExtracted || extractFeatures();
            const domCount = countDOMFeatures();

            if (geojson.features.length === 0 && !hasInitialized) {
                log('⏭️ Skip: chưa init + 0 features');
                return;
            }

            if (geojson.features.length === 0 && (lastSavedCount > 0 || domCount > 0)) {
                log(`⚠️ OL=0, DOM=${domCount}, saved=${lastSavedCount} → skip`);
                return;
            }

            if (geojson.features.length === 0) {
                log('⏭️ Skip: 0 features');
                return;
            }

            const hash = quickHash(geojson);
            if (hash === lastSavedHash) return;

            const data = {
                v: 1,
                ts: Date.now(),
                url: location.href,
                count: geojson.features.length,
                geojson
            };

            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            lastSavedHash = hash;
            lastSavedCount = data.count;
            hasInitialized = true;
            updateIndicator('saved', data.count, data.ts);
            console.log(`[Inject] 💾 Đã lưu ${data.count} features`);
        } catch (e) {
            console.error('[Inject] Lỗi khi lưu:', e);
            updateIndicator('error');
        }
    }

    function scheduleSave() {
        if (saveTimer) clearTimeout(saveTimer);
        updateIndicator('pending');
        saveTimer = setTimeout(save, DEBOUNCE_MS);
    }

    function tryRestore() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) {
                hasInitialized = true;
                updateIndicator('empty');
                return;
            }

            const data = JSON.parse(raw);
            if (!data?.geojson?.features?.length) {
                hasInitialized = true;
                updateIndicator('empty');
                return;
            }

            // Nếu map đã có features → không restore (tránh trùng lặp)
            const current = extractFeatures();
            if (current.features.length > 0) {
                hasInitialized = true;
                lastSavedHash = quickHash(data.geojson);
                updateIndicator('saved', data.count, data.ts);
                return;
            }

            // Hiện prompt hỏi user có muốn khôi phục không
            showRestorePrompt(data);
        } catch (e) {
            console.error('[Inject] Lỗi khi kiểm tra restore:', e);
            hasInitialized = true;
        }
    }

    // Tìm input file GeoJSON — thử nhiều selector
    function findGeoJSONInput() {
        return document.querySelector('input[accept*=".geojson"]')
            || document.querySelector('input[accept*="geojson"]')
            || document.querySelector('input[accept*=".json"]')
            || document.querySelector('input[accept*="geo+json"]')
            || document.querySelector('input[type="file"][accept]');
    }

    function doRestore(data) {
        const input = findGeoJSONInput();
        if (input) {
            return executeRestore(input, data);
        }

        // Input chưa xuất hiện → chờ polling tối đa 15 giây
        showToast('⏳ Đang chờ chức năng import sẵn sàng...', 'info');
        let attempts = 0;
        const maxAttempts = 15;
        const pollId = setInterval(() => {
            attempts++;
            const inp = findGeoJSONInput();
            if (inp) {
                clearInterval(pollId);
                executeRestore(inp, data);
                return;
            }
            if (attempts >= maxAttempts) {
                clearInterval(pollId);
                // Fallback: thử thêm OL GeoJSON format nếu có
                if (tryDirectOLRestore(data)) return;
                showToast('❌ Không tìm thấy chức năng import GeoJSON trên trang!', 'error');
                hasInitialized = true;
            }
        }, 1000);
        return false;
    }

    function executeRestore(input, data) {
        const blob = new Blob([JSON.stringify(data.geojson)], { type: 'application/geo+json' });
        const file = new File([blob], 'autosave_restore.geojson', { type: 'application/geo+json' });
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));

        hasInitialized = true;
        lastSavedHash = quickHash(data.geojson);
        updateIndicator('saved', data.count, data.ts);
        showToast(`✅ Đã khôi phục ${data.geojson.features.length} feature!`, 'success');
        return true;
    }

    // Fallback: Restore trực tiếp qua OpenLayers nếu không có input element
    function tryDirectOLRestore(data) {
        if (!olMap || !data?.geojson?.features?.length) return false;
        try {
            // Tìm vector source có thể thêm features
            let targetSource = null;
            function findSource(layer) {
                if (targetSource) return;
                if (layer.getLayers) { layer.getLayers().forEach(findSource); return; }
                try {
                    const src = layer.getSource?.();
                    if (src?.addFeature && src?.getFeatures) {
                        targetSource = src;
                    }
                } catch (e) { }
            }
            olMap.getLayers().forEach(findSource);
            if (!targetSource) return false;

            // Parse GeoJSON và thêm vào source
            const format = new (window.ol?.format?.GeoJSON || function () { return null; })();
            if (!format?.readFeatures) return false;

            const features = format.readFeatures(data.geojson);
            for (const f of features) {
                targetSource.addFeature(f);
            }
            hasInitialized = true;
            lastSavedHash = quickHash(data.geojson);
            updateIndicator('saved', data.count, data.ts);
            showToast(`✅ Đã khôi phục ${data.geojson.features.length} feature (trực tiếp)!`, 'success');
            return true;
        } catch (e) {
            console.warn('[Inject] Direct OL restore failed:', e);
            return false;
        }
    }

    function exportGeoJSON() {
        let geojson = extractFeatures();
        let source = 'map';

        if (geojson.features.length === 0) {
            try {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (raw) {
                    const data = JSON.parse(raw);
                    if (data?.geojson?.features?.length > 0) {
                        geojson = data.geojson;
                        source = 'localStorage';
                    }
                }
            } catch (e) { }
        }

        if (geojson.features.length === 0) {
            showToast('⚠️ Không có feature nào để xuất!', 'warning');
            return;
        }

        const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const now = new Date();
        const ts = now.toISOString().slice(0, 19).replace(/[T:]/g, '-');
        a.download = `map_${ts}.geojson`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        const label = source === 'localStorage' ? ' (từ bản lưu)' : '';
        showToast(`📁 Đã tải ${geojson.features.length} features${label}!`, 'success');
    }

    function clearSavedData() {
        localStorage.removeItem(STORAGE_KEY);
        lastSavedHash = '';
        lastSavedCount = 0;
        updateIndicator('empty');
        showToast('🗑️ Đã xóa bản lưu tự động!', 'info');
    }

    // ==================== CTRL+Z/Y: FIND FEATURE ====================
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

    // ==================== CTRL+Z/Y: REDO - Khôi phục feature =====
    function restoreFeatureByImport(entry) {
        let geometry;
        if (entry.geomType === 'LineString') {
            geometry = { type: 'LineString', coordinates: entry.coords };
        } else if (entry.geomType === 'Polygon') {
            geometry = { type: 'Polygon', coordinates: [[...entry.coords, entry.coords[0]]] };
        } else {
            geometry = { type: 'Point', coordinates: entry.coords[0] };
        }

        const geojson = {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                geometry: geometry,
                properties: null,
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
        return true;
    }

    // ==================== CTRL+Z: UNDO ====================
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
                    geomType: 'LineString'
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
                    geomType: 'Polygon'
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
                geomType: 'Point'
            });
            deleteFeatureByDOM(featureId);
            return 'deleted';
        }
        return 'skip';
    }

    // ==================== CTRL+Y: REDO ====================
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
            return restoreFeatureByImport(entry);
        }

        return false;
    }

    // ==================== AUTOSAVE LISTENERS ====================
    function setupAutoSaveListeners() {
        const listenedSources = new WeakSet();

        function attachToSource(src) {
            if (!src?.on || listenedSources.has(src)) return;
            listenedSources.add(src);
            src.on('addfeature', (e) => {
                log('📌 addfeature');
                attachGeometryListener(e.feature);
                // Track thứ tự thêm feature (LIFO cho Ctrl+Z)
                const fid = e.feature?.getId?.();
                if (fid) {
                    // Xóa nếu đã có (tránh trùng), rồi push lên đầu
                    const idx = window.__featureOrderStack.indexOf(fid);
                    if (idx !== -1) window.__featureOrderStack.splice(idx, 1);
                    window.__featureOrderStack.push(fid);
                    log('📋 featureOrderStack push:', fid, '→', window.__featureOrderStack.length);
                }
                scheduleSave();
            });
            src.on('removefeature', (e) => {
                log('🗑️ removefeature');
                // Xóa khỏi order stack khi feature bị xóa
                const fid = e.feature?.getId?.();
                if (fid) {
                    const idx = window.__featureOrderStack.indexOf(fid);
                    if (idx !== -1) window.__featureOrderStack.splice(idx, 1);
                }
                scheduleSave();
            });
            src.on('changefeature', () => { log('✏️ changefeature'); scheduleSave(); });
        }

        function attachGeometryListener(feature) {
            if (!feature || listenedFeatures.has(feature)) return;
            listenedFeatures.add(feature);
            const geom = feature.getGeometry?.();
            if (geom?.on) {
                geom.on('change', () => { log('📐 geom change', feature.getId()); scheduleSave(); });
            }
        }

        function scanAllLayers() {
            let attached = 0;
            function scanLayer(layer) {
                if (layer.getLayers) { layer.getLayers().forEach(scanLayer); return; }
                try {
                    const src = layer.getSource?.();
                    if (!src) return;
                    const prev = layerSourceMap.get(layer);
                    if (prev && prev !== src) {
                        console.log('[Inject] 🔄 Source swap detected');
                    }
                    layerSourceMap.set(layer, src);
                    const before = listenedSources.has(src);
                    attachToSource(src);
                    if (!before) attached++;
                    if (src.getFeatures) {
                        for (const f of src.getFeatures()) {
                            attachGeometryListener(f);
                            // Track existing features in order stack
                            const fid = f.getId?.();
                            if (fid && !window.__featureOrderStack.includes(fid)) {
                                window.__featureOrderStack.push(fid);
                            }
                        }
                    }
                } catch (e) { }
            }
            try { olMap.getLayers().forEach(scanLayer); } catch (e) { }
            if (attached > 0) console.log(`[Inject] 🔗 Attached ${attached} new sources`);
        }

        // Initial scan
        scanAllLayers();

        // Layer add event
        olMap.getLayers().on('add', (e) => {
            log('➕ Layer added');
            function scanLayer(layer) {
                if (layer.getLayers) { layer.getLayers().forEach(scanLayer); return; }
                try {
                    const src = layer.getSource?.();
                    if (src) { layerSourceMap.set(layer, src); attachToSource(src); }
                } catch (e) { }
            }
            scanLayer(e.element);
            scheduleSave();
        });

        // ============ UNIFIED CONTROL LOOP ============
        let loopCount = 0;
        setInterval(() => {
            loopCount++;
            try {
                // 1. Stale map check
                if (isMapStale()) {
                    refreshMap();
                    return;
                }

                // 2. Re-scan sources
                scanAllLayers();

                // 3. DOM dirty → schedule save
                if (_domDirty) {
                    _domDirty = false;
                    scheduleSave();
                }

                // 4. Periodic change detection (mỗi 3 loop = ~9 giây)
                if (loopCount % 3 === 0) {
                    const geojson = extractFeatures();
                    const domCount = countDOMFeatures();
                    const hash = quickHash(geojson);
                    if (hash !== lastSavedHash && geojson.features.length > 0) {
                        console.log(`[Inject] 🔍 Periodic: OL=${geojson.features.length}, DOM=${domCount} → saving`);
                        save(geojson);
                    } else if (geojson.features.length === 0 && domCount > 0) {
                        console.log(`[Inject] ⚠️ OL=0, DOM=${domCount} → re-find map`);
                        if (refreshMap()) {
                            const g = extractFeatures();
                            if (g.features.length > 0) save(g);
                        }
                    }
                }
            } catch (e) { }
        }, LOOP_MS);

        // ============ MUTATION OBSERVER ============
        try {
            const observer = new MutationObserver((mutations) => {
                for (const m of mutations) {
                    if (m.addedNodes.length || m.removedNodes.length) {
                        const nodes = [...m.addedNodes, ...m.removedNodes];
                        if (nodes.some(n => n.nodeType === 1 && (
                            n.matches?.('div[data-feature-id]') ||
                            n.querySelector?.('div[data-feature-id]')
                        ))) {
                            _domDirty = true;
                            break;
                        }
                    }
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
            log('👁️ MutationObserver attached');
        } catch (e) { }

        // Lưu trước khi thoát
        window.addEventListener('beforeunload', () => {
            if (saveTimer) clearTimeout(saveTimer);
            save();
        });
    }

    // ==================== KEYBOARD HANDLER ====================
    function setupKeyboardHandler() {
        // Cleanup handlers cũ nếu có
        if (window.__ctrlZHandler) document.removeEventListener('keydown', window.__ctrlZHandler);
        if (window.__featureClickHandler) document.removeEventListener('click', window.__featureClickHandler, true);

        // Click tracking cho feature selection
        window.__featureClickHandler = function (e) {
            if (e.target.closest('button.ant-btn-dangerous')) return;
            const row = e.target.closest('div[data-feature-id]');
            if (row) window.__selectedFeatureId = row.getAttribute('data-feature-id');
        };
        document.addEventListener('click', window.__featureClickHandler, true);

        // Keyboard: Ctrl+Z, Ctrl+Y, Ctrl+S
        window.__ctrlZHandler = function (e) {
            if (!(e.ctrlKey || e.metaKey)) return;

            // Ctrl+Z: UNDO
            if (e.key === 'z' || e.key === 'Z') {
                e.preventDefault();

                // Đang vẽ → xóa điểm cuối của sketch
                const activeDraw = olMap.getInteractions().getArray()
                    .find(i => typeof i.removeLastPoint === 'function' && i.sketchFeature_ != null);
                if (activeDraw) { activeDraw.removeLastPoint(); olMap.render(); scheduleSave(); return; }

                // Undo trên feature đang chọn
                if (window.__selectedFeatureId) {
                    const r = undoOneCoord(window.__selectedFeatureId);
                    if (r === 'deleted') window.__selectedFeatureId = null;
                    if (r !== 'skip') { olMap.render(); scheduleSave(); return; }
                    window.__selectedFeatureId = null;
                }

                // Undo theo thứ tự LIFO (feature vẽ sau → xóa trước)
                // Ưu tiên dùng featureOrderStack, fallback sang DOM nếu stack rỗng
                if (window.__featureOrderStack.length > 0) {
                    // Duyệt từ cuối stack (feature mới nhất)
                    for (let i = window.__featureOrderStack.length - 1; i >= 0; i--) {
                        const fid = window.__featureOrderStack[i];
                        const r = undoOneCoord(fid);
                        if (r === 'removed' || r === 'deleted') {
                            olMap.render(); scheduleSave(); return;
                        }
                    }
                } else {
                    // Fallback: duyệt DOM rows
                    const rows = document.querySelectorAll('div[data-feature-id]');
                    for (let i = rows.length - 1; i >= 0; i--) {
                        const r = undoOneCoord(rows[i].getAttribute('data-feature-id'));
                        if (r === 'removed' || r === 'deleted') { olMap.render(); scheduleSave(); return; }
                    }
                }
                olMap.render();
                return;
            }

            // Ctrl+Y: REDO
            if (e.key === 'y' || e.key === 'Y') {
                e.preventDefault();
                const success = redoOneStep();
                olMap.render();
                if (success) scheduleSave();
                return;
            }

            // Ctrl+S: SAVE ngay
            if (e.key === 's' || e.key === 'S') {
                e.preventDefault();
                if (saveTimer) clearTimeout(saveTimer);
                save();
                showToast('💾 Đã lưu!', 'success');
            }
        };
        document.addEventListener('keydown', window.__ctrlZHandler);
    }

    // ==================== UI: INJECT CSS ====================
    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* ===== AUTO-SAVE INDICATOR ===== */
            #as-indicator {
                position: fixed;
                bottom: 20px;
                right: 20px;
                z-index: 99999;
                font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
                font-size: 13px;
                user-select: none;
            }

            #as-badge {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 14px;
                background: rgba(15, 23, 42, 0.88);
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 10px;
                color: #e2e8f0;
                cursor: pointer;
                transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            }
            #as-badge:hover {
                background: rgba(15, 23, 42, 0.95);
                transform: translateY(-2px);
                box-shadow: 0 6px 28px rgba(0, 0, 0, 0.4);
            }

            #as-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                flex-shrink: 0;
                transition: background 0.3s;
            }
            #as-dot.saved { background: #10b981; box-shadow: 0 0 6px #10b981; }
            #as-dot.pending { background: #eab308; box-shadow: 0 0 6px #eab308; animation: as-pulse 1s infinite; }
            #as-dot.error { background: #ef4444; box-shadow: 0 0 6px #ef4444; }
            #as-dot.empty { background: #64748b; }

            @keyframes as-pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.4; }
            }

            #as-text {
                white-space: nowrap;
                font-size: 12px;
                line-height: 1;
            }

            /* ===== PANEL ===== */
            #as-panel {
                position: absolute;
                bottom: calc(100% + 10px);
                right: 0;
                min-width: 260px;
                background: rgba(15, 23, 42, 0.95);
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 14px;
                padding: 16px;
                color: #e2e8f0;
                box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
                opacity: 0;
                transform: translateY(10px) scale(0.95);
                pointer-events: none;
                transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
            }
            #as-panel.visible {
                opacity: 1;
                transform: translateY(0) scale(1);
                pointer-events: auto;
            }

            .as-panel-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 14px;
                padding-bottom: 10px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            }
            .as-panel-header span {
                font-weight: 600;
                font-size: 14px;
                letter-spacing: -0.01em;
            }
            .as-panel-close {
                background: none;
                border: none;
                color: #94a3b8;
                cursor: pointer;
                font-size: 16px;
                padding: 2px 6px;
                border-radius: 4px;
                transition: all 0.15s;
            }
            .as-panel-close:hover { color: #e2e8f0; background: rgba(255,255,255,0.1); }

            .as-panel-info {
                display: flex;
                flex-direction: column;
                gap: 8px;
                margin-bottom: 16px;
                font-size: 13px;
            }
            .as-panel-info div {
                display: flex;
                justify-content: space-between;
                color: #94a3b8;
            }
            .as-panel-info strong {
                color: #e2e8f0;
                font-weight: 500;
            }

            .as-panel-actions {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .as-panel-btn {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 10px 14px;
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 8px;
                background: rgba(255, 255, 255, 0.04);
                color: #e2e8f0;
                cursor: pointer;
                font-size: 13px;
                font-family: inherit;
                transition: all 0.15s;
            }
            .as-panel-btn:hover {
                background: rgba(255, 255, 255, 0.1);
                border-color: rgba(255, 255, 255, 0.15);
            }
            .as-panel-btn.danger {
                color: #fca5a5;
                border-color: rgba(239, 68, 68, 0.2);
            }
            .as-panel-btn.danger:hover {
                background: rgba(239, 68, 68, 0.15);
                border-color: rgba(239, 68, 68, 0.3);
            }

            /* ===== RESTORE BANNER ===== */
            #as-restore-banner {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                z-index: 99999;
                background: linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.95));
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                padding: 14px 24px;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 16px;
                color: #e2e8f0;
                font-family: 'Segoe UI', system-ui, sans-serif;
                font-size: 14px;
                box-shadow: 0 4px 30px rgba(0, 0, 0, 0.3);
                transform: translateY(-100%);
                transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            }
            #as-restore-banner.visible {
                transform: translateY(0);
            }

            .as-banner-icon {
                font-size: 22px;
                flex-shrink: 0;
            }

            .as-banner-text {
                flex: 1;
                line-height: 1.4;
            }
            .as-banner-text strong {
                color: #60a5fa;
            }

            .as-banner-actions {
                display: flex;
                gap: 8px;
                flex-shrink: 0;
            }

            .as-banner-btn {
                padding: 8px 18px;
                border: none;
                border-radius: 8px;
                cursor: pointer;
                font-size: 13px;
                font-weight: 500;
                font-family: inherit;
                transition: all 0.2s;
            }
            .as-banner-btn.primary {
                background: linear-gradient(135deg, #3b82f6, #2563eb);
                color: white;
                box-shadow: 0 2px 10px rgba(59, 130, 246, 0.3);
            }
            .as-banner-btn.primary:hover {
                background: linear-gradient(135deg, #60a5fa, #3b82f6);
                transform: translateY(-1px);
                box-shadow: 0 4px 16px rgba(59, 130, 246, 0.4);
            }
            .as-banner-btn.secondary {
                background: rgba(255, 255, 255, 0.08);
                color: #94a3b8;
                border: 1px solid rgba(255, 255, 255, 0.1);
            }
            .as-banner-btn.secondary:hover {
                background: rgba(255, 255, 255, 0.12);
                color: #e2e8f0;
            }

            /* ===== TOAST ===== */
            #as-toast-container {
                position: fixed;
                bottom: 70px;
                right: 20px;
                z-index: 100000;
                display: flex;
                flex-direction: column;
                gap: 8px;
                pointer-events: none;
            }

            .as-toast {
                padding: 10px 18px;
                background: rgba(15, 23, 42, 0.92);
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 10px;
                color: #e2e8f0;
                font-family: 'Segoe UI', system-ui, sans-serif;
                font-size: 13px;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
                animation: as-toast-in 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                           as-toast-out 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards;
                white-space: nowrap;
                pointer-events: auto;
            }
            .as-toast.success { border-left: 3px solid #10b981; }
            .as-toast.error   { border-left: 3px solid #ef4444; }
            .as-toast.warning { border-left: 3px solid #eab308; }
            .as-toast.info    { border-left: 3px solid #3b82f6; }

            @keyframes as-toast-in {
                from { opacity: 0; transform: translateX(30px); }
                to   { opacity: 1; transform: translateX(0); }
            }
            @keyframes as-toast-out {
                from { opacity: 1; transform: translateX(0); }
                to   { opacity: 0; transform: translateX(30px); }
            }
        `;
        document.head.appendChild(style);
    }

    // ==================== UI: TẠO ELEMENTS ====================
    function createIndicator() {
        const container = document.createElement('div');
        container.id = 'as-indicator';
        container.innerHTML = `
            <div id="as-badge">
                <span id="as-dot" class="empty"></span>
                <span id="as-text">Auto-Save</span>
            </div>
            <div id="as-panel">
                <div class="as-panel-header">
                    <span>💾 Auto-Save</span>
                    <button class="as-panel-close" id="as-panel-close">✕</button>
                </div>
                <div class="as-panel-info">
                    <div><span>Features:</span> <strong id="as-panel-count">0</strong></div>
                    <div><span>Lưu lúc:</span> <strong id="as-panel-time">—</strong></div>
                    <div><span>Trạng thái:</span> <strong id="as-panel-status">Chờ...</strong></div>
                </div>
                <div class="as-panel-actions">
                    <button class="as-panel-btn" id="as-btn-export">📥 Xuất file GeoJSON</button>
                    <button class="as-panel-btn" id="as-btn-forcesave">💾 Lưu ngay</button>
                    <button class="as-panel-btn danger" id="as-btn-clear">🗑️ Xóa bản lưu</button>
                </div>
            </div>
        `;
        document.body.appendChild(container);

        // Toast container
        const toastContainer = document.createElement('div');
        toastContainer.id = 'as-toast-container';
        document.body.appendChild(toastContainer);

        // Events
        document.getElementById('as-badge').addEventListener('click', (e) => {
            e.stopPropagation();
            togglePanel();
        });
        document.getElementById('as-panel-close').addEventListener('click', (e) => {
            e.stopPropagation();
            togglePanel(false);
        });
        document.getElementById('as-btn-export').addEventListener('click', (e) => {
            e.stopPropagation();
            exportGeoJSON();
        });
        document.getElementById('as-btn-forcesave').addEventListener('click', (e) => {
            e.stopPropagation();
            if (saveTimer) clearTimeout(saveTimer);
            save();
            showToast('💾 Đã lưu!', 'success');
        });
        document.getElementById('as-btn-clear').addEventListener('click', (e) => {
            e.stopPropagation();
            clearSavedData();
        });

        // Đóng panel khi click ra ngoài
        document.addEventListener('click', () => {
            if (panelVisible) togglePanel(false);
        });
        document.getElementById('as-panel').addEventListener('click', (e) => e.stopPropagation());
    }

    function togglePanel(forceState) {
        const panel = document.getElementById('as-panel');
        panelVisible = forceState !== undefined ? forceState : !panelVisible;
        if (panelVisible) {
            panel.classList.add('visible');
        } else {
            panel.classList.remove('visible');
        }
    }

    function updateIndicator(status, count, timestamp) {
        const dot = document.getElementById('as-dot');
        const text = document.getElementById('as-text');
        const panelCount = document.getElementById('as-panel-count');
        const panelTime = document.getElementById('as-panel-time');
        const panelStatus = document.getElementById('as-panel-status');

        if (!dot || !text) return;

        dot.className = status;

        switch (status) {
            case 'saved':
                text.textContent = `Đã lưu • ${count} feat`;
                if (panelStatus) panelStatus.textContent = '✅ Đã lưu';
                break;
            case 'pending':
                text.textContent = 'Đang lưu...';
                if (panelStatus) panelStatus.textContent = '⏳ Đang lưu...';
                return;
            case 'error':
                text.textContent = 'Lỗi lưu!';
                if (panelStatus) panelStatus.textContent = '❌ Lỗi';
                return;
            case 'empty':
                text.textContent = 'Auto-Save';
                if (panelStatus) panelStatus.textContent = 'Chưa có dữ liệu';
                if (panelCount) panelCount.textContent = '0';
                if (panelTime) panelTime.textContent = '—';
                return;
        }

        if (count !== undefined && panelCount) panelCount.textContent = count;
        if (timestamp && panelTime) {
            panelTime.textContent = new Date(timestamp).toLocaleString('vi-VN', {
                hour: '2-digit', minute: '2-digit', second: '2-digit',
                day: '2-digit', month: '2-digit', year: 'numeric'
            });
        }
    }

    function showRestorePrompt(data) {
        const banner = document.createElement('div');
        banner.id = 'as-restore-banner';

        const timeStr = new Date(data.ts).toLocaleString('vi-VN', {
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            day: '2-digit', month: '2-digit', year: 'numeric'
        });

        banner.innerHTML = `
            <span class="as-banner-icon">📂</span>
            <span class="as-banner-text">
                Tìm thấy bản vẽ đã lưu: <strong>${data.count} features</strong> — ${timeStr}
            </span>
            <div class="as-banner-actions">
                <button class="as-banner-btn primary" id="as-restore-btn">✅ Khôi phục</button>
                <button class="as-banner-btn secondary" id="as-dismiss-btn">Bỏ qua</button>
            </div>
        `;
        document.body.appendChild(banner);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                banner.classList.add('visible');
            });
        });

        function dismiss() {
            banner.classList.remove('visible');
            setTimeout(() => banner.remove(), 400);
            hasInitialized = true;
            updateIndicator('saved', data.count, data.ts);
        }

        document.getElementById('as-restore-btn').addEventListener('click', () => {
            doRestore(data);
            dismiss();
        });

        document.getElementById('as-dismiss-btn').addEventListener('click', () => {
            dismiss();
        });
    }

    function showToast(msg, type = 'info') {
        const container = document.getElementById('as-toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `as-toast ${type}`;
        toast.textContent = msg;

        toast.style.animationDuration = '0.3s, 0.3s';
        toast.style.animationDelay = `0s, ${TOAST_MS / 1000}s`;

        container.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, TOAST_MS + 400);
    }

    // ==================== KHỞI TẠO ====================
    function init() {
        olMap = findOlMap();
        if (!olMap) { setTimeout(init, 3000); return; }

        console.log('[Inject] ✅ OpenLayers Map found. Initializing Ctrl+Z/Y + AutoSave...');

        // UI
        injectStyles();
        createIndicator();

        // AutoSave listeners (source events, control loop, mutation observer, beforeunload)
        setupAutoSaveListeners();

        // Keyboard handler (Ctrl+Z, Ctrl+Y, Ctrl+S) + click tracking
        setupKeyboardHandler();

        // Chờ một chút để UI sẵn sàng rồi mới restore
        setTimeout(() => tryRestore(), 2000);
    }

    // ==================== ENTRY POINT ====================
    (function waitForMap() {
        if (!document.querySelector('.ol-viewport')) {
            setTimeout(waitForMap, 1000);
            return;
        }
        setTimeout(init, 3000);
    })();

})();
