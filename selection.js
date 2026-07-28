// ============================================================
//  SELECTION TOOL — Rectangle + Polygon selection
//  - Rectangle: Shift+Drag to draw selection box (existing)
//  - Polygon: Shift+Click to add vertices, double-click/Enter to finish
//  - Highlight + floating toolbar (xóa, bỏ chọn, export)
//  - Configurable: intersects vs. contains mode
// ============================================================

(function () {
    'use strict';

    const DEBUG = false;
    function log(...args) { if (DEBUG) console.log('[Selection]', ...args); }

    let olMap = null;
    let isSelecting = false;       // Rectangle drag active
    let boxEl = null;
    let startPixel = null;
    let viewportRect = null;       // cached getBoundingClientRect
    const selectedFeatures = [];   // { feature, source, layer, originalStyle, featureId }
    const HIGHLIGHT_COLOR = 'rgba(0, 200, 255, 0.85)';
    const HIGHLIGHT_FILL  = 'rgba(0, 200, 255, 0.15)';

    // ==================== SELECTION MODE STATE ====================
    // 'rectangle' | 'polygon'
    let selectionMode = 'rectangle';
    // 'intersects' | 'contains'
    let selectionRule = 'intersects';

    // Polygon drawing state
    let isDrawingPolygon = false;
    let polygonVertices = [];      // map coordinates [x, y]
    let polygonCanvas = null;      // canvas overlay element
    let polygonCtx = null;         // canvas 2d context
    let currentMouseCoord = null;  // current mouse map coordinate for preview
    let _polyAnimFrame = null;     // rAF id for polygon rendering

    // Polygon style
    const POLY_STROKE  = '#9333ea';
    const POLY_FILL    = 'rgba(147, 51, 234, 0.12)';
    const POLY_VERTEX_RADIUS = 5;
    const POLY_CLOSE_DISTANCE = 12; // pixel distance to snap to first vertex

    // Selection history for Ctrl+Z
    const selectionHistory = [];
    const MAX_SELECTION_HISTORY = 20;

    // Persist selection mode to localStorage
    function loadSelectionMode() {
        try {
            const saved = localStorage.getItem('__3dg_selectionMode');
            if (saved === 'polygon' || saved === 'rectangle') selectionMode = saved;
            const savedRule = localStorage.getItem('__3dg_selectionRule');
            if (savedRule === 'intersects' || savedRule === 'contains') selectionRule = savedRule;
        } catch (e) {}
    }
    function saveSelectionMode() {
        try {
            localStorage.setItem('__3dg_selectionMode', selectionMode);
            localStorage.setItem('__3dg_selectionRule', selectionRule);
        } catch (e) {}
    }

    // Expose for taskbar
    window.__selectionMode = selectionMode;
    window.__selectionRule = selectionRule;

    window.__setSelectionMode = function (mode) {
        if (mode !== 'rectangle' && mode !== 'polygon') return;
        selectionMode = mode;
        window.__selectionMode = selectionMode;
        saveSelectionMode();
        if (window.__updateTaskbarSelectionState) window.__updateTaskbarSelectionState();
        log('Selection mode:', selectionMode);
    };

    window.__toggleSelectionMode = function () {
        window.__setSelectionMode(selectionMode === 'rectangle' ? 'polygon' : 'rectangle');
    };

    window.__toggleSelectionRule = function () {
        selectionRule = selectionRule === 'intersects' ? 'contains' : 'intersects';
        window.__selectionRule = selectionRule;
        saveSelectionMode();
        if (window.__updateTaskbarSelectionState) window.__updateTaskbarSelectionState();
        log('Selection rule:', selectionRule);
    };

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

            /* ═══ Polygon drawing canvas ═══ */
            #sel-polygon-canvas {
                position: absolute;
                top: 0; left: 0;
                width: 100%; height: 100%;
                pointer-events: none;
                z-index: 11;
            }




            /* ═══ Polygon drawing tooltip ═══ */
            #sel-poly-tooltip {
                position: absolute;
                padding: 4px 8px;
                background: rgba(15,23,42,0.88);
                color: #e2e8f0;
                font-size: 11px;
                font-family: 'Segoe UI', system-ui, sans-serif;
                border-radius: 4px;
                pointer-events: none;
                z-index: 12;
                white-space: nowrap;
                transform: translate(12px, -50%);
                opacity: 0;
                transition: opacity 0.15s ease;
            }
            #sel-poly-tooltip.--visible {
                opacity: 1;
            }
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

    // ==================== MODE SWITCHER UI ====================
    let modeSwitcherEl = null;

    function createModeSwitcher() {
        if (document.getElementById('sel-mode-switcher')) return;

        const switcher = document.createElement('div');
        switcher.id = 'sel-mode-switcher';

        // Rectangle button
        const rectBtn = document.createElement('button');
        rectBtn.className = 'sel-mode-btn';
        rectBtn.id = 'sel-btn-rectangle';
        rectBtn.title = 'Rectangle Selection (Shift+Drag)';
        rectBtn.textContent = '🔲 Rectangle';
        rectBtn.addEventListener('click', () => {
            selectionMode = 'rectangle';
            window.__selectionMode = selectionMode;
            saveSelectionMode();
            updateModeSwitcherUI();
        });

        // Polygon button
        const polyBtn = document.createElement('button');
        polyBtn.className = 'sel-mode-btn';
        polyBtn.id = 'sel-btn-polygon';
        polyBtn.title = 'Polygon Selection (Shift+Click)';
        polyBtn.textContent = '⬠ Polygon';
        polyBtn.addEventListener('click', () => {
            selectionMode = 'polygon';
            window.__selectionMode = selectionMode;
            saveSelectionMode();
            updateModeSwitcherUI();
        });

        // Separator
        const sep = document.createElement('div');
        sep.className = 'sel-mode-sep';

        // Rule toggle: intersects / contains
        const ruleBtn = document.createElement('button');
        ruleBtn.className = 'sel-rule-btn';
        ruleBtn.id = 'sel-btn-rule';
        ruleBtn.title = 'Toggle: Intersects / Contains';
        ruleBtn.addEventListener('click', () => {
            selectionRule = selectionRule === 'intersects' ? 'contains' : 'intersects';
            saveSelectionMode();
            updateModeSwitcherUI();
        });

        switcher.appendChild(rectBtn);
        switcher.appendChild(polyBtn);
        switcher.appendChild(sep);
        switcher.appendChild(ruleBtn);
        document.body.appendChild(switcher);
        modeSwitcherEl = switcher;

        updateModeSwitcherUI();
        positionModeSwitcher();

        // Reposition on resize
        window.addEventListener('resize', positionModeSwitcher, { passive: true });
    }

    function positionModeSwitcher() {
        if (!modeSwitcherEl) return;
        const viewport = document.querySelector('.ol-viewport');
        if (!viewport) return;
        const rect = viewport.getBoundingClientRect();
        modeSwitcherEl.style.top = (rect.top + 10) + 'px';
        modeSwitcherEl.style.left = (rect.left + 10) + 'px';
    }

    function updateModeSwitcherUI() {
        const rectBtn = document.getElementById('sel-btn-rectangle');
        const polyBtn = document.getElementById('sel-btn-polygon');
        const ruleBtn = document.getElementById('sel-btn-rule');
        if (rectBtn) rectBtn.classList.toggle('--active', selectionMode === 'rectangle');
        if (polyBtn) polyBtn.classList.toggle('--active', selectionMode === 'polygon');
        if (ruleBtn) {
            ruleBtn.textContent = selectionRule === 'intersects' ? '∩ Intersects' : '⊂ Contains';
            ruleBtn.classList.toggle('--active', selectionRule === 'contains');
        }
        // Update taskbar button if exists
        const tbBtn = document.getElementById('__3dg-btn-polygon-select');
        if (tbBtn) tbBtn.classList.toggle('--active', selectionMode === 'polygon');
    }

    // ==================== GEOMETRY UTILITIES ====================

    /**
     * Ray casting algorithm — check if point is inside polygon.
     * @param {number[]} point [x, y]
     * @param {number[][]} polygon [[x,y], [x,y], ...] (not closed — last != first)
     * @returns {boolean}
     */
    function pointInPolygon(point, polygon) {
        const x = point[0], y = point[1];
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i][0], yi = polygon[i][1];
            const xj = polygon[j][0], yj = polygon[j][1];
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        return inside;
    }

    /**
     * Check if two line segments intersect.
     * Segment 1: a1 → a2, Segment 2: b1 → b2
     * @returns {boolean}
     */
    function segmentsIntersect(a1, a2, b1, b2) {
        const d1 = direction(b1, b2, a1);
        const d2 = direction(b1, b2, a2);
        const d3 = direction(a1, a2, b1);
        const d4 = direction(a1, a2, b2);

        if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
            ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
            return true;
        }
        if (d1 === 0 && onSegment(b1, b2, a1)) return true;
        if (d2 === 0 && onSegment(b1, b2, a2)) return true;
        if (d3 === 0 && onSegment(a1, a2, b1)) return true;
        if (d4 === 0 && onSegment(a1, a2, b2)) return true;
        return false;
    }

    function direction(pi, pj, pk) {
        return (pk[0] - pi[0]) * (pj[1] - pi[1]) - (pj[0] - pi[0]) * (pk[1] - pi[1]);
    }

    function onSegment(pi, pj, pk) {
        return Math.min(pi[0], pj[0]) <= pk[0] && pk[0] <= Math.max(pi[0], pj[0]) &&
               Math.min(pi[1], pj[1]) <= pk[1] && pk[1] <= Math.max(pi[1], pj[1]);
    }

    /**
     * Get all coordinate points from an OL geometry (flattened).
     * Handles Point, LineString, Polygon, MultiPoint, MultiLineString, MultiPolygon.
     */
    function getGeometryCoords(geom) {
        const type = geom.getType();
        const coords = geom.getCoordinates();
        const points = [];

        switch (type) {
            case 'Point':
                points.push(coords);
                break;
            case 'MultiPoint':
            case 'LineString':
                for (const c of coords) points.push(c);
                break;
            case 'MultiLineString':
            case 'Polygon':
                for (const ring of coords) {
                    for (const c of ring) points.push(c);
                }
                break;
            case 'MultiPolygon':
                for (const poly of coords) {
                    for (const ring of poly) {
                        for (const c of ring) points.push(c);
                    }
                }
                break;
        }
        return points;
    }

    /**
     * Get all edges (line segments) from an OL geometry.
     * @returns {Array<[number[], number[]]>}
     */
    function getGeometryEdges(geom) {
        const type = geom.getType();
        const coords = geom.getCoordinates();
        const edges = [];

        function addEdgesFromRing(ring) {
            for (let i = 0; i < ring.length - 1; i++) {
                edges.push([ring[i], ring[i + 1]]);
            }
        }

        switch (type) {
            case 'Point':
            case 'MultiPoint':
                break; // no edges
            case 'LineString':
                addEdgesFromRing(coords);
                break;
            case 'MultiLineString':
                for (const line of coords) addEdgesFromRing(line);
                break;
            case 'Polygon':
                for (const ring of coords) addEdgesFromRing(ring);
                break;
            case 'MultiPolygon':
                for (const poly of coords) {
                    for (const ring of poly) addEdgesFromRing(ring);
                }
                break;
        }
        return edges;
    }

    /**
     * Build polygon edges from vertices array.
     * @param {number[][]} vertices - polygon vertices (auto-closed)
     * @returns {Array<[number[], number[]]>}
     */
    function getPolygonEdges(vertices) {
        const edges = [];
        for (let i = 0; i < vertices.length; i++) {
            edges.push([vertices[i], vertices[(i + 1) % vertices.length]]);
        }
        return edges;
    }

    /**
     * Check if selection polygon intersects a feature geometry.
     * Uses: any feature vertex inside polygon, any polygon vertex inside feature,
     * or any edge intersection.
     */
    function polygonIntersectsGeometry(selPoly, featureGeom) {
        const featureType = featureGeom.getType();

        // Point: simple point-in-polygon
        if (featureType === 'Point') {
            return pointInPolygon(featureGeom.getCoordinates(), selPoly);
        }

        // Check if any feature vertex is inside selection polygon
        const featureCoords = getGeometryCoords(featureGeom);
        for (const pt of featureCoords) {
            if (pointInPolygon(pt, selPoly)) return true;
        }

        // Check if any selection polygon vertex is inside feature geometry
        // (for Polygon features only)
        if (featureType === 'Polygon' || featureType === 'MultiPolygon') {
            const featureRings = featureType === 'Polygon'
                ? [featureGeom.getCoordinates()[0]]
                : featureGeom.getCoordinates().map(p => p[0]);

            for (const ring of featureRings) {
                // Remove closing point for PIP check
                const openRing = ring.length > 1 && ring[0][0] === ring[ring.length-1][0] && ring[0][1] === ring[ring.length-1][1]
                    ? ring.slice(0, -1) : ring;
                for (const selPt of selPoly) {
                    if (pointInPolygon(selPt, openRing)) return true;
                }
            }
        }

        // Edge intersection check
        const selEdges = getPolygonEdges(selPoly);
        const featureEdges = getGeometryEdges(featureGeom);
        for (const [sa, sb] of selEdges) {
            for (const [fa, fb] of featureEdges) {
                if (segmentsIntersect(sa, sb, fa, fb)) return true;
            }
        }

        return false;
    }

    /**
     * Check if selection polygon fully contains a feature geometry.
     * All feature vertices must be inside the polygon.
     */
    function polygonContainsGeometry(selPoly, featureGeom) {
        const featureCoords = getGeometryCoords(featureGeom);
        if (featureCoords.length === 0) return false;
        for (const pt of featureCoords) {
            if (!pointInPolygon(pt, selPoly)) return false;
        }
        return true;
    }

    /**
     * Calculate bounding box of polygon vertices.
     * @returns {number[]} [minX, minY, maxX, maxY]
     */
    function getPolygonExtent(vertices) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [x, y] of vertices) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }
        return [minX, minY, maxX, maxY];
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

    /**
     * Query features that intersect or are contained by a polygon.
     * Step 1: Spatial filter using bounding box
     * Step 2: Precise geometry check using ray-casting / segment intersection
     * @param {number[][]} vertices - polygon vertices in map coordinates
     * @returns {Array<{feature, source, layer}>}
     */
    function queryFeaturesInPolygon(vertices) {
        if (vertices.length < 3) return [];

        const extent = getPolygonExtent(vertices);
        const found = [];
        const seen = new Set();
        const checkFn = selectionRule === 'contains' ? polygonContainsGeometry : polygonIntersectsGeometry;

        for (const { layer, source } of collectLayerSources()) {
            try {
                // Step 1: Spatial index — get candidates from bounding box
                const candidates = typeof source.getFeaturesInExtent === 'function'
                    ? source.getFeaturesInExtent(extent)
                    : source.getFeatures();

                // Step 2: Precise geometry check
                for (const f of candidates) {
                    if (seen.has(f)) continue;
                    const geom = f.getGeometry?.();
                    if (!geom) continue;

                    // Quick reject: feature bbox doesn't intersect polygon bbox
                    if (!geom.intersectsExtent?.(extent)) continue;

                    if (checkFn(vertices, geom)) {
                        seen.add(f);
                        found.push({ feature: f, source, layer });
                    }
                }
            } catch (e) {
                log('Polygon query error:', e);
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

    /**
     * Save current selection state for undo
     */
    function pushSelectionHistory() {
        const snapshot = selectedFeatures.map(e => ({
            featureId: e.featureId || e.feature.getId?.(),
            featureRef: e.feature,
            originalStyle: e.originalStyle,
            source: e.source,
            layer: e.layer
        }));
        selectionHistory.push(snapshot);
        if (selectionHistory.length > MAX_SELECTION_HISTORY) {
            selectionHistory.shift();
        }
    }

    function clearSelection() {
        for (const entry of selectedFeatures) {
            try { entry.feature.setStyle(entry.originalStyle); } catch (e) {}
        }
        selectedFeatures.length = 0;
        olMap?.render?.();
    }

    /**
     * Undo last selection change (Ctrl+Z on selection)
     */
    function undoSelection() {
        if (selectionHistory.length === 0) return false;

        // Clear current selection
        for (const entry of selectedFeatures) {
            try { entry.feature.setStyle(entry.originalStyle); } catch (e) {}
        }
        selectedFeatures.length = 0;

        // Restore previous
        const prevSnapshot = selectionHistory.pop();
        for (const entry of prevSnapshot) {
            try {
                // Verify feature still exists
                const geom = entry.featureRef.getGeometry?.();
                if (!geom) continue;

                const originalStyle = entry.featureRef.getStyle?.() ?? null;
                const baseStyle = originalStyle || entry.layer?.getStyle?.() || null;
                entry.featureRef.setStyle(createHighlightStyleFn(baseStyle));

                selectedFeatures.push({
                    feature: entry.featureRef,
                    source: entry.source,
                    layer: entry.layer,
                    originalStyle: entry.originalStyle,
                    featureId: entry.featureId
                });
            } catch (e) {}
        }

        olMap?.render?.();
        showSelToast(`↩️ Undo selection — ${selectedFeatures.length} features`, 'info');
        return true;
    }

    // Expose cho inject.js gọi khi Ctrl+Z
    window.__clearSelection = clearSelection;
    window.__undoSelection = undoSelection;
    window.__selectionHistory = selectionHistory;

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

    // ==================== POLYGON DRAWING ====================

    function createPolygonCanvas(viewport) {
        if (polygonCanvas) return;
        polygonCanvas = document.createElement('canvas');
        polygonCanvas.id = 'sel-polygon-canvas';
        viewport.appendChild(polygonCanvas);
        resizePolygonCanvas(viewport);
        polygonCtx = polygonCanvas.getContext('2d');
    }

    function resizePolygonCanvas(viewport) {
        if (!polygonCanvas) return;
        const rect = viewport.getBoundingClientRect();
        polygonCanvas.width = rect.width * (window.devicePixelRatio || 1);
        polygonCanvas.height = rect.height * (window.devicePixelRatio || 1);
        polygonCanvas.style.width = rect.width + 'px';
        polygonCanvas.style.height = rect.height + 'px';
    }

    function removePolygonCanvas() {
        if (_polyAnimFrame) {
            cancelAnimationFrame(_polyAnimFrame);
            _polyAnimFrame = null;
        }
        if (polygonCanvas) {
            polygonCanvas.remove();
            polygonCanvas = null;
            polygonCtx = null;
        }
    }

    function removePolygonTooltip() {
        const tip = document.getElementById('sel-poly-tooltip');
        if (tip) tip.remove();
    }

    /**
     * Convert map coordinate → canvas pixel
     */
    function mapToCanvasPixel(coord) {
        if (!olMap || !polygonCanvas) return null;
        const pixel = olMap.getPixelFromCoordinate(coord);
        if (!pixel) return null;
        const dpr = window.devicePixelRatio || 1;
        return [pixel[0] * dpr, pixel[1] * dpr];
    }

    /**
     * Render the polygon overlay on canvas.
     * Called every animation frame while drawing.
     */
    function renderPolygonOverlay() {
        if (!polygonCtx || !polygonCanvas) return;

        const dpr = window.devicePixelRatio || 1;
        const w = polygonCanvas.width;
        const h = polygonCanvas.height;
        polygonCtx.clearRect(0, 0, w, h);

        if (polygonVertices.length === 0) return;

        // Convert all vertices to canvas pixels
        const pixelVertices = polygonVertices.map(mapToCanvasPixel).filter(Boolean);
        if (pixelVertices.length === 0) return;

        const mousePixel = currentMouseCoord ? mapToCanvasPixel(currentMouseCoord) : null;

        // Check if mouse is near first vertex (close polygon hint)
        let nearFirst = false;
        if (mousePixel && pixelVertices.length >= 3) {
            const dx = mousePixel[0] - pixelVertices[0][0];
            const dy = mousePixel[1] - pixelVertices[0][1];
            nearFirst = Math.sqrt(dx * dx + dy * dy) < POLY_CLOSE_DISTANCE * dpr;
        }

        // Draw filled polygon (including preview edge to mouse)
        polygonCtx.beginPath();
        polygonCtx.moveTo(pixelVertices[0][0], pixelVertices[0][1]);
        for (let i = 1; i < pixelVertices.length; i++) {
            polygonCtx.lineTo(pixelVertices[i][0], pixelVertices[i][1]);
        }
        if (mousePixel && !nearFirst) {
            polygonCtx.lineTo(mousePixel[0], mousePixel[1]);
        }
        polygonCtx.closePath();
        polygonCtx.fillStyle = POLY_FILL;
        polygonCtx.fill();

        // Draw polygon outline (solid edges between vertices)
        polygonCtx.beginPath();
        polygonCtx.moveTo(pixelVertices[0][0], pixelVertices[0][1]);
        for (let i = 1; i < pixelVertices.length; i++) {
            polygonCtx.lineTo(pixelVertices[i][0], pixelVertices[i][1]);
        }
        polygonCtx.strokeStyle = POLY_STROKE;
        polygonCtx.lineWidth = 2 * dpr;
        polygonCtx.stroke();

        // Draw preview edge (dashed line from last vertex to cursor)
        if (mousePixel) {
            const lastPx = pixelVertices[pixelVertices.length - 1];
            polygonCtx.beginPath();
            polygonCtx.moveTo(lastPx[0], lastPx[1]);
            if (nearFirst) {
                polygonCtx.lineTo(pixelVertices[0][0], pixelVertices[0][1]);
            } else {
                polygonCtx.lineTo(mousePixel[0], mousePixel[1]);
            }
            polygonCtx.setLineDash([6 * dpr, 4 * dpr]);
            polygonCtx.strokeStyle = POLY_STROKE;
            polygonCtx.lineWidth = 1.5 * dpr;
            polygonCtx.stroke();
            polygonCtx.setLineDash([]);

            // Also draw closing preview (dashed from mouse to first vertex)
            if (!nearFirst && pixelVertices.length >= 2) {
                polygonCtx.beginPath();
                polygonCtx.moveTo(mousePixel[0], mousePixel[1]);
                polygonCtx.lineTo(pixelVertices[0][0], pixelVertices[0][1]);
                polygonCtx.setLineDash([4 * dpr, 6 * dpr]);
                polygonCtx.strokeStyle = 'rgba(147, 51, 234, 0.35)';
                polygonCtx.lineWidth = 1 * dpr;
                polygonCtx.stroke();
                polygonCtx.setLineDash([]);
            }
        }

        // Draw vertex handles
        for (let i = 0; i < pixelVertices.length; i++) {
            const [px, py] = pixelVertices[i];
            const radius = POLY_VERTEX_RADIUS * dpr;
            const isFirst = i === 0;

            polygonCtx.beginPath();
            polygonCtx.arc(px, py, radius, 0, Math.PI * 2);
            polygonCtx.fillStyle = isFirst && nearFirst ? '#fbbf24' : '#ffffff';
            polygonCtx.fill();
            polygonCtx.strokeStyle = isFirst && nearFirst ? '#f59e0b' : POLY_STROKE;
            polygonCtx.lineWidth = 2 * dpr;
            polygonCtx.stroke();
        }

        // Show cursor dot at mouse position
        if (mousePixel && !nearFirst) {
            polygonCtx.beginPath();
            polygonCtx.arc(mousePixel[0], mousePixel[1], 3 * dpr, 0, Math.PI * 2);
            polygonCtx.fillStyle = POLY_STROKE;
            polygonCtx.fill();
        }
    }

    /**
     * Start polygon drawing animation loop
     */
    function startPolygonRenderLoop() {
        function frame() {
            renderPolygonOverlay();
            _polyAnimFrame = requestAnimationFrame(frame);
        }
        _polyAnimFrame = requestAnimationFrame(frame);
    }

    /**
     * Finish polygon drawing and execute selection
     * @param {boolean} additive - if true, add to existing selection
     */
    function finishPolygonSelection(additive) {
        if (polygonVertices.length < 3) {
            showSelToast('⚠️ Polygon cần ít nhất 3 điểm', 'error');
            cancelPolygonDrawing();
            return;
        }

        const vertices = [...polygonVertices];
        log('Finish polygon with', vertices.length, 'vertices');

        // Clean up drawing
        isDrawingPolygon = false;
        polygonVertices = [];
        currentMouseCoord = null;
        removePolygonCanvas();
        removePolygonTooltip();

        // Save current selection for undo
        pushSelectionHistory();

        // Clear or keep selection based on additive flag
        if (!additive) {
            clearSelection();
        }

        // Query features
        const t0 = performance.now();
        const found = queryFeaturesInPolygon(vertices);
        const dt = (performance.now() - t0).toFixed(1);

        if (found.length > 0) {
            // Dedup: skip features already in selectedFeatures
            const alreadySelected = new Set(selectedFeatures.map(e => e.feature));
            const newFound = found.filter(f => !alreadySelected.has(f.feature));

            if (newFound.length > 0) {
                highlightFeatures(newFound);
                olMap.render();
            }

            const totalSelected = selectedFeatures.length;
            showSelToast(
                `✅ Đã chọn ${found.length} feature${found.length > 1 ? 's' : ''} (${dt}ms) — Del: xóa | Ctrl+E: export | Esc: bỏ chọn`,
                'info'
            );
            console.log(`[Selection] ✅ Polygon selected ${found.length} features in ${dt}ms (total: ${totalSelected})`);
        } else {
            showSelToast(`Không tìm thấy feature nào trong polygon (${dt}ms)`, 'info');
        }

        // Re-enable interactions
        const viewport = document.querySelector('.ol-viewport');
        if (viewport) viewport.classList.remove('sel-mode');
        enableMapInteractions();
    }

    /**
     * Cancel polygon drawing without selecting
     */
    function cancelPolygonDrawing() {
        isDrawingPolygon = false;
        polygonVertices = [];
        currentMouseCoord = null;
        removePolygonCanvas();
        removePolygonTooltip();

        const viewport = document.querySelector('.ol-viewport');
        if (viewport) viewport.classList.remove('sel-mode');
        enableMapInteractions();

        log('Polygon drawing cancelled');
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
        let lastClickTime = 0; // for double-click detection in polygon mode

        // Drag detection for polygon mode — distinguish click (add vertex) vs drag (pan map)
        let _polyMouseDownPos = null;  // {x, y} screen position at mousedown
        const DRAG_THRESHOLD = 5;      // pixel threshold to distinguish click from drag

        // Tooltip element for polygon mode
        function getOrCreateTooltip() {
            let tip = document.getElementById('sel-poly-tooltip');
            if (!tip) {
                tip = document.createElement('div');
                tip.id = 'sel-poly-tooltip';
                viewport.appendChild(tip);
            }
            return tip;
        }

        // Gộp tất cả keydown logic vào 1 listener duy nhất
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Shift') {
                shiftHeld = true;
                viewport.classList.add('sel-mode');
                disableMapInteractions();

                // In polygon mode, prepare canvas
                if (selectionMode === 'polygon' && !isDrawingPolygon) {
                    // Don't start drawing on Shift alone; wait for first click
                }
            }

            // Enter → finish polygon
            if (e.key === 'Enter' && isDrawingPolygon) {
                e.preventDefault();
                e.stopPropagation();
                finishPolygonSelection(shiftHeld);
                return;
            }

            // Esc → cancel polygon drawing OR clear selection
            if (e.key === 'Escape') {
                if (isDrawingPolygon) {
                    e.preventDefault();
                    e.stopPropagation();
                    cancelPolygonDrawing();
                    return;
                }
                if (selectedFeatures.length > 0) {
                    pushSelectionHistory();
                    clearSelection();
                }
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
                // Don't remove sel-mode or enable interactions if polygon drawing is in progress
                if (!isSelecting && !isDrawingPolygon) {
                    viewport.classList.remove('sel-mode');
                    enableMapInteractions();
                }
            }
        });

        // ==================== MOUSEDOWN ====================
        viewport.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;

            // Polygon mode: record mousedown position for drag detection
            // but DON'T stop propagation — let OL handle DragPan
            if (selectionMode === 'polygon' && (shiftHeld || isDrawingPolygon)) {
                _polyMouseDownPos = { x: e.clientX, y: e.clientY };
                return;
            }

            // Rectangle mode
            if (!shiftHeld || selectionMode !== 'rectangle') return;

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

            pushSelectionHistory();
            clearSelection();
        }, true);

        // ==================== CLICK (Polygon Mode) ====================
        viewport.addEventListener('click', (e) => {
            if (e.button !== 0) return;
            if (selectionMode !== 'polygon') return;
            if (!shiftHeld && !isDrawingPolygon) return;

            // Drag detection: if mouse moved significantly since mousedown, this was a pan → skip
            if (_polyMouseDownPos) {
                const dx = Math.abs(e.clientX - _polyMouseDownPos.x);
                const dy = Math.abs(e.clientY - _polyMouseDownPos.y);
                _polyMouseDownPos = null;
                if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
                    // This was a drag (map pan), not a click — don't add vertex
                    log('Drag detected, skipping vertex');
                    return;
                }
            }

            e.stopPropagation();
            e.preventDefault();

            // Get map coordinate from click
            const vrect = viewport.getBoundingClientRect();
            const px = [e.clientX - vrect.left, e.clientY - vrect.top];
            const coord = olMap.getCoordinateFromPixel(px);
            if (!coord) return;

            // Double-click detection
            const now = Date.now();
            const isDoubleClick = (now - lastClickTime) < 350;
            lastClickTime = now;

            if (isDoubleClick && isDrawingPolygon && polygonVertices.length >= 3) {
                // Don't add the double-click point, just finish
                finishPolygonSelection(shiftHeld);
                return;
            }

            if (!isDrawingPolygon) {
                // Start polygon drawing
                isDrawingPolygon = true;
                polygonVertices = [coord];
                currentMouseCoord = coord;

                createPolygonCanvas(viewport);
                startPolygonRenderLoop();
                log('Polygon drawing started at', coord);

                showSelToast('🔷 Click để thêm đỉnh | Double-click hoặc Enter để hoàn tất | Esc để hủy', 'info');
            } else {
                // Check if clicking near first vertex → close polygon
                const firstPx = olMap.getPixelFromCoordinate(polygonVertices[0]);
                if (firstPx && polygonVertices.length >= 3) {
                    const dist = Math.sqrt(
                        Math.pow(px[0] - firstPx[0], 2) + Math.pow(px[1] - firstPx[1], 2)
                    );
                    if (dist < POLY_CLOSE_DISTANCE) {
                        finishPolygonSelection(shiftHeld);
                        return;
                    }
                }

                // Add vertex
                polygonVertices.push(coord);
                log('Vertex added:', polygonVertices.length, coord);
            }
        }, true);

        // ==================== DBLCLICK (Polygon Mode) ====================
        viewport.addEventListener('dblclick', (e) => {
            if (selectionMode !== 'polygon') return;
            if (!isDrawingPolygon) return;

            e.stopPropagation();
            e.preventDefault();

            if (polygonVertices.length >= 3) {
                finishPolygonSelection(shiftHeld);
            }
        }, true);

        // ==================== MOUSEMOVE ====================
        viewport.addEventListener('mousemove', (e) => {
            // Rectangle mode drag
            if (isSelecting && boxEl && startPixel) {
                e.stopPropagation();
                e.preventDefault();

                const cx = e.clientX - viewportRect.left;
                const cy = e.clientY - viewportRect.top;

                boxEl.style.left   = Math.min(startPixel.x, cx) + 'px';
                boxEl.style.top    = Math.min(startPixel.y, cy) + 'px';
                boxEl.style.width  = Math.abs(cx - startPixel.x) + 'px';
                boxEl.style.height = Math.abs(cy - startPixel.y) + 'px';
                return;
            }

            // Polygon mode: update cursor position for preview
            if (isDrawingPolygon && olMap) {
                const vrect = viewport.getBoundingClientRect();
                const px = [e.clientX - vrect.left, e.clientY - vrect.top];
                currentMouseCoord = olMap.getCoordinateFromPixel(px);

                // Update tooltip
                if (polygonVertices.length >= 3) {
                    const firstPx = olMap.getPixelFromCoordinate(polygonVertices[0]);
                    if (firstPx) {
                        const dist = Math.sqrt(
                            Math.pow(px[0] - firstPx[0], 2) + Math.pow(px[1] - firstPx[1], 2)
                        );
                        const tip = getOrCreateTooltip();
                        if (dist < POLY_CLOSE_DISTANCE) {
                            tip.textContent = 'Click để đóng polygon';
                            tip.style.left = (px[0] + 15) + 'px';
                            tip.style.top = px[1] + 'px';
                            tip.classList.add('--visible');
                        } else {
                            tip.classList.remove('--visible');
                        }
                    }
                }
            }
        }, true);

        // ==================== MOUSEUP (Rectangle Mode) ====================
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

        // ==================== RESIZE HANDLER ====================
        // Resize polygon canvas when viewport resizes
        const resizeObserver = new ResizeObserver(() => {
            if (polygonCanvas) {
                resizePolygonCanvas(viewport);
            }
            positionModeSwitcher();
        });
        resizeObserver.observe(viewport);

        // ==================== MAP MOVE HANDLER ====================
        // Re-render polygon overlay when map pans/zooms
        if (olMap) {
            olMap.on('moveend', () => {
                if (isDrawingPolygon && polygonCanvas) {
                    resizePolygonCanvas(viewport);
                }
            });
        }
    }

    // ==================== INIT ====================
    function initSelection() {
        // Ưu tiên dùng shared map từ inject.js
        olMap = window.__olMap || findOlMap();
        if (!olMap) { setTimeout(initSelection, 3000); return; }

        console.log('[Selection] ✅ Map found. Initializing selection tools...');

        loadSelectionMode();
        injectSelectionStyles();
        createToastContainer();
        setupBoxSelection();

        console.log(`[Selection] 🔲 Selection ready! Mode: ${selectionMode}. Shift+Drag/Click to select.`);
    }

})();
