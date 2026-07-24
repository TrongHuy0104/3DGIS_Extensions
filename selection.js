// ============================================================
//  BOX SELECTION — Chọn nhiều features bằng Shift+Drag
//  - Vẽ selection box (DOM overlay) trên .ol-viewport
//  - Query features intersecting extent
//  - Highlight + floating toolbar (xóa, bỏ chọn, export)
// ============================================================

(function () {
    'use strict';

    const DEBUG = false;
    function log(...args) { if (DEBUG) console.log('[Selection]', ...args); }

    let olMap = null;
    let isSelecting = false;
    let boxEl = null;
    let startPixel = null;
    let viewportRect = null;           // cached getBoundingClientRect
    const selectedFeatures = [];       // { feature, source, layer, originalStyle, featureId }
    const HIGHLIGHT_COLOR = 'rgba(0, 200, 255, 0.85)';
    const HIGHLIGHT_FILL  = 'rgba(0, 200, 255, 0.15)';

    // ==================== TÌM MAP ====================
    // Reuse từ window nếu inject.js/autosave.js đã tìm trước
    (function waitForMap() {
        if (!document.querySelector('.ol-viewport')) {
            setTimeout(waitForMap, 1000);
            return;
        }
        setTimeout(initSelection, 3500);
    })();

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
                    } catch (e) {}
                    node = node.return;
                }
                break;
            }
            el = el.parentElement;
        }
        return null;
    }

    // ==================== INJECT CSS ====================
    function injectSelectionStyles() {
        const style = document.createElement('style');
        style.textContent = `
            #sel-box {
                position: absolute;
                border: 2px dashed ${HIGHLIGHT_COLOR};
                background: rgba(0, 200, 255, 0.08);
                pointer-events: none;
                z-index: 10;
                border-radius: 3px;
                box-shadow: 0 0 12px rgba(0, 200, 255, 0.25);
            }
            #sel-toolbar {
                position: fixed;
                top: 16px;
                left: 50%;
                transform: translateX(-50%) translateY(-120%);
                z-index: 99998;
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 10px 18px;
                background: rgba(15, 23, 42, 0.92);
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                border: 1px solid rgba(0, 200, 255, 0.2);
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(0,200,255,0.1);
                font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
                font-size: 13px;
                color: #e2e8f0;
                transition: transform .35s cubic-bezier(.4,0,.2,1), opacity .35s cubic-bezier(.4,0,.2,1);
                opacity: 0;
                pointer-events: none;
            }
            #sel-toolbar.visible {
                transform: translateX(-50%) translateY(0);
                opacity: 1;
                pointer-events: auto;
            }
            #sel-toolbar .sel-count {
                display: flex; align-items: center; gap: 6px;
                font-weight: 600; color: ${HIGHLIGHT_COLOR}; white-space: nowrap;
            }
            #sel-toolbar .sel-count .sel-icon { font-size: 16px; }
            #sel-toolbar .sel-divider {
                width: 1px; height: 22px;
                background: rgba(255,255,255,0.1); flex-shrink: 0;
            }
            #sel-toolbar .sel-btn {
                display: flex; align-items: center; gap: 6px;
                padding: 7px 14px;
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 8px;
                background: rgba(255,255,255,0.04);
                color: #e2e8f0; cursor: pointer;
                font-size: 12px; font-family: inherit; white-space: nowrap;
                transition: all .15s ease;
            }
            #sel-toolbar .sel-btn:hover {
                background: rgba(255,255,255,0.1);
                border-color: rgba(255,255,255,0.15);
                transform: translateY(-1px);
            }
            #sel-toolbar .sel-btn.danger { color: #fca5a5; border-color: rgba(239,68,68,0.2); }
            #sel-toolbar .sel-btn.danger:hover { background: rgba(239,68,68,0.15); border-color: rgba(239,68,68,0.3); }
            #sel-toast-container {
                position: fixed; top: 70px; left: 50%;
                transform: translateX(-50%); z-index: 100000;
                display: flex; flex-direction: column; align-items: center;
                gap: 8px; pointer-events: none;
            }
            .sel-toast {
                padding: 8px 16px;
                background: rgba(15,23,42,0.92);
                backdrop-filter: blur(16px);
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 8px; color: #e2e8f0;
                font-family: 'Segoe UI', system-ui, sans-serif; font-size: 13px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                animation: sel-toast-in .3s ease, sel-toast-out .3s ease 3s forwards;
                white-space: nowrap; pointer-events: auto;
            }
            .sel-toast.success { border-left: 3px solid #10b981; }
            .sel-toast.error   { border-left: 3px solid #ef4444; }
            .sel-toast.info    { border-left: 3px solid #3b82f6; }
            @keyframes sel-toast-in  { from{opacity:0;transform:translateY(-10px)} to{opacity:1;transform:translateY(0)} }
            @keyframes sel-toast-out { from{opacity:1} to{opacity:0} }
            .ol-viewport.sel-mode { cursor: crosshair !important; }
        `;
        document.head.appendChild(style);
    }

    // ==================== UI ====================
    function createToolbar() {
        const toolbar = document.createElement('div');
        toolbar.id = 'sel-toolbar';
        toolbar.innerHTML = `
            <div class="sel-count">
                <span class="sel-icon">🔲</span>
                <span id="sel-count-text">0 features</span>
            </div>
            <div class="sel-divider"></div>
            <button class="sel-btn danger" id="sel-btn-delete">🗑️ Xóa tất cả</button>
            <button class="sel-btn" id="sel-btn-export">📥 Export</button>
            <button class="sel-btn" id="sel-btn-deselect">✖️ Bỏ chọn</button>
        `;
        document.body.appendChild(toolbar);

        // Toast container (tránh tạo trùng)
        if (!document.getElementById('sel-toast-container')) {
            const tc = document.createElement('div');
            tc.id = 'sel-toast-container';
            document.body.appendChild(tc);
        }

        // Delegate events trên toolbar thay vì bind từng nút
        toolbar.addEventListener('click', (e) => {
            const btn = e.target.closest('.sel-btn');
            if (!btn) return;
            e.stopPropagation();
            if (btn.id === 'sel-btn-delete')   deleteSelectedFeatures();
            if (btn.id === 'sel-btn-export')   exportSelectedFeatures();
            if (btn.id === 'sel-btn-deselect') clearSelection();
        });
    }

    function showToolbar(count) {
        const toolbar = document.getElementById('sel-toolbar');
        const countText = document.getElementById('sel-count-text');
        if (!toolbar || !countText) return;
        countText.textContent = `${count} feature${count > 1 ? 's' : ''}`;
        toolbar.classList.add('visible');
    }

    function hideToolbar() {
        document.getElementById('sel-toolbar')?.classList.remove('visible');
    }

    function showSelToast(msg, type = 'info') {
        const container = document.getElementById('sel-toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `sel-toast ${type}`;
        toast.textContent = msg;
        container.appendChild(toast);
        // Xóa sau khi animation kết thúc
        toast.addEventListener('animationend', (e) => {
            if (e.animationName === 'sel-toast-out') toast.remove();
        });
    }

    // ==================== SELECTION LOGIC ====================

    function createHighlightStyleFn(baseStyleFn) {
        return function (feature, resolution) {
            // Resolve base styles
            let styles;
            if (typeof baseStyleFn === 'function') {
                const r = baseStyleFn(feature, resolution);
                styles = Array.isArray(r) ? r : (r ? [r] : []);
            } else if (baseStyleFn) {
                styles = Array.isArray(baseStyleFn) ? baseStyleFn : [baseStyleFn];
            } else {
                styles = [];
            }

            if (styles.length === 0) return null; // fallback → OL default

            try {
                return styles.map(s => {
                    const cloned = s.clone();
                    const stroke = cloned.getStroke?.();
                    if (stroke) {
                        stroke.setColor(HIGHLIGHT_COLOR);
                        stroke.setWidth((s.getStroke?.()?.getWidth?.() || 2) + 3);
                    }
                    const fill = cloned.getFill?.();
                    if (fill) fill.setColor(HIGHLIGHT_FILL);
                    return cloned;
                });
            } catch (e) {
                log('Style clone failed:', e);
                return null;
            }
        };
    }

    function collectLayerSources() {
        const results = [];
        function walk(layer) {
            if (layer.getLayers) { layer.getLayers().forEach(walk); return; }
            try {
                const src = layer.getSource?.();
                if (src?.getFeatures) results.push({ layer, source: src });
            } catch (e) {}
        }
        try { olMap.getLayers().forEach(walk); } catch (e) {}
        return results;
    }

    function queryFeaturesInExtent(extent) {
        const found = [];
        const seen = new Set(); // dedup bằng feature reference

        for (const { layer, source } of collectLayerSources()) {
            try {
                const candidates = typeof source.getFeaturesInExtent === 'function'
                    ? source.getFeaturesInExtent(extent)
                    : source.getFeatures();

                for (const f of candidates) {
                    if (seen.has(f)) continue;
                    const geom = f.getGeometry?.();
                    if (geom?.intersectsExtent?.(extent)) {
                        seen.add(f);
                        found.push({ feature: f, source, layer });
                    }
                }
            } catch (e) {
                log('Query error:', e);
            }
        }
        return found;
    }

    function highlightFeatures(featureInfos) {
        for (const { feature, source, layer } of featureInfos) {
            const originalStyle = feature.getStyle?.() ?? null;
            const baseStyle = originalStyle || layer?.getStyle?.() || null;

            feature.setStyle(createHighlightStyleFn(baseStyle));

            selectedFeatures.push({
                feature, source, layer, originalStyle,
                featureId: feature.getId?.()
            });
        }
    }

    function clearSelection() {
        for (const entry of selectedFeatures) {
            try { entry.feature.setStyle(entry.originalStyle); } catch (e) {}
        }
        selectedFeatures.length = 0;
        hideToolbar();
        olMap?.render?.();
    }

    function deleteSelectedFeatures() {
        const count = selectedFeatures.length;
        if (!count) return;

        let deleted = 0;

        for (const entry of selectedFeatures) {
            try {
                const fid = entry.featureId || entry.feature.getId?.();
                let done = false;

                // Ưu tiên xóa qua DOM (React sync)
                if (fid) {
                    const row = document.querySelector(`div[data-feature-id="${fid}"]`);
                    const btn = row?.querySelector('button.ant-btn-dangerous');
                    if (btn) { btn.click(); done = true; }
                }

                // Fallback: xóa trực tiếp từ OL source
                if (!done) entry.source.removeFeature(entry.feature);

                deleted++;
            } catch (e) {
                log('Delete error:', e);
            }
        }

        selectedFeatures.length = 0;
        hideToolbar();
        olMap?.render?.();
        showSelToast(`🗑️ Đã xóa ${deleted}/${count} features`, deleted === count ? 'success' : 'error');
        console.log(`[Selection] 🗑️ Deleted ${deleted}/${count} features`);
    }

    function exportSelectedFeatures() {
        if (!selectedFeatures.length) return;

        const geojson = {
            type: 'FeatureCollection',
            features: selectedFeatures.map(({ feature }) => {
                const geom = feature.getGeometry();
                return {
                    type: 'Feature',
                    id: feature.getId?.(),
                    geometry: { type: geom.getType(), coordinates: geom.getCoordinates() },
                    properties: null
                };
            })
        };

        const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' });
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement('a'), {
            href: url,
            download: `selected_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.geojson`
        });
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        showSelToast(`📥 Đã xuất ${selectedFeatures.length} features`, 'success');
    }

    // ==================== BOX DRAWING ====================

    // Tạm disable DragZoom interaction (OL built-in Shift+Drag = zoom)
    // để tránh xung đột với box selection
    let _dragZoomCache = null;

    function disableDragZoom() {
        if (_dragZoomCache) return; // đã disable rồi
        try {
            const interactions = olMap.getInteractions().getArray();
            // DragZoom có method getGeometry + condition thường là shiftKeyOnly
            _dragZoomCache = interactions.filter(i =>
                i.constructor?.name === 'DragZoom' ||
                (typeof i.getGeometry === 'function' && typeof i.getCondition === 'function' && !(typeof i.removeLastPoint === 'function'))
            );
            for (const dz of _dragZoomCache) dz.setActive(false);
            if (_dragZoomCache.length) log('DragZoom disabled', _dragZoomCache.length);
        } catch (e) { _dragZoomCache = []; }
    }

    function enableDragZoom() {
        if (!_dragZoomCache?.length) { _dragZoomCache = null; return; }
        for (const dz of _dragZoomCache) {
            try { dz.setActive(true); } catch (e) {}
        }
        log('DragZoom re-enabled');
        _dragZoomCache = null;
    }

    function setupBoxSelection() {
        const viewport = document.querySelector('.ol-viewport');
        if (!viewport) return;

        let shiftHeld = false;

        // Gộp tất cả keydown logic vào 1 listener duy nhất
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Shift') {
                shiftHeld = true;
                viewport.classList.add('sel-mode');
                disableDragZoom();
            }
            if (e.key === 'Escape' && selectedFeatures.length > 0) {
                clearSelection();
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.key === 'Shift') {
                shiftHeld = false;
                if (!isSelecting) {
                    viewport.classList.remove('sel-mode');
                    enableDragZoom();
                }
            }
        });

        // Mousedown: bắt đầu kéo box
        viewport.addEventListener('mousedown', (e) => {
            if (!shiftHeld || e.button !== 0) return;

            e.stopPropagation();
            e.preventDefault();

            isSelecting = true;
            viewportRect = viewport.getBoundingClientRect(); // cache 1 lần

            startPixel = {
                x: e.clientX - viewportRect.left,
                y: e.clientY - viewportRect.top
            };

            boxEl = document.createElement('div');
            boxEl.id = 'sel-box';
            boxEl.style.cssText = `left:${startPixel.x}px;top:${startPixel.y}px;width:0;height:0`;
            viewport.appendChild(boxEl);

            clearSelection();
        }, true);

        // Mousemove: resize box (dùng cached rect)
        viewport.addEventListener('mousemove', (e) => {
            if (!isSelecting || !boxEl || !startPixel) return;

            e.stopPropagation();
            e.preventDefault();

            const cx = e.clientX - viewportRect.left;
            const cy = e.clientY - viewportRect.top;

            boxEl.style.left   = Math.min(startPixel.x, cx) + 'px';
            boxEl.style.top    = Math.min(startPixel.y, cy) + 'px';
            boxEl.style.width  = Math.abs(cx - startPixel.x) + 'px';
            boxEl.style.height = Math.abs(cy - startPixel.y) + 'px';
        }, true);

        // Mouseup: hoàn tất selection
        document.addEventListener('mouseup', (e) => {
            if (!isSelecting) return;

            isSelecting = false;
            viewport.classList.remove('sel-mode');
            enableDragZoom();

            if (!boxEl || !startPixel) return;

            const endPixel = {
                x: e.clientX - viewportRect.left,
                y: e.clientY - viewportRect.top
            };

            boxEl.remove();
            boxEl = null;
            viewportRect = null;

            // Bỏ qua nếu box quá nhỏ (click nhầm)
            if (Math.abs(endPixel.x - startPixel.x) < 5 && Math.abs(endPixel.y - startPixel.y) < 5) {
                startPixel = null;
                return;
            }

            // Pixel → map coordinates
            const minPx = [Math.min(startPixel.x, endPixel.x), Math.min(startPixel.y, endPixel.y)];
            const maxPx = [Math.max(startPixel.x, endPixel.x), Math.max(startPixel.y, endPixel.y)];

            const topLeft     = olMap.getCoordinateFromPixel(minPx);
            const bottomRight = olMap.getCoordinateFromPixel(maxPx);

            startPixel = null;

            if (!topLeft || !bottomRight) return;

            // extent [minX, minY, maxX, maxY]
            const extent = [
                Math.min(topLeft[0], bottomRight[0]),
                Math.min(topLeft[1], bottomRight[1]),
                Math.max(topLeft[0], bottomRight[0]),
                Math.max(topLeft[1], bottomRight[1])
            ];

            const found = queryFeaturesInExtent(extent);

            if (found.length > 0) {
                highlightFeatures(found);
                showToolbar(found.length);
                olMap.render();
                console.log(`[Selection] ✅ Selected ${found.length} features`);
            } else {
                showSelToast('Không tìm thấy feature nào trong vùng chọn', 'info');
            }
        });
    }

    // ==================== INIT ====================
    function initSelection() {
        olMap = findOlMap();
        if (!olMap) { setTimeout(initSelection, 3000); return; }

        console.log('[Selection] ✅ Map found. Initializing box selection...');
        injectSelectionStyles();
        createToolbar();
        setupBoxSelection();
        console.log('[Selection] 🔲 Box selection ready! Shift+Drag to select.');
    }

})();
