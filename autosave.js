// ============================================================
//  AUTO-SAVE & RESTORE cho OpenLayers Map (3dg.vn)
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
    const SEMI_EARTH = 20037508.342789244;
    const DEBUG = false;        // Bật true để xem verbose logs

    let olMap = null;
    let saveTimer = null;
    let hasInitialized = false;
    let lastSavedHash = '';
    const layerSourceMap = new WeakMap();
    const listenedFeatures = new WeakSet();
    let lastSavedCount = 0;
    let _staleCache = { ts: 0, result: true }; // Cache isMapStale
    let _domDirty = false; // MutationObserver sets this flag
    const _pointIds = new Set(); // Track Point feature IDs (để loại khỏi DOM count)

    function log(...args) { if (DEBUG) console.log('[AutoSave]', ...args); }

    // ==================== TÌM MAP ====================
    // Dùng shared findOlMap từ inject.js, fallback nếu chưa sẵn sàng
    function findOlMap() {
        if (window.__findOlMap) return window.__findOlMap();
        // Fallback: nếu inject.js chưa load (không nên xảy ra với sequential loading)
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

    // Ưu tiên listen event từ inject.js, fallback poll nếu cần
    if (window.__olMap) {
        // inject.js đã init xong trước → init ngay
        setTimeout(init, 500);
    } else {
        // Chờ event từ inject.js
        document.addEventListener('3dg:map-ready', () => {
            setTimeout(init, 500);
        }, { once: true });
        // Safety fallback: nếu event không đến trong 10s, tự poll
        setTimeout(() => {
            if (!olMap) {
                log('⚠️ map-ready event not received, falling back to poll');
                (function waitForMap() {
                    if (!document.querySelector('.ol-viewport')) {
                        setTimeout(waitForMap, 1000);
                        return;
                    }
                    setTimeout(init, 3000);
                })();
            }
        }, 10000);
    }

    // ==================== CHUYỂN ĐỔI TỌA ĐỘ ====================
    // Site dùng EPSG:3857, GeoJSON import cần EPSG:3857 luôn (site không transform)
    // Nên ta lưu trực tiếp tọa độ EPSG:3857 — không cần chuyển đổi
    // (Dựa vào file GeoJSON mẫu của user: tọa độ ~12152xxx, ~1551xxx = EPSG:3857)

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

    function refreshMap(force = false) {
        if (!force && !isMapStale()) return false;
        console.log('[AutoSave] 🔄 Map re-finding...');
        const newMap = findOlMap();
        if (!newMap) {
            log('❌ Không tìm thấy map');
            return false;
        }
        if (newMap === olMap) {
            if (!force) return false;
            // Force mode: same map, reset cache để thử lại
            _staleCache = { ts: Date.now(), result: false };
            return true;
        }
        // Map mới
        olMap = newMap;
        _staleCache = { ts: Date.now(), result: false };
        console.log('[AutoSave] ✅ Map mới found, re-attaching listeners');
        setupListeners();
        return true;
    }

    function extractFeatures() {
        const features = [];
        const seenIds = new Set();
        const seenFeatures = new WeakSet();
        // Safeguard: nếu map stale thì thử refresh trước
        if (isMapStale()) {
            const found = refreshMap(true);
            if (!found) return { type: 'FeatureCollection', features };
        }

        // Lọc: chỉ lưu features có trong bảng Biên tập (DOM sidebar)
        // Loại bỏ control points, reference markers (p4, p6...) không do user vẽ
        const domIds = getDOMFeatureIds();
        const domIdSet = domIds.length > 0 ? new Set(domIds) : null;

        function collect(layer) {
            // typeof check thay vì truthy — tránh crash nếu getLayers không phải function
            if (typeof layer.getLayers === 'function') {
                try { layer.getLayers().forEach(collect); } catch (e) {}
                return;
            }
            try {
                const src = layer.getSource?.();
                if (!src?.getFeatures) return;
                for (const f of src.getFeatures()) {
                    if (seenFeatures.has(f)) continue; // Dedup by object ref
                    seenFeatures.add(f);
                    const geom = f.getGeometry();
                    if (!geom) continue;
                    const fid = f.getId();
                    // Lọc: nếu có DOM sidebar, chỉ lấy features có trong sidebar
                    if (domIdSet && fid && !domIdSet.has(fid)) continue;
                    if (domIdSet && !fid) continue; // Skip features không có ID khi đang lọc
                    if (fid && seenIds.has(fid)) continue;
                    if (fid) seenIds.add(fid);
                    const type = geom.getType();
                    // Skip Point/MultiPoint — control points, GCP markers (p4, gcpcanhvinhbsca24...)
                    if (type === 'Point' || type === 'MultiPoint') {
                        if (fid) _pointIds.add(fid); // Track để loại khỏi DOM count
                        continue;
                    }
                    const coordinates = geom.getCoordinates();
                    // Lưu __landType nếu có
                    const landType = f.get('__landType');
                    const props = landType ? { __landType: landType } : null;
                    features.push({
                        type: 'Feature',
                        id: fid,
                        geometry: { type, coordinates },
                        properties: props
                    });
                }
            } catch (e) { }
        }
        try {
            olMap.getLayers().forEach(collect);
        } catch (e) {
            console.warn('[AutoSave] extractFeatures failed:', e);
        }

        // FALLBACK: OL trả về 0 nhưng DOM có features → thử tìm lại
        if (features.length === 0 && domIds.length > 0) {
            console.warn(`[AutoSave] ⚠️ OL=0, DOM=${domIds.length} → fallback`);
            // Force re-find map
            const freshMap = findOlMap();
            if (freshMap) {
                if (freshMap !== olMap) {
                    olMap = freshMap;
                    _staleCache = { ts: 0, result: true };
                }
                // Thử extract lại từ map (có thể mới)
                try { olMap.getLayers().forEach(collect); } catch (e) {}
            }
            // Vẫn 0? → tìm từng feature theo ID
            if (features.length === 0) {
                extractByDOMIds(domIds, features, seenIds, seenFeatures);
            }
        }

        return { type: 'FeatureCollection', features };
    }

    // Đếm số feature qua DOM để cross-check (loại Point/GCP)
    function countDOMFeatures() {
        let count = 0;
        document.querySelectorAll('div[data-feature-id]').forEach(el => {
            const id = el.getAttribute('data-feature-id');
            if (id && _pointIds.has(id)) return; // Skip known Points
            count++;
        });
        return count;
    }

    // Lấy danh sách feature IDs từ DOM (loại Point/GCP)
    function getDOMFeatureIds() {
        const ids = [];
        document.querySelectorAll('div[data-feature-id]').forEach(el => {
            const id = el.getAttribute('data-feature-id');
            if (id && !_pointIds.has(id)) ids.push(id);
        });
        return ids;
    }

    // Tìm features theo ID — fallback khi layer traversal thất bại
    function extractByDOMIds(domIds, features, seenIds, seenFeatures) {
        let found = 0;
        for (const fid of domIds) {
            if (seenIds.has(fid)) continue;
            try {
                let feature = null;
                function search(layer) {
                    if (feature) return;
                    if (typeof layer.getLayers === 'function') {
                        try { layer.getLayers().forEach(search); } catch (e) {}
                        return;
                    }
                    try {
                        const src = layer.getSource?.();
                        if (src?.getFeatureById) {
                            const f = src.getFeatureById(fid);
                            if (f) feature = f;
                        }
                    } catch (e) {}
                }
                try { olMap.getLayers().forEach(search); } catch (e) {}

                if (feature && !seenFeatures.has(feature)) {
                    seenFeatures.add(feature);
                    const geom = feature.getGeometry();
                    if (geom) {
                        const gType = geom.getType();
                        // Skip Point/MultiPoint — control points, GCP markers
                        if (gType === 'Point' || gType === 'MultiPoint') {
                            if (fid) _pointIds.add(fid);
                            continue;
                        }
                        seenIds.add(fid);
                        features.push({
                            type: 'Feature', id: fid,
                            geometry: { type: gType, coordinates: geom.getCoordinates() },
                            properties: null
                        });
                        found++;
                    }
                }
            } catch (e) {}
        }
        if (found > 0) {
            console.log(`[AutoSave] ✅ Fallback: ${found}/${domIds.length} features by ID`);
        }
    }

    // djb2 hash — incremental, không tạo string khổng lồ
    // Hash trực tiếp từ feature data → O(1) peak memory
    function quickHash(geojson) {
        const n = geojson.features.length;
        if (!n) return 'empty';
        let hash = 5381;
        let totalChars = 0;
        for (let i = 0; i < n; i++) {
            const f = geojson.features[i];
            // Hash ID
            const id = String(f.id || '');
            for (let j = 0; j < id.length; j++) {
                hash = ((hash << 5) + hash + id.charCodeAt(j)) | 0;
            }
            // Hash geometry type
            const t = f.geometry.type;
            for (let j = 0; j < t.length; j++) {
                hash = ((hash << 5) + hash + t.charCodeAt(j)) | 0;
            }
            // Hash coordinates — stringify từng feature (không gộp thành 1 string)
            const cs = JSON.stringify(f.geometry.coordinates);
            totalChars += cs.length;
            for (let j = 0; j < cs.length; j++) {
                hash = ((hash << 5) + hash + cs.charCodeAt(j)) | 0;
            }
        }
        return n + '_' + totalChars + '_' + (hash >>> 0).toString(36);
    }

    // Truncate coordinate precision để giảm localStorage size
    // EPSG:3405/VN-2000: đơn vị mét → 2 decimal = cm accuracy
    // EPSG:4326: 6 decimal = ~11cm accuracy
    function truncateCoords(coords) {
        if (typeof coords[0] === 'number') {
            // [x, y] or [x, y, z]
            return coords.map(v => Math.round(v * 100) / 100);
        }
        return coords.map(truncateCoords);
    }

    // ==================== LƯU / TẢI ====================
    // save() nhận geojson tùy chọn để tránh extract 2 lần
    // force=true: Ctrl+S — bypass hash check, luôn ghi localStorage
    function save(preExtracted, force = false) {
        try {
            const geojson = preExtracted || extractFeatures();

            if (!force) {
                const domCount = countDOMFeatures();
                if (geojson.features.length === 0 && !hasInitialized) {
                    log('⏭️ Skip: chưa init + 0 features');
                    return false;
                }
                if (geojson.features.length === 0 && (lastSavedCount > 0 || domCount > 0)) {
                    log(`⚠️ OL=0, DOM=${domCount}, saved=${lastSavedCount} → skip`);
                    return false;
                }
                if (geojson.features.length === 0) {
                    log('⏭️ Skip: 0 features');
                    return false;
                }
            } else if (geojson.features.length === 0) {
                // Force mode nhưng 0 features → vẫn skip
                log('⏭️ Force save: 0 features → skip');
                return false;
            }

            const hash = quickHash(geojson);
            if (!force && hash === lastSavedHash) return false;

            // Truncate coordinates để giảm storage size
            const compactFeatures = geojson.features.map(f => ({
                type: 'Feature',
                id: f.id,
                geometry: {
                    type: f.geometry.type,
                    coordinates: truncateCoords(f.geometry.coordinates)
                },
                properties: null
            }));
            const compactGeoJSON = { type: 'FeatureCollection', features: compactFeatures };

            const data = {
                v: 1,
                ts: Date.now(),
                url: location.href,
                count: compactGeoJSON.features.length,
                geojson: compactGeoJSON
            };

            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            lastSavedHash = hash;
            lastSavedCount = data.count;
            hasInitialized = true;
            updateIndicator('saved', data.count, data.ts);
            console.log(`[AutoSave] 💾 Đã lưu ${data.count} features`);
            return true;
        } catch (e) {
            console.error('[AutoSave] Lỗi khi lưu:', e);
            updateIndicator('error');
            return false;
        }
    }

    function scheduleSave() {
        if (saveTimer) clearTimeout(saveTimer);
        updateIndicator('pending');
        saveTimer = setTimeout(save, DEBOUNCE_MS);
    }

    function tryRestore(retries = 0) {
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

            // Nếu map đã có >= 50% features so với bản lưu → không cần restore
            const current = extractFeatures();
            if (current.features.length > 0 && current.features.length >= data.geojson.features.length * 0.5) {
                hasInitialized = true;
                lastSavedHash = quickHash(data.geojson);
                updateIndicator('saved', data.count, data.ts);
                return;
            }

            // Nếu OL trả 0 nhưng DOM có features → map đang load, retry
            if (current.features.length === 0 && countDOMFeatures() > 0 && retries < 3) {
                log(`🔄 tryRestore retry ${retries + 1}/3 — DOM has features, waiting...`);
                setTimeout(() => tryRestore(retries + 1), 3000);
                return;
            }

            // Hiện prompt hỏi user có muốn khôi phục không
            showRestorePrompt(data);
        } catch (e) {
            console.error('[AutoSave] Lỗi khi kiểm tra restore:', e);
            hasInitialized = true;
        }
    }

    // Tìm input GeoJSON — thử nhiều selector
    function findGeoJSONInput() {
        return document.querySelector('input[accept*=".geojson"]')
            || document.querySelector('input[accept*="geojson"]')
            || document.querySelector('input[accept*=".json"]')
            || document.querySelector('input[accept*="geo+json"]')
            || document.querySelector('input[type="file"][accept]');
    }

    function doRestore(data) {
        // Thực hiện import GeoJSON
        function executeImport() {
            const input = findGeoJSONInput();
            if (!input) return false;

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

            // Verify: kiểm tra features đã được import sau 3s
            setTimeout(() => {
                const after = extractFeatures();
                if (after.features.length > 0) {
                    lastSavedHash = quickHash(after);
                    lastSavedCount = after.features.length;
                    updateIndicator('saved', after.features.length, data.ts);
                    console.log(`[AutoSave] ✅ Restore verified: ${after.features.length} features`);
                }
                // Apply landType styles sau khi restore
                if (window.__applyLandTypeStyle && olMap) {
                    try {
                        olMap.getLayers().forEach(function scanLayer(layer) {
                            if (layer.getLayers) { layer.getLayers().forEach(scanLayer); return; }
                            try {
                                const src = layer.getSource?.();
                                if (!src?.getFeatures) return;
                                for (const f of src.getFeatures()) {
                                    if (f.get('__landType')) {
                                        window.__applyLandTypeStyle(f);
                                    }
                                }
                            } catch (e) {}
                        });
                    } catch (e) {}
                }
            }, 3000);

            return true;
        }

        // Thử restore ngay
        if (executeImport()) return true;

        // Input chưa có (bảng Biên tập chưa mở) → hướng dẫn + auto-retry
        showToast('⚠️ Vui lòng mở bảng Biên tập dữ liệu để khôi phục!', 'warning');
        console.log('[AutoSave] ⏳ Waiting for editor panel to open...');

        // Poll mỗi 2s, tối đa 60s chờ user mở bảng biên tập
        let attempts = 0;
        const retryTimer = setInterval(() => {
            attempts++;
            if (attempts > 30) {
                clearInterval(retryTimer);
                showToast('⏰ Hết thời gian chờ. Bấm Khôi phục lại sau khi mở bảng Biên tập.', 'info');
                return;
            }
            if (executeImport()) {
                clearInterval(retryTimer);
                console.log(`[AutoSave] ✅ Auto-restored after ${attempts * 2}s wait`);
            }
        }, 2000);

        return false;
    }

    function exportGeoJSON() {
        // Ưu tiên lấy từ OL, nếu rỗng thì fallback sang localStorage
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

    // ==================== LẮNG NGHE THAY ĐỔI ====================
    function setupListeners() {
        const listenedSources = new WeakSet();

        function attachToSource(src) {
            if (!src?.on || listenedSources.has(src)) return;
            listenedSources.add(src);
            src.on('addfeature', (e) => {
                log('📌 addfeature');
                attachGeometryListener(e.feature);
                scheduleSave();
            });
            src.on('removefeature', () => { log('🗑️ removefeature'); scheduleSave(); });
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
                        console.log('[AutoSave] 🔄 Source swap detected');
                    }
                    layerSourceMap.set(layer, src);
                    const before = listenedSources.has(src);
                    attachToSource(src);
                    if (!before) attached++;
                    if (src.getFeatures) {
                        for (const f of src.getFeatures()) attachGeometryListener(f);
                    }
                } catch (e) { }
            }
            try { olMap.getLayers().forEach(scanLayer); } catch (e) { }
            if (attached > 0) console.log(`[AutoSave] 🔗 Attached ${attached} new sources`);
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
        // Thay vì 3 interval riêng, dùng 1 loop duy nhất mỗi 3 giây:
        // - Check stale map → refresh nếu cần
        // - Re-scan sources (bắt source swap)
        // - Check DOM dirty flag từ MutationObserver
        // - Periodic save nếu phát hiện thay đổi
        let loopCount = 0;
        let lastDOMCount = -1;
        setInterval(() => {
            loopCount++;
            try {
                // 1. Stale map check
                if (isMapStale()) {
                    refreshMap();
                    return; // Sau refresh, đợi loop tiếp để ổn định
                }

                // 2. Re-scan sources (mỗi 3 loop = ~9s thay vì mỗi loop)
                if (loopCount % 3 === 0) {
                    scanAllLayers();
                }

                // 3. DOM dirty → schedule save (throttled bởi debounce)
                if (_domDirty) {
                    _domDirty = false;
                    scheduleSave();
                }

                // 4. Periodic change detection (mỗi 3 loop = ~9 giây)
                if (loopCount % 3 === 0) {
                    // Early exit: nếu DOM count không đổi → likely chưa thay đổi
                    const domCount = countDOMFeatures();
                    if (domCount === lastDOMCount && domCount === lastSavedCount) {
                        return; // Skip expensive extract + hash
                    }
                    lastDOMCount = domCount;

                    const geojson = extractFeatures();
                    const hash = quickHash(geojson);
                    if (hash !== lastSavedHash && geojson.features.length > 0) {
                        console.log(`[AutoSave] 🔍 Periodic: OL=${geojson.features.length}, DOM=${domCount} → saving`);
                        save(geojson);
                    } else if (geojson.features.length === 0 && domCount > 0) {
                        console.log(`[AutoSave] ⚠️ OL=0, DOM=${domCount} → force re-find map`);
                        if (refreshMap(true)) {
                            const g = extractFeatures();
                            if (g.features.length > 0) save(g);
                        }
                    }
                }
            } catch (e) { }
        }, LOOP_MS);

        // ============ MUTATION OBSERVER (throttled) ============
        // Chỉ set flag, không trigger save trực tiếp → tránh spam
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
            // Thu hẹp scope: observe container chứa feature list thay vì toàn bộ body
            const featureRow = document.querySelector('div[data-feature-id]');
            const observeTarget = featureRow?.parentElement || document.body;
            observer.observe(observeTarget, { childList: true, subtree: true });
            log('👁️ MutationObserver attached to', observeTarget.tagName,
                observeTarget === document.body ? '(fallback)' : '(scoped)');
        } catch (e) { }

        // Lưu trước khi thoát — chỉ save nếu extract được data,
        // tránh ghi đè bản lưu cũ bằng data rỗng khi map stale
        window.addEventListener('beforeunload', () => {
            if (saveTimer) clearTimeout(saveTimer);
            const geojson = extractFeatures();
            if (geojson.features.length > 0) {
                save(geojson);
            }
        });

        // Ctrl+S lưu ngay (force — bypass hash check)
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
                e.preventDefault();
                if (saveTimer) clearTimeout(saveTimer);
                const ok = save(null, true);
                if (ok) {
                    showToast('💾 Đã lưu!', 'success');
                } else {
                    showToast('⚠️ Không có dữ liệu để lưu', 'info');
                }
            }
        });

        // Listen thay đổi từ inject.js (undo/redo) và selection.js (delete)
        document.addEventListener('3dg:features-changed', () => {
            log('📡 features-changed event received');
            scheduleSave();
        });
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
                top: 48px; /* Dưới header — không che taskbar hover */
                left: 0;
                right: 0;
                z-index: 9980; /* Dưới taskbar (9990) */
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
                animation: as-toast-in 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards;
                white-space: nowrap;
                pointer-events: auto;
            }
            .as-toast.out {
                animation: as-toast-out 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards;
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
    let panelVisible = false;

    function createIndicator() {
        // Badge
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
                return; // Không cập nhật count/time khi pending
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

        // Slide in
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
            const success = doRestore(data);
            if (success) {
                dismiss();
            }
            // Nếu chưa thành công (chờ mở panel), banner giữ nguyên
            // doRestore sẽ auto-retry, dismiss khi thành công
            if (!success) {
                // Đăng ký callback: khi auto-retry thành công → dismiss banner
                const checkInterval = setInterval(() => {
                    if (hasInitialized) {
                        clearInterval(checkInterval);
                        dismiss();
                    }
                }, 2000);
                // Timeout 65s
                setTimeout(() => clearInterval(checkInterval), 65000);
            }
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
        container.appendChild(toast);

        // Sau TOAST_MS, trigger out animation bằng class toggle
        setTimeout(() => {
            toast.classList.add('out');
            toast.addEventListener('animationend', () => toast.remove(), { once: true });
            // Safety: remove sau 500ms nếu animationend không fire (tab inactive, etc.)
            setTimeout(() => { if (toast.parentNode) toast.remove(); }, 500);
        }, TOAST_MS);
    }

    // ==================== KHỞI TẠO ====================
    function init() {
        // Ưu tiên dùng shared map từ inject.js
        olMap = window.__olMap || findOlMap();
        if (!olMap) { setTimeout(init, 3000); return; }

        console.log('[AutoSave] ✅ OpenLayers Map found. Initializing auto-save...');

        injectStyles();
        createIndicator();
        setupListeners();

        // Chờ một chút để UI sẵn sàng rồi mới restore
        setTimeout(() => tryRestore(), 2000);
    }

})();
