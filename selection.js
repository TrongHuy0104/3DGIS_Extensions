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
    // Dùng shared findOlMap từ inject.js
    function findOlMap() {
        if (window.__findOlMap) return window.__findOlMap();
        // Fallback
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

    // Ưu tiên listen event từ inject.js
    if (window.__olMap) {
        setTimeout(initSelection, 500);
    } else {
        document.addEventListener('3dg:map-ready', () => {
            setTimeout(initSelection, 500);
        }, { once: true });
        // Safety fallback
        setTimeout(() => {
            if (!olMap) {
                log('⚠️ map-ready event not received, falling back to poll');
                (function waitForMap() {
                    if (!document.querySelector('.ol-viewport')) {
                        setTimeout(waitForMap, 1000);
                        return;
                    }
                    setTimeout(initSelection, 3500);
                })();
            }
        }, 10000);
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
    function createToastContainer() {
        // Toast container (tránh tạo trùng)
        if (!document.getElementById('sel-toast-container')) {
            const tc = document.createElement('div');
            tc.id = 'sel-toast-container';
            document.body.appendChild(tc);
        }
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
        olMap?.render?.();
    }

    // Expose cho inject.js gọi khi Ctrl+Z
    window.__clearSelection = clearSelection;

    function deleteSelectedFeatures() {
        const count = selectedFeatures.length;
        if (!count) return;

        let deleted = 0;
        const undoFeatures = []; // Thu thập info để undo batch

        for (const entry of selectedFeatures) {
            try {
                const fid = entry.featureId || entry.feature.getId?.();
                let done = false;

                // Lưu thông tin feature trước khi xóa (để Ctrl+Z khôi phục)
                if (fid) {
                    try {
                        const geom = entry.feature.getGeometry();
                        const type = geom.getType();
                        const coords = geom.getCoordinates();
                        let savedCoords;
                        if (type === 'Polygon') {
                            savedCoords = coords[0].slice(0, -1); // bỏ closing point
                        } else if (type === 'LineString') {
                            savedCoords = coords;
                        } else {
                            savedCoords = [coords];
                        }
                        undoFeatures.push({
                            action: 'deleteFeature',
                            featureId: fid,
                            coords: savedCoords,
                            geomType: type
                        });
                    } catch (e) { log('Failed to save feature info:', e); }
                }

                // Ưu tiên xóa qua DOM (React sync)
                if (fid) {
                    const deleteByDOM = window.__deleteFeatureByDOM || ((id) => {
                        const row = document.querySelector(`div[data-feature-id="${id}"]`);
                        const btn = row?.querySelector('button.ant-btn-dangerous');
                        if (btn) { btn.click(); return true; }
                        return false;
                    });
                    done = deleteByDOM(fid);
                }

                // Fallback: xóa trực tiếp từ OL source
                if (!done) entry.source.removeFeature(entry.feature);

                deleted++;
            } catch (e) {
                log('Delete error:', e);
            }
        }

        // Push vào __undoStack (dành cho Ctrl+Z) — 1 entry cho cả batch
        if (undoFeatures.length > 0 && window.__undoStack) {
            window.__undoStack.push({
                action: 'bulkDelete',
                features: undoFeatures
            });
        }

        selectedFeatures.length = 0;
        olMap?.render?.();
        showSelToast(`🗑️ Đã xóa ${deleted}/${count} features`, deleted === count ? 'success' : 'error');
        console.log(`[Selection] 🗑️ Deleted ${deleted}/${count} features`);

        // Thông báo cho autosave cập nhật
        document.dispatchEvent(new CustomEvent('3dg:features-changed'));
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

    // Tạm disable DragZoom + Draw interactions khi Shift held
    // để tránh xung đột với box selection
    let _disabledInteractions = null;

    function disableMapInteractions() {
        if (_disabledInteractions) return; // đã disable rồi
        try {
            const interactions = olMap.getInteractions().getArray();
            _disabledInteractions = interactions.filter(i => {
                const name = i.constructor?.name || '';
                // Disable DragZoom
                if (name === 'DragZoom') return true;
                // Disable Draw interactions (có removeLastPoint)
                if (typeof i.removeLastPoint === 'function') return true;
                // Fallback DragZoom detection
                if (typeof i.getGeometry === 'function' && typeof i.getCondition === 'function') {
                    if (typeof i.getFeatures === 'function') return false; // Select
                    if (name.includes('Modify') || name.includes('Snap') || name.includes('Translate')) return false;
                    try {
                        const cond = i.getCondition();
                        if (cond && cond.name && !cond.name.includes('shift')) return false;
                    } catch (e) {}
                    return true;
                }
                return false;
            });
            for (const i of _disabledInteractions) i.setActive(false);
            if (_disabledInteractions.length) log('Interactions disabled:', _disabledInteractions.length);
        } catch (e) { _disabledInteractions = []; }
    }

    function enableMapInteractions() {
        if (!_disabledInteractions?.length) { _disabledInteractions = null; return; }
        for (const i of _disabledInteractions) {
            try { i.setActive(true); } catch (e) {}
        }
        log('Interactions re-enabled');
        _disabledInteractions = null;
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
                disableMapInteractions();
            }
            // Esc → bỏ chọn
            if (e.key === 'Escape' && selectedFeatures.length > 0) {
                clearSelection();
            }
            // Del → xóa tất cả features đang chọn
            if (e.key === 'Delete' && selectedFeatures.length > 0) {
                deleteSelectedFeatures();
            }
            // Ctrl+E → export features đang chọn
            if (e.key === 'e' && e.ctrlKey && !e.shiftKey && !e.altKey && selectedFeatures.length > 0) {
                e.preventDefault();
                exportSelectedFeatures();
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.key === 'Shift') {
                shiftHeld = false;
                if (!isSelecting) {
                    viewport.classList.remove('sel-mode');
                    enableMapInteractions();
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
            enableMapInteractions();

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
                olMap.render();
                showSelToast(`✅ Đã chọn ${found.length} feature${found.length > 1 ? 's' : ''} — Del: xóa | Ctrl+E: export | Esc: bỏ chọn`, 'info');
                console.log(`[Selection] ✅ Selected ${found.length} features`);
            } else {
                showSelToast('Không tìm thấy feature nào trong vùng chọn', 'info');
            }
        });
    }

    // ==================== INIT ====================
    function initSelection() {
        // Ưu tiên dùng shared map từ inject.js
        olMap = window.__olMap || findOlMap();
        if (!olMap) { setTimeout(initSelection, 3000); return; }

        console.log('[Selection] ✅ Map found. Initializing box selection...');
        injectSelectionStyles();
        createToastContainer();
        setupBoxSelection();
        console.log('[Selection] 🔲 Box selection ready! Shift+Drag to select.');
    }

})();
