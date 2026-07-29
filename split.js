// ============================================================
//  SPLIT TOOL v2 — Click-to-Split
//  Redesigned interaction: activate → move cursor → click to split
//  Real-time intersection detection within cursor radius.
//  Single-click to split. No box selection. No double-click.
// ============================================================

(function () {
    'use strict';

    const DEBUG = true;
    const TRACE = false;  // Extra-verbose per-frame logging (scan/marker details)
    function log(...args) { if (DEBUG) console.log('[Split]', ...args); }
    function trace(...args) { if (TRACE) console.log('[Split]', ...args); }

    let olMap = null;
    let isActive = false;

    // ── Configuration ────────────────────────────────────────
    const SCAN_RADIUS_PX = 80;       // Pixel radius around cursor to scan for intersections
    const CLICK_TOLERANCE_PX = 14;   // Pixel tolerance for clicking an intersection
    const THROTTLE_MOVE_PX = 3;      // Skip re-scan if cursor moved less than this
    const MARKER_RADIUS = 7;         // Default marker radius (px)
    const MARKER_RADIUS_READY = 10;  // Ready-to-split marker radius (px)
    const HYSTERESIS_PX = 5;         // Must be this many px closer to switch ready marker
    const CACHE_BUFFER_FACTOR = 1.5; // Cache extent = view extent × this factor

    // ── State ────────────────────────────────────────────────
    let _nearbyIntersections = [];     // [{coord, featureA, featureB, sourceA, sourceB}]
    let _readyIntersection = null;     // Closest intersection to cursor (the one that will be split)
    let _readyIntersectionDist = Infinity; // Distance to current ready intersection (for hysteresis)
    let _previewFeature = null;        // Feature currently highlighted for splitting
    let _previewSource = null;
    let _previewOriginalStyle = null;
    let _splitPointCoords = [];        // Coords of completed splits (for green highlight)
    let _lastScanPixel = null;         // Last cursor pixel where we scanned
    let _rafId = null;                 // requestAnimationFrame ID
    let _pendingEvent = null;          // Pending pointermove event for RAF

    // ── Global Intersection Cache ────────────────────────────
    let _globalCache = [];              // All intersections in the cached extent
    let _cacheExtent = null;            // [minX, minY, maxX, maxY] of cached area
    let _cacheGrid = null;              // GridIndex instance for spatial lookup
    let _cacheDirty = true;             // Needs rebuild?
    let _sourceListeners = [];          // Source event listener keys for cache invalidation

    // ── Feature Extent Cache (WeakMap) ────────────────────────
    const _extentCache = new WeakMap(); // feature → [minX, minY, maxX, maxY]

    // ── Marker overlays (OL Overlay instances) ───────────────
    let _markerOverlays = [];          // Active markers
    let _markerPool = [];              // Recycled (hidden) markers available for reuse

    // ── Listeners to cleanup on deactivate ───────────────────
    let _viewportClickHandler = null;
    let _viewportPointermoveHandler = null;
    let _moveEndKey = null;

    // ── Disabled interactions tracking ───────────────────────
    let _disabledInteractions = [];

    // ── Feature-Select Mode (multi-split) ─────────────────────
    var _featureSelectMode = false;
    var _selectedFeature = null;
    var _selectedSource = null;
    var _featureIntersections = [];    // all intersections for the selected feature
    var _selectedMarkerIndices = new Set(); // indices of selected markers (default: all)
    var _featureSelectToolbar = null;  // floating toolbar DOM
    var _featureHighlightStyle = null; // saved original style

    // ==================== FIND MAP ====================
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

    // ==================== COLLECT LINESTRINGS ====================
    function collectLineStrings(extent) {
        const results = [];
        function walk(layer) {
            if (layer.getLayers) { layer.getLayers().forEach(walk); return; }
            try {
                const src = layer.getSource?.();
                if (!src?.getFeatures) return;
                const features = extent && src.getFeaturesInExtent
                    ? src.getFeaturesInExtent(extent)
                    : src.getFeatures();
                for (const f of features) {
                    const geom = f.getGeometry?.();
                    if (geom && geom.getType() === 'LineString') {
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
    function segmentIntersection(p1, p2, p3, p4) {
        const dx1 = p2[0] - p1[0];
        const dy1 = p2[1] - p1[1];
        const dx2 = p4[0] - p3[0];
        const dy2 = p4[1] - p3[1];

        const denom = dx1 * dy2 - dy1 * dx2;

        const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
        const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
        const scale = len1 * len2;
        if (scale < 1e-20) return null;
        if (Math.abs(denom) / scale < 1e-10) return null;

        const dx3 = p3[0] - p1[0];
        const dy3 = p3[1] - p1[1];

        const t = (dx3 * dy2 - dy3 * dx2) / denom;
        const u = (dx3 * dy1 - dy3 * dx1) / denom;

        const EPS = 1e-6;
        if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;

        const tc = Math.max(0, Math.min(1, t));

        return [
            p1[0] + tc * dx1,
            p1[1] + tc * dy1
        ];
    }

    // ==================== FEATURE EXTENT CACHE ====================
    function getCachedExtent(feature) {
        let ext = _extentCache.get(feature);
        if (!ext) {
            ext = feature.getGeometry().getExtent();
            _extentCache.set(feature, ext);
        }
        return ext;
    }

    // ==================== FIND INTERSECTIONS IN EXTENT ====================
    // Returns array of {coord, featureA, featureB, sourceA, sourceB}
    function findIntersectionsInExtent(extent) {
        const allLines = collectLineStrings(extent);
        const results = [];

        // Use a Set-based dedup via rounded coordinate keys (much faster than O(R²) scan)
        const dedupSet = new Set();
        const DEDUP_PRECISION = 1e8; // Round to ~10nm for dedup key
        function dedupKey(pt) {
            return (Math.round(pt[0] * DEDUP_PRECISION)) + ',' + (Math.round(pt[1] * DEDUP_PRECISION));
        }

        for (let a = 0; a < allLines.length; a++) {
            const coordsA = allLines[a].feature.getGeometry().getCoordinates();
            const extA = getCachedExtent(allLines[a].feature);

            for (let b = a + 1; b < allLines.length; b++) {
                const extB = getCachedExtent(allLines[b].feature);

                // Pre-filter: skip if bounding boxes don't overlap
                if (extA[2] < extB[0] || extA[0] > extB[2] ||
                    extA[3] < extB[1] || extA[1] > extB[3]) continue;

                const coordsB = allLines[b].feature.getGeometry().getCoordinates();

                for (let i = 0; i < coordsA.length - 1; i++) {
                    for (let j = 0; j < coordsB.length - 1; j++) {
                        const pt = segmentIntersection(
                            coordsA[i], coordsA[i + 1],
                            coordsB[j], coordsB[j + 1]
                        );
                        if (pt) {
                            const key = dedupKey(pt);
                            if (dedupSet.has(key)) continue;
                            // Filter: intersection must be within extent
                            if (extent) {
                                if (pt[0] < extent[0] || pt[0] > extent[2] ||
                                    pt[1] < extent[1] || pt[1] > extent[3]) continue;
                            }
                            dedupSet.add(key);
                            results.push({
                                coord: pt,
                                featureA: allLines[a].feature,
                                featureB: allLines[b].feature,
                                sourceA: allLines[a].source,
                                sourceB: allLines[b].source
                            });
                        }
                    }
                }
            }
        }

        return results;
    }

    // ==================== GRID SPATIAL INDEX ====================
    // Simple grid index for fast spatial queries on intersection points
    function GridIndex(cellSize) {
        this.cellSize = cellSize;
        this.grid = new Map();
    }

    GridIndex.prototype._cellKey = function (coord) {
        var cx = Math.floor(coord[0] / this.cellSize);
        var cy = Math.floor(coord[1] / this.cellSize);
        return cx + ',' + cy;
    };

    GridIndex.prototype.insert = function (item) {
        var key = this._cellKey(item.coord);
        var cell = this.grid.get(key);
        if (!cell) { cell = []; this.grid.set(key, cell); }
        cell.push(item);
    };

    GridIndex.prototype.query = function (extent) {
        var results = [];
        var minCX = Math.floor(extent[0] / this.cellSize);
        var minCY = Math.floor(extent[1] / this.cellSize);
        var maxCX = Math.floor(extent[2] / this.cellSize);
        var maxCY = Math.floor(extent[3] / this.cellSize);

        for (var cx = minCX; cx <= maxCX; cx++) {
            for (var cy = minCY; cy <= maxCY; cy++) {
                var cell = this.grid.get(cx + ',' + cy);
                if (cell) {
                    for (var i = 0; i < cell.length; i++) {
                        var c = cell[i].coord;
                        if (c[0] >= extent[0] && c[0] <= extent[2] &&
                            c[1] >= extent[1] && c[1] <= extent[3]) {
                            results.push(cell[i]);
                        }
                    }
                }
            }
        }
        return results;
    };

    GridIndex.prototype.clear = function () {
        this.grid.clear();
    };

    // ==================== GLOBAL INTERSECTION CACHE ====================

    function rebuildIntersectionCache() {
        if (!olMap || !isActive) return;

        var t0 = performance.now();

        var view = olMap.getView();
        var viewExtent = view.calculateExtent(olMap.getSize());
        var resolution = view.getResolution();

        // Expand view extent by buffer factor
        var bufW = (viewExtent[2] - viewExtent[0]) * (CACHE_BUFFER_FACTOR - 1) / 2;
        var bufH = (viewExtent[3] - viewExtent[1]) * (CACHE_BUFFER_FACTOR - 1) / 2;
        _cacheExtent = [
            viewExtent[0] - bufW,
            viewExtent[1] - bufH,
            viewExtent[2] + bufW,
            viewExtent[3] + bufH
        ];

        // Compute all intersections in the buffered extent
        _globalCache = findIntersectionsInExtent(_cacheExtent);

        // Build spatial index
        // Cell size = scan radius in map units (so a query hits ~1-4 cells)
        var cellSize = SCAN_RADIUS_PX * resolution;
        if (cellSize < 1) cellSize = 1;
        _cacheGrid = new GridIndex(cellSize);
        for (var i = 0; i < _globalCache.length; i++) {
            _cacheGrid.insert(_globalCache[i]);
        }

        _cacheDirty = false;

        var elapsed = (performance.now() - t0).toFixed(1);
        log('[Cache] Rebuilt:', _globalCache.length, 'intersections in', elapsed + 'ms',
            '(extent:', _cacheExtent.map(function(v){return v.toFixed(0);}).join(', '), ')');
    }

    function invalidateCache() {
        _cacheDirty = true;
        // Clear WeakMap extent cache too
        // (WeakMap doesn't have a clear method, so we just create a new one)
        // Actually we can't reassign const, so we leave it — entries auto-expire when features are GC'd
    }

    function queryCacheNearCursor(cursorCoord, radiusMap) {
        if (!_cacheGrid) return [];

        var queryExtent = [
            cursorCoord[0] - radiusMap,
            cursorCoord[1] - radiusMap,
            cursorCoord[0] + radiusMap,
            cursorCoord[1] + radiusMap
        ];

        return _cacheGrid.query(queryExtent);
    }

    // Check if cursor is still within the cached extent (with some margin)
    function isCursorInCacheExtent(cursorCoord, radiusMap) {
        if (!_cacheExtent) return false;
        return cursorCoord[0] - radiusMap >= _cacheExtent[0] &&
               cursorCoord[0] + radiusMap <= _cacheExtent[2] &&
               cursorCoord[1] - radiusMap >= _cacheExtent[1] &&
               cursorCoord[1] + radiusMap <= _cacheExtent[3];
    }

    // Wire up cache invalidation listeners on all sources
    function startCacheInvalidationListeners() {
        stopCacheInvalidationListeners();

        var sources = new Set();
        function walk(layer) {
            if (layer.getLayers) { layer.getLayers().forEach(walk); return; }
            try {
                var src = layer.getSource?.();
                if (src?.getFeatures) sources.add(src);
            } catch (e) { }
        }
        try { olMap.getLayers().forEach(walk); } catch (e) { }

        sources.forEach(function (src) {
            try {
                var key1 = src.on('addfeature', invalidateCache);
                var key2 = src.on('removefeature', invalidateCache);
                var key3 = src.on('changefeature', invalidateCache);
                _sourceListeners.push({ source: src, keys: [key1, key2, key3] });
            } catch (e) { }
        });

        // Also listen for our custom event
        document.addEventListener('3dg:features-changed', invalidateCache);
    }

    function stopCacheInvalidationListeners() {
        for (var i = 0; i < _sourceListeners.length; i++) {
            var entry = _sourceListeners[i];
            for (var j = 0; j < entry.keys.length; j++) {
                try {
                    // OL returns event key objects from .on()
                    if (typeof entry.keys[j] === 'object' && entry.keys[j]) {
                        entry.source.un(entry.keys[j].type, entry.keys[j].listener);
                    }
                } catch (e) { }
            }
        }
        _sourceListeners = [];
        document.removeEventListener('3dg:features-changed', invalidateCache);
    }

    // ==================== INSERT VERTEX IF NEEDED ====================
    function insertVertexIfNeeded(coords, splitPoint) {
        const EPS = 1e-9;

        for (let i = 0; i < coords.length; i++) {
            if (Math.abs(coords[i][0] - splitPoint[0]) < EPS &&
                Math.abs(coords[i][1] - splitPoint[1]) < EPS) {
                return i;
            }
        }

        for (let i = 0; i < coords.length - 1; i++) {
            const p1 = coords[i];
            const p2 = coords[i + 1];

            const dx = p2[0] - p1[0];
            const dy = p2[1] - p1[1];
            const lenSq = dx * dx + dy * dy;
            if (lenSq < EPS) continue;

            const t = ((splitPoint[0] - p1[0]) * dx + (splitPoint[1] - p1[1]) * dy) / lenSq;
            if (t < -0.01 || t > 1.01) continue;

            const projX = p1[0] + t * dx;
            const projY = p1[1] + t * dy;
            const distSq = (splitPoint[0] - projX) ** 2 + (splitPoint[1] - projY) ** 2;

            if (distSq < 1e-6) {
                coords.splice(i + 1, 0, [splitPoint[0], splitPoint[1]]);
                return i + 1;
            }
        }

        return -1;
    }

    // ==================== SPLIT LINE ====================
    function splitLine(coords, splitIndex) {
        if (splitIndex <= 0 || splitIndex >= coords.length - 1) {
            return null;
        }

        const part1 = coords.slice(0, splitIndex + 1);
        const part2 = coords.slice(splitIndex);

        if (part1.length < 2 || part2.length < 2) return null;

        return [part1, part2];
    }

    // ==================== SPLIT LINE AT MULTIPLE POINTS ====================
    // splitIndices must be sorted ascending, all must be > 0 and < coords.length-1
    function splitLineMulti(coords, splitIndices) {
        if (!splitIndices || splitIndices.length === 0) return null;

        var parts = [];
        var prev = 0;
        for (var i = 0; i < splitIndices.length; i++) {
            var idx = splitIndices[i];
            if (idx <= prev || idx >= coords.length) continue;
            parts.push(coords.slice(prev, idx + 1));
            prev = idx;
        }
        // Last part
        parts.push(coords.slice(prev));

        // Filter: remove parts with < 2 coords
        parts = parts.filter(function (p) { return p.length >= 2; });
        return parts.length >= 2 ? parts : null;
    }

    // ==================== FIND INTERSECTIONS FOR A FEATURE ====================
    function findIntersectionsForFeature(targetFeature) {
        if (!_globalCache || _globalCache.length === 0) return [];

        var results = [];
        var dedupSet = new Set();

        for (var i = 0; i < _globalCache.length; i++) {
            var ix = _globalCache[i];
            if (ix.featureA === targetFeature || ix.featureB === targetFeature) {
                var key = coordKey(ix.coord);
                if (!dedupSet.has(key)) {
                    dedupSet.add(key);
                    results.push(ix);
                }
            }
        }

        return results;
    }

    // ==================== SPLIT FEATURE (REACT-SYNCED, HIDDEN MODAL) ====================
    //
    // STRATEGY:
    // 1) Delete old feature via DOM click (React knows about the removal)
    // 2) Import 2 new features via GeoJSON file input (React creates sidebar rows)
    // 3) The "Add" modal is hidden via injected CSS — user never sees it
    // 4) A MutationObserver auto-clicks the hidden modal's confirm button
    //
    // This ensures full React state sync (features selectable individually)
    // while making the operation appear instant and modal-free to the user.
    //

    // ── CSS cloak: hides Ant Design modals completely ──
    var _modalCloakStyle = null;

    function cloakModals() {
        if (_modalCloakStyle) return;
        _modalCloakStyle = document.createElement('style');
        _modalCloakStyle.id = '__split-modal-cloak';
        _modalCloakStyle.textContent = [
            '.ant-modal-root { opacity:0!important; height:0!important; overflow:hidden!important; pointer-events:auto!important; }',
            '.ant-modal-mask { opacity:0!important; }',
            '.ant-modal-wrap { opacity:0!important; }',
            '.ant-modal { opacity:0!important; }'
        ].join('\n');
        document.head.appendChild(_modalCloakStyle);
    }

    function uncloakModals() {
        if (_modalCloakStyle) {
            _modalCloakStyle.remove();
            _modalCloakStyle = null;
        }
    }

    // ── Modal auto-clicker (works even when modal is hidden via CSS) ──
    var _modalObserver = null;

    function startModalAutoClick() {
        if (_modalObserver) return;

        _modalObserver = new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
                var added = mutations[i].addedNodes;
                for (var j = 0; j < added.length; j++) {
                    var node = added[j];
                    if (!node.querySelectorAll) continue;

                    // CRITICAL: Find "Thêm vào" (Add) button, NOT "Thay thế" (Replace)!
                    // The modal has 3 buttons: Huỷ | Thêm vào | Thay thế
                    // "Thay thế" is ant-btn-primary and would REPLACE ALL features!
                    clickAddButton(node);
                }
            }
        });

        _modalObserver.observe(document.body, { childList: true, subtree: true });
    }

    // Find and click the "Thêm vào" / "Add" button (NOT "Thay thế" / "Replace")
    function clickAddButton(container) {
        var buttons = container.querySelectorAll('button');
        for (var i = 0; i < buttons.length; i++) {
            var text = (buttons[i].textContent || '').trim().toLowerCase();
            if (text === 'thêm vào' || text === 'add' || text === 'thêm') {
                console.log('[Split] Auto-clicking "Thêm vào" button');
                try { buttons[i].click(); } catch (e) { }
                return true;
            }
        }
        return false;
    }

    function stopModalAutoClick() {
        if (_modalObserver) {
            _modalObserver.disconnect();
            _modalObserver = null;
        }
    }

    // ── GeoJSON import helpers ──

    function findGeoJSONInput() {
        return document.querySelector('input[accept*=".geojson"]')
            || document.querySelector('input[accept*="geojson"]')
            || document.querySelector('input[accept*=".json"]')
            || document.querySelector('input[accept*="geo+json"]')
            || document.querySelector('input[type="file"][accept]');
    }

    function importFeaturesViaGeoJSON(coordsList) {
        var features = coordsList.map(function (coords) {
            return {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: coords },
                properties: null
            };
        });

        var geojson = {
            type: 'FeatureCollection',
            features: features
        };

        var input = findGeoJSONInput();
        if (!input) {
            console.warn('[Split] GeoJSON input not found');
            return false;
        }

        var blob = new Blob([JSON.stringify(geojson)], { type: 'application/geo+json' });
        var file = new File([blob], 'split.geojson', { type: 'application/geo+json' });
        var dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));

        console.log('[Split] Imported', features.length, 'features via GeoJSON');
        return true;
    }

    // ── Split feature ──

    function splitFeature(targetFeature, parts, source) {
        var oldId = targetFeature.getId?.();
        var oldProps = targetFeature.getProperties();
        delete oldProps.geometry;

        // Save original coords for undo
        var originalCoords = targetFeature.getGeometry().getCoordinates()
            .map(function (c) { return [c[0], c[1]]; });

        var undoEntry = {
            action: 'split',
            originalFeatureId: oldId,
            originalCoords: originalCoords,
            originalProperties: { ...oldProps },
            newFeatureIds: [],
            _source: source
        };

        console.log('[Split] Before: source has', source.getFeatures().length, 'features');

        // === Phase 1: Cloak modals + start auto-clicker ===
        cloakModals();
        startModalAutoClick();

        // === Phase 2: Delete old feature via DOM (React-aware) ===
        var deletedByDOM = false;
        if (oldId && window.__deleteFeatureByDOM) {
            deletedByDOM = window.__deleteFeatureByDOM(oldId);
            console.log('[Split] Delete via DOM:', deletedByDOM ? 'OK' : 'FAILED');
        }
        if (!deletedByDOM) {
            try {
                source.removeFeature(targetFeature);
                console.log('[Split] Removed via OL source (fallback)');
            } catch (e) {
                console.error('[Split] Error removing feature:', e);
                uncloakModals();
                stopModalAutoClick();
                return false;
            }
        }

        // === Phase 3: Import new features via GeoJSON (React-aware) ===
        var coordsToImport = parts.map(function (coords) {
            return coords.map(function (c) { return [c[0], c[1]]; });
        });

        // Track new feature IDs
        var addFeatureHandler = function (e) {
            var fid = e.feature?.getId?.();
            if (fid) undoEntry.newFeatureIds.push(fid);
        };
        try { source.on('addfeature', addFeatureHandler); } catch (e) { }

        var imported = importFeaturesViaGeoJSON(coordsToImport);

        if (!imported) {
            // Fallback: direct source add
            console.log('[Split] GeoJSON unavailable, adding directly');
            for (var i = 0; i < parts.length; i++) {
                var newFeature = targetFeature.clone();
                newFeature.getGeometry().setCoordinates(parts[i]);
                var newId = oldId
                    ? oldId + '_split_' + i + '_' + Date.now()
                    : 'split_' + Date.now() + '_' + i;
                newFeature.setId(newId);
                undoEntry.newFeatureIds.push(newId);
                source.addFeature(newFeature);
            }
        }

        // === Phase 4: Cleanup after React processes ===
        setTimeout(function () {
            try { source.un('addfeature', addFeatureHandler); } catch (e) { }
            stopModalAutoClick();

            // Also try clicking "Thêm vào" on any remaining visible modals
            var modals = document.querySelectorAll('.ant-modal-root, .ant-modal-wrap, .ant-modal');
            for (var i = 0; i < modals.length; i++) {
                clickAddButton(modals[i]);
            }

            // Uncloak after modal finishes closing
            setTimeout(function () {
                uncloakModals();
                console.log('[Split] After: source has', source.getFeatures().length, 'features');
                console.log('[Split] New feature IDs:', undoEntry.newFeatureIds);
            }, 500);
        }, 1500);

        // Push undo entry
        if (window.__undoStack) {
            window.__undoStack.push(undoEntry);
        }

        return true;
    }

    // ==================== FEATURE-SELECT MODE (MULTI-SPLIT) ====================

    function enterFeatureSelectMode(feature, source) {
        if (_featureSelectMode) exitFeatureSelectMode();

        _featureSelectMode = true;
        _selectedFeature = feature;
        _selectedSource = source;

        // Ensure cache is fresh
        if (_cacheDirty) rebuildIntersectionCache();

        // Find all intersections for this feature
        _featureIntersections = findIntersectionsForFeature(feature);

        if (_featureIntersections.length === 0) {
            showSplitToast('Đường này không có điểm giao nào', 'info');
            exitFeatureSelectMode();
            return;
        }

        // Select all by default
        _selectedMarkerIndices = new Set();
        for (var i = 0; i < _featureIntersections.length; i++) {
            _selectedMarkerIndices.add(i);
        }

        // Highlight the feature
        _featureHighlightStyle = feature.getStyle?.() || null;
        try {
            var baseStyle = _featureHighlightStyle || feature.get('__layerStyle') || null;
            feature.setStyle(function (f, res) {
                var styles = [];
                if (typeof baseStyle === 'function') {
                    var r = baseStyle(f, res);
                    styles = Array.isArray(r) ? r : (r ? [r] : []);
                } else if (baseStyle) {
                    styles = Array.isArray(baseStyle) ? baseStyle : [baseStyle];
                }
                if (styles.length === 0) {
                    var allL = collectLineStrings();
                    for (var e = 0; e < allL.length; e++) {
                        if (allL[e].feature === f) {
                            var layerStyle = allL[e].layer?.getStyle?.();
                            if (typeof layerStyle === 'function') {
                                var lr = layerStyle(f, res);
                                styles = Array.isArray(lr) ? lr : (lr ? [lr] : []);
                            } else if (layerStyle) {
                                styles = Array.isArray(layerStyle) ? layerStyle : [layerStyle];
                            }
                            break;
                        }
                    }
                }
                return styles.map(function (s) {
                    try {
                        var cloned = s.clone();
                        var stroke = cloned.getStroke?.();
                        if (stroke) {
                            stroke.setColor('rgba(255, 165, 0, 0.9)');
                            stroke.setWidth((s.getStroke?.()?.getWidth?.() || 2) + 4);
                            stroke.setLineDash([12, 6]);
                        }
                        return cloned;
                    } catch (err) { return s; }
                });
            });
        } catch (e) { }

        // Show markers at all intersection points
        showFeatureSelectMarkers();

        // Show floating toolbar
        showFeatureSelectToolbar();

        olMap.render();
        console.log('[Split] Entered feature-select mode:',
            feature.getId?.() || '(no id)',
            '|', _featureIntersections.length, 'intersections');
    }

    function exitFeatureSelectMode() {
        // Restore feature style
        if (_selectedFeature && _featureHighlightStyle !== undefined) {
            try { _selectedFeature.setStyle(_featureHighlightStyle); } catch (e) { }
        }

        // Remove toolbar
        if (_featureSelectToolbar) {
            try { _featureSelectToolbar.remove(); } catch (e) { }
            _featureSelectToolbar = null;
        }

        // Clear markers (restore normal scan-based markers)
        clearAllMarkers();

        _featureSelectMode = false;
        _selectedFeature = null;
        _selectedSource = null;
        _featureIntersections = [];
        _selectedMarkerIndices = new Set();
        _featureHighlightStyle = null;

        if (olMap) olMap.render();
        console.log('[Split] Exited feature-select mode');
    }

    function showFeatureSelectMarkers() {
        clearAllMarkers();

        for (var i = 0; i < _featureIntersections.length; i++) {
            var ix = _featureIntersections[i];
            var isSelected = _selectedMarkerIndices.has(i);
            var el = document.createElement('div');
            el.className = '__3dg-split-marker' + (isSelected ? ' --fs-selected' : ' --fs-deselected');
            el.setAttribute('data-fs-index', i);

            // Make markers clickable
            el.style.pointerEvents = 'auto';
            el.style.cursor = 'pointer';

            (function (idx) {
                el.addEventListener('click', function (e) {
                    e.stopPropagation();
                    e.preventDefault();
                    toggleMarkerSelection(idx);
                });
            })(i);

            var OverlayClass = _getOverlayClass();
            if (OverlayClass) {
                try {
                    var overlay = new OverlayClass({
                        element: el,
                        position: ix.coord,
                        positioning: 'center-center',
                        stopEvent: false
                    });
                    olMap.addOverlay(overlay);
                    _markerOverlays.push({ overlay: overlay, coord: ix.coord, element: el, isDom: false, key: coordKey(ix.coord) });
                } catch (e) { }
            }
        }
    }

    function toggleMarkerSelection(index) {
        if (_selectedMarkerIndices.has(index)) {
            _selectedMarkerIndices.delete(index);
        } else {
            _selectedMarkerIndices.add(index);
        }

        // Update marker visuals
        var markers = document.querySelectorAll('.__3dg-split-marker[data-fs-index]');
        for (var i = 0; i < markers.length; i++) {
            var idx = parseInt(markers[i].getAttribute('data-fs-index'));
            if (isNaN(idx)) continue;
            var isSelected = _selectedMarkerIndices.has(idx);
            markers[i].classList.toggle('--fs-selected', isSelected);
            markers[i].classList.toggle('--fs-deselected', !isSelected);
        }

        // Update toolbar count
        updateToolbarCount();
    }

    function showFeatureSelectToolbar() {
        if (_featureSelectToolbar) _featureSelectToolbar.remove();

        var total = _featureIntersections.length;
        var selected = _selectedMarkerIndices.size;

        var toolbar = document.createElement('div');
        toolbar.id = '__3dg-fs-toolbar';
        toolbar.innerHTML = [
            '<span class="__fs-label">✂ Điểm cắt: <b class="__fs-count">' + selected + '/' + total + '</b></span>',
            '<button class="__fs-btn __fs-split-all" title="Cắt tất cả">✂ Cắt tất cả (' + total + ')</button>',
            '<button class="__fs-btn __fs-split-sel" title="Cắt các điểm đã chọn">✂ Cắt đã chọn (' + selected + ')</button>',
            '<button class="__fs-btn __fs-cancel" title="Huỷ">✕</button>'
        ].join('');

        // Event handlers
        toolbar.querySelector('.__fs-split-all').addEventListener('click', function () {
            // Select all then split
            for (var i = 0; i < _featureIntersections.length; i++) {
                _selectedMarkerIndices.add(i);
            }
            executeMultiSplit();
        });

        toolbar.querySelector('.__fs-split-sel').addEventListener('click', function () {
            if (_selectedMarkerIndices.size === 0) {
                showSplitToast('Chưa chọn điểm cắt nào', 'info');
                return;
            }
            executeMultiSplit();
        });

        toolbar.querySelector('.__fs-cancel').addEventListener('click', function () {
            exitFeatureSelectMode();
        });

        document.body.appendChild(toolbar);
        _featureSelectToolbar = toolbar;
    }

    function updateToolbarCount() {
        var countEl = document.querySelector('.__fs-count');
        if (countEl) {
            countEl.textContent = _selectedMarkerIndices.size + '/' + _featureIntersections.length;
        }
        var selBtn = document.querySelector('.__fs-split-sel');
        if (selBtn) {
            selBtn.textContent = '✂ Cắt đã chọn (' + _selectedMarkerIndices.size + ')';
        }
    }

    function executeMultiSplit() {
        if (!_selectedFeature || !_selectedSource) return;

        var feature = _selectedFeature;
        var source = _selectedSource;

        // Collect selected intersection coordinates
        var selectedCoords = [];
        _selectedMarkerIndices.forEach(function (idx) {
            if (_featureIntersections[idx]) {
                selectedCoords.push(_featureIntersections[idx].coord);
            }
        });

        if (selectedCoords.length === 0) {
            showSplitToast('Chưa chọn điểm cắt nào', 'info');
            return;
        }

        // Clone coordinates
        var coords = feature.getGeometry().getCoordinates()
            .map(function (c) { return [c[0], c[1]]; });

        // Insert all vertices and collect indices
        // Important: insert from end to start so indices don't shift
        var insertResults = [];
        for (var i = 0; i < selectedCoords.length; i++) {
            var tempCoords = coords.map(function (c) { return [c[0], c[1]]; });
            var idx = insertVertexIfNeeded(tempCoords, selectedCoords[i]);
            if (idx > 0 && idx < tempCoords.length - 1) {
                insertResults.push({ coord: selectedCoords[i], tempIndex: idx });
            }
        }

        if (insertResults.length === 0) {
            showSplitToast('Lỗi: không thể chèn điểm cắt', 'error');
            exitFeatureSelectMode();
            return;
        }

        // Now insert ALL vertices into the actual coords array
        // We must insert from the end to avoid index shifting
        // First, insert all and track actual indices
        var allSplitIndices = [];
        for (var j = 0; j < insertResults.length; j++) {
            var actualIdx = insertVertexIfNeeded(coords, insertResults[j].coord);
            if (actualIdx > 0 && actualIdx < coords.length - 1) {
                allSplitIndices.push(actualIdx);
            }
        }

        // Sort indices ascending and deduplicate
        allSplitIndices.sort(function (a, b) { return a - b; });
        allSplitIndices = allSplitIndices.filter(function (v, i, arr) {
            return i === 0 || v !== arr[i - 1];
        });

        if (allSplitIndices.length === 0) {
            showSplitToast('Lỗi: không thể chia đường', 'error');
            exitFeatureSelectMode();
            return;
        }

        // Split into N+1 parts
        var parts = splitLineMulti(coords, allSplitIndices);
        if (!parts) {
            showSplitToast('Lỗi: không thể chia đường', 'error');
            exitFeatureSelectMode();
            return;
        }

        console.log('[Split] Multi-split:', allSplitIndices.length, 'cut points →', parts.length, 'parts');

        // Exit feature-select mode first (cleans up markers/toolbar)
        var featureId = feature.getId?.();
        exitFeatureSelectMode();

        // Execute split using the existing splitFeature function
        var success = splitFeature(feature, parts, source);
        if (success) {
            olMap.render();
            showSplitToast('✂ Đã chia đường thành ' + parts.length + ' phần — Ctrl+Z để hoàn tác', 'success');

            // Track split points
            for (var s = 0; s < selectedCoords.length; s++) {
                _splitPointCoords.push([selectedCoords[s][0], selectedCoords[s][1]]);
            }

            _readyIntersection = null;
            _readyIntersectionDist = Infinity;
            invalidateCache();
            document.dispatchEvent(new CustomEvent('3dg:features-changed'));

            setTimeout(function () {
                if (isActive && _lastScanPixel) {
                    scanNearCursor(_lastScanPixel);
                }
            }, 600);
        }
    }

    // ==================== PERPENDICULAR DISTANCE ====================

    function perpendicularDistance(p, a, b) {
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const lenSq = dx * dx + dy * dy;
        if (lenSq < 1e-12) {
            return Math.sqrt((p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2);
        }
        const cross = Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx);
        return cross / Math.sqrt(lenSq);
    }

    function minPerpendicularDist(p, coords) {
        let minDist = Infinity;
        for (let i = 0; i < coords.length - 1; i++) {
            const d = perpendicularDistance(p, coords[i], coords[i + 1]);
            if (d < minDist) minDist = d;
        }
        return minDist;
    }


    // NOTE: findTargetLineAtPoint has been REMOVED (dead code).
    // Scan and click handlers now use _readyIntersection.featureA/featureB directly.

    // ==================== HOVER PREVIEW ====================

    function setPreview(feature, source) {
        if (_previewFeature === feature) return;
        clearPreview();

        if (!feature) return;

        _previewFeature = feature;
        _previewSource = source;
        _previewOriginalStyle = feature.getStyle?.() || null;

        const baseStyle = _previewOriginalStyle || feature.get('__layerStyle') || null;
        try {
            feature.setStyle(function (f, res) {
                let styles = [];
                if (typeof baseStyle === 'function') {
                    const r = baseStyle(f, res);
                    styles = Array.isArray(r) ? r : (r ? [r] : []);
                } else if (baseStyle) {
                    styles = Array.isArray(baseStyle) ? baseStyle : [baseStyle];
                }

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
                            // Check if feature passes through a completed split point → green
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
                                } catch (e) { }
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

    // ==================== MARKER SYSTEM (OL Overlay) ====================

    function createMarkerElement(isReady) {
        const el = document.createElement('div');
        el.className = '__3dg-split-marker' + (isReady ? ' --ready' : '');
        return el;
    }

    // ── Coord key for marker diffing ──
    function coordKey(coord) {
        // Use fixed precision to match intersection dedup
        return Math.round(coord[0] * 1e8) + ',' + Math.round(coord[1] * 1e8);
    }

    // ── OL Overlay class discovery ──
    var _overlayClassCache = null;
    var _overlayClassSearched = false;

    function _getOverlayClass() {
        if (_overlayClassSearched) return _overlayClassCache;
        _overlayClassSearched = true;

        try {
            var existingOverlays = olMap.getOverlays?.()?.getArray?.();
            if (existingOverlays && existingOverlays.length > 0) {
                _overlayClassCache = existingOverlays[0].constructor;
                return _overlayClassCache;
            }
            if (window.ol && window.ol.Overlay) {
                _overlayClassCache = window.ol.Overlay;
                return _overlayClassCache;
            }
        } catch (e) {
            log('Could not find Overlay class:', e);
        }
        return null;
    }

    // ── DOM marker container ──
    let _domMarkerContainer = null;

    function getDOMMarkerContainer() {
        if (_domMarkerContainer && _domMarkerContainer.parentNode) return _domMarkerContainer;

        var viewport = document.querySelector('.ol-viewport');
        if (!viewport) return null;

        var mapEl = viewport.parentElement || viewport;
        _domMarkerContainer = document.createElement('div');
        _domMarkerContainer.id = '__3dg-split-markers';
        _domMarkerContainer.style.cssText =
            'position: absolute; top: 0; left: 0; width: 100%; height: 100%;' +
            'pointer-events: none; z-index: 5; overflow: hidden;';

        if (getComputedStyle(mapEl).position === 'static') {
            mapEl.style.position = 'relative';
        }
        mapEl.appendChild(_domMarkerContainer);

        return _domMarkerContainer;
    }

    // ── Create a single marker (OL Overlay or DOM) ──
    function _createMarker(coord, isReady) {
        var el = createMarkerElement(isReady);
        var OverlayClass = _getOverlayClass();

        if (OverlayClass) {
            try {
                var overlay = new OverlayClass({
                    element: el,
                    position: coord,
                    positioning: 'center-center',
                    stopEvent: false
                });
                olMap.addOverlay(overlay);
                return { overlay: overlay, coord: coord, element: el, isDom: false, key: coordKey(coord) };
            } catch (e) { }
        }

        // DOM fallback — sub-pixel positioning via transform
        var pixel = olMap.getPixelFromCoordinate(coord);
        if (!pixel) return null;

        var container = getDOMMarkerContainer();
        if (!container) return null;

        el.style.position = 'absolute';
        el.style.left = '0';
        el.style.top = '0';
        el.style.transform = 'translate(' + pixel[0] + 'px, ' + pixel[1] + 'px)';
        el.style.willChange = 'transform';
        container.appendChild(el);
        return { overlay: null, coord: coord, element: el, isDom: true, key: coordKey(coord) };
    }

    // ── Hide a marker (return to pool, don't remove from DOM) ──
    function _hideMarker(marker) {
        if (marker.overlay) {
            try { olMap.removeOverlay(marker.overlay); } catch (e) { }
            marker.overlay = null;
        }
        if (marker.element) {
            marker.element.style.display = 'none';
            marker.element.classList.remove('--ready');
        }
        _markerPool.push(marker);
    }

    // ── Reuse a pooled marker at a new position ──
    function _reuseMarker(pooledMarker, coord, isReady) {
        pooledMarker.coord = coord;
        pooledMarker.key = coordKey(coord);
        pooledMarker.element.style.display = '';
        pooledMarker.element.classList.toggle('--ready', isReady);

        var OverlayClass = _getOverlayClass();
        if (OverlayClass) {
            try {
                var overlay = new OverlayClass({
                    element: pooledMarker.element,
                    position: coord,
                    positioning: 'center-center',
                    stopEvent: false
                });
                olMap.addOverlay(overlay);
                pooledMarker.overlay = overlay;
                pooledMarker.isDom = false;
                return pooledMarker;
            } catch (e) { }
        }

        // DOM fallback
        var pixel = olMap.getPixelFromCoordinate(coord);
        if (pixel) {
            pooledMarker.element.style.transform = 'translate(' + pixel[0] + 'px, ' + pixel[1] + 'px)';
        }
        var container = getDOMMarkerContainer();
        if (container && !pooledMarker.element.parentNode) {
            container.appendChild(pooledMarker.element);
        }
        pooledMarker.isDom = true;
        return pooledMarker;
    }

    // ── Diff-based marker update (core of Phase 2) ──
    function updateMarkers(newIntersections, readyIdx) {
        // Build map of current markers by key
        var oldByKey = new Map();
        for (var i = 0; i < _markerOverlays.length; i++) {
            oldByKey.set(_markerOverlays[i].key, _markerOverlays[i]);
        }

        var newMarkers = [];
        var reusedCount = 0;
        var createdCount = 0;

        for (var j = 0; j < newIntersections.length; j++) {
            var key = coordKey(newIntersections[j].coord);
            var existing = oldByKey.get(key);

            if (existing) {
                // Reuse — just update ready state
                existing.element.classList.toggle('--ready', j === readyIdx);
                oldByKey.delete(key);
                newMarkers.push(existing);
                reusedCount++;
            } else {
                // Need new marker — try pool first
                var marker;
                if (_markerPool.length > 0) {
                    marker = _reuseMarker(_markerPool.pop(), newIntersections[j].coord, j === readyIdx);
                } else {
                    marker = _createMarker(newIntersections[j].coord, j === readyIdx);
                }
                if (marker) {
                    newMarkers.push(marker);
                    createdCount++;
                }
            }
        }

        // Hide unused markers (return to pool)
        oldByKey.forEach(function (unused) {
            _hideMarker(unused);
        });

        _markerOverlays = newMarkers;

        trace('[Markers] reused:', reusedCount, 'created:', createdCount,
              'pooled:', _markerPool.length, 'total:', _markerOverlays.length);
    }

    function updateDOMMarkerPositions() {
        for (var i = 0; i < _markerOverlays.length; i++) {
            var m = _markerOverlays[i];
            if (m.isDom && m.element) {
                var pixel = olMap.getPixelFromCoordinate(m.coord);
                if (pixel) {
                    m.element.style.transform = 'translate(' + pixel[0] + 'px, ' + pixel[1] + 'px)';
                }
            }
        }
    }

    function clearAllMarkers() {
        for (var i = 0; i < _markerOverlays.length; i++) {
            var m = _markerOverlays[i];
            if (m.overlay) {
                try { olMap.removeOverlay(m.overlay); } catch (e) { }
            }
            if (m.element) {
                try { m.element.remove(); } catch (e) { }
            }
        }
        _markerOverlays = [];
        // Also clear pool
        for (var p = 0; p < _markerPool.length; p++) {
            if (_markerPool[p].element) {
                try { _markerPool[p].element.remove(); } catch (e) { }
            }
        }
        _markerPool = [];
    }

    // ==================== REAL-TIME CURSOR SCAN ====================

    function scanNearCursor(cursorPixel) {
        // Skip normal scanning while in feature-select mode
        if (_featureSelectMode) return;

        var cursorCoord = olMap.getCoordinateFromPixel(cursorPixel);
        if (!cursorCoord) return;

        var view = olMap.getView();
        var resolution = view.getResolution();
        var scanRadius = SCAN_RADIUS_PX * resolution;

        // ── Cache management: rebuild if dirty or cursor out of cached area ──
        if (_cacheDirty || !isCursorInCacheExtent(cursorCoord, scanRadius)) {
            rebuildIntersectionCache();
        }

        // ── Query cached intersections near cursor (O(k) where k = nearby) ──
        var intersections = queryCacheNearCursor(cursorCoord, scanRadius);
        _nearbyIntersections = intersections;

        trace('[Scan] Found', intersections.length, 'intersections near cursor (from cache)');

        // ── Find closest intersection (with hysteresis) ──
        var clickTolerance = CLICK_TOLERANCE_PX * resolution;
        var bestIdx = -1;
        var bestDist = Infinity;

        for (var i = 0; i < intersections.length; i++) {
            var dx = intersections[i].coord[0] - cursorCoord[0];
            var dy = intersections[i].coord[1] - cursorCoord[1];
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < clickTolerance && dist < bestDist) {
                bestDist = dist;
                bestIdx = i;
            }
        }

        var newReady = bestIdx >= 0 ? intersections[bestIdx] : null;

        // ── Hysteresis: keep current marker unless new candidate is clearly closer ──
        if (_readyIntersection && newReady) {
            // Measure current ready intersection distance to cursor
            var curDx = _readyIntersection.coord[0] - cursorCoord[0];
            var curDy = _readyIntersection.coord[1] - cursorCoord[1];
            var currentDist = Math.sqrt(curDx * curDx + curDy * curDy);

            // Check if current ready is still within tolerance
            if (currentDist < clickTolerance) {
                var hysteresisMap = HYSTERESIS_PX * resolution;
                // Only switch if new candidate is significantly closer
                if (bestDist >= currentDist - hysteresisMap) {
                    // Keep current — find its index in the new intersections array
                    newReady = _readyIntersection;
                    bestDist = currentDist;
                    // Find index for marker rendering
                    var currentKey = coordKey(_readyIntersection.coord);
                    for (var ci = 0; ci < intersections.length; ci++) {
                        if (coordKey(intersections[ci].coord) === currentKey) {
                            bestIdx = ci;
                            break;
                        }
                    }
                }
            }
        }

        _readyIntersection = newReady;
        _readyIntersectionDist = newReady ? bestDist : Infinity;

        if (_readyIntersection) {
            trace('[Scan] Ready intersection:', _readyIntersection.coord,
                'featureA:', _readyIntersection.featureA?.getId?.() || '(no id)',
                'featureB:', _readyIntersection.featureB?.getId?.() || '(no id)',
                'dist:', bestDist.toFixed(4));
        }

        // ── Update markers via diff (Phase 2: no destroy+recreate) ──
        updateMarkers(intersections, bestIdx);

        // ── Preview the target line using cached intersection data ──
        if (_readyIntersection) {
            var distA = minPerpendicularDist(cursorCoord, _readyIntersection.featureA.getGeometry().getCoordinates());
            var distB = minPerpendicularDist(cursorCoord, _readyIntersection.featureB.getGeometry().getCoordinates());

            if (distA <= distB) {
                setPreview(_readyIntersection.featureA, _readyIntersection.sourceA);
            } else {
                setPreview(_readyIntersection.featureB, _readyIntersection.sourceB);
            }

            trace('[Preview] Showing feature:', (distA <= distB ? 'A' : 'B'),
                'id:', (distA <= distB ? _readyIntersection.featureA : _readyIntersection.featureB)?.getId?.() || '(no id)');

            var viewport = document.querySelector('.ol-viewport');
            if (viewport) viewport.classList.add('__split-near');
        } else {
            clearPreview();
            var viewport2 = document.querySelector('.ol-viewport');
            if (viewport2) viewport2.classList.remove('__split-near');
        }
    }

    // ==================== POINTERMOVE HANDLER (throttled) ====================

    function handlePointermove(e) {
        if (!isActive || !olMap) return;

        var viewport = document.querySelector('.ol-viewport');
        if (!viewport) return;

        var rect = viewport.getBoundingClientRect();
        var pixel = [e.clientX - rect.left, e.clientY - rect.top];

        // Skip re-scan if cursor barely moved
        if (_lastScanPixel) {
            var dx = pixel[0] - _lastScanPixel[0];
            var dy = pixel[1] - _lastScanPixel[1];
            if (dx * dx + dy * dy < THROTTLE_MOVE_PX * THROTTLE_MOVE_PX) return;
        }

        // Throttle via requestAnimationFrame
        _pendingEvent = pixel;
        if (!_rafId) {
            _rafId = requestAnimationFrame(function () {
                _rafId = null;
                if (_pendingEvent && isActive) {
                    _lastScanPixel = _pendingEvent;
                    scanNearCursor(_pendingEvent);
                    _pendingEvent = null;
                }
            });
        }
    }

    // ==================== CLICK HANDLER (single-click to split) ====================
    //
    // CRITICAL: This handler uses _readyIntersection as the SINGLE SOURCE OF TRUTH.
    // It does NOT recompute intersections. The flow is:
    //   scanNearCursor() detects → _readyIntersection cached → click uses cached data
    //

    function handleClick(e) {
        if (!isActive || !olMap) return;

        // ── Feature-select mode: clicking empty area exits it ──
        if (_featureSelectMode) {
            // Don't exit if clicking on a marker (markers have their own handlers)
            if (e.target && e.target.classList?.contains('__3dg-split-marker')) return;
            exitFeatureSelectMode();
            e.stopImmediatePropagation();
            e.preventDefault();
            return;
        }

        // ── Step 1: Check if we have a ready intersection from the scan ──
        if (!_readyIntersection) {
            // No intersection near cursor → try to select a feature for multi-split
            var viewport = document.querySelector('.ol-viewport');
            if (!viewport) return;
            var rect = viewport.getBoundingClientRect();
            var pixel = [e.clientX - rect.left, e.clientY - rect.top];
            var clickCoord = olMap.getCoordinateFromPixel(pixel);
            if (!clickCoord) return;

            // Find the nearest line feature under the cursor
            var resolution = olMap.getView().getResolution();
            var hitTolerance = CLICK_TOLERANCE_PX * resolution;
            var allLines = collectLineStrings();
            var bestFeature = null;
            var bestSource = null;
            var bestDist = Infinity;

            for (var i = 0; i < allLines.length; i++) {
                var coords = allLines[i].feature.getGeometry().getCoordinates();
                var dist = minPerpendicularDist(clickCoord, coords);
                if (dist < hitTolerance && dist < bestDist) {
                    bestDist = dist;
                    bestFeature = allLines[i].feature;
                    bestSource = allLines[i].source;
                }
            }

            if (bestFeature) {
                e.stopImmediatePropagation();
                e.preventDefault();
                enterFeatureSelectMode(bestFeature, bestSource);
            }
            return;
        }

        // Prevent default map click behavior
        e.stopImmediatePropagation();
        e.preventDefault();

        var viewport = document.querySelector('.ol-viewport');
        if (!viewport) return;

        var rect = viewport.getBoundingClientRect();
        var pixel = [e.clientX - rect.left, e.clientY - rect.top];
        var clickCoord = olMap.getCoordinateFromPixel(pixel);
        if (!clickCoord) return;

        // ── Step 2: Use the cached intersection coordinate (NOT clickCoord) ──
        var cachedIntersection = _readyIntersection;
        var splitPoint = cachedIntersection.coord;

        console.log('[Split] ── Click Debug ──');
        console.log('[Split] Click pixel:', pixel);
        console.log('[Split] Click map coord:', clickCoord);
        console.log('[Split] Cached intersection coord:', splitPoint);
        console.log('[Split] featureA:', cachedIntersection.featureA?.getId?.() || '(no id)');
        console.log('[Split] featureB:', cachedIntersection.featureB?.getId?.() || '(no id)');

        // ── Step 3: Determine which feature to split ──
        // Use the preview feature if available (already determined by scan),
        // otherwise pick the closest of the two intersection features.
        var targetFeature = _previewFeature;
        var targetSource = _previewSource;

        if (!targetFeature) {
            // Fallback: pick the line closest to the click from the cached intersection
            var distA = minPerpendicularDist(clickCoord, cachedIntersection.featureA.getGeometry().getCoordinates());
            var distB = minPerpendicularDist(clickCoord, cachedIntersection.featureB.getGeometry().getCoordinates());
            if (distA <= distB) {
                targetFeature = cachedIntersection.featureA;
                targetSource = cachedIntersection.sourceA;
            } else {
                targetFeature = cachedIntersection.featureB;
                targetSource = cachedIntersection.sourceB;
            }
            console.log('[Split] No preview feature, picked', distA <= distB ? 'featureA' : 'featureB');
        }

        // Verify the target feature still exists on the map
        if (!targetFeature || !targetFeature.getGeometry?.()) {
            log('[Click] Target feature no longer exists');
            showSplitToast('Đường đã bị thay đổi, vui lòng thử lại', 'info');
            return;
        }

        console.log('[Split] Target line:', targetFeature.getId?.() || '(no id)');
        console.log('[Split] Split point (from cache):', splitPoint);

        // Clear preview before split
        clearPreview();

        // ── Step 4: Insert vertex and split using the CACHED coordinate ──
        // Clone coordinates
        var coords = targetFeature.getGeometry().getCoordinates().map(function (c) { return [c[0], c[1]]; });

        // Insert vertex at the exact cached intersection coordinate
        var splitIndex = insertVertexIfNeeded(coords, splitPoint);
        console.log('[Split] insertVertexIfNeeded result:', splitIndex, 'of', coords.length, 'coords');

        if (splitIndex < 0) {
            // The cached coord doesn't lie on this feature's segments.
            // Try the OTHER feature from the intersection pair.
            console.warn('[Split] Split point not on target feature, trying other feature...');
            var otherFeature, otherSource;
            if (targetFeature === cachedIntersection.featureA) {
                otherFeature = cachedIntersection.featureB;
                otherSource = cachedIntersection.sourceB;
            } else {
                otherFeature = cachedIntersection.featureA;
                otherSource = cachedIntersection.sourceA;
            }

            if (otherFeature && otherFeature.getGeometry?.()) {
                coords = otherFeature.getGeometry().getCoordinates().map(function (c) { return [c[0], c[1]]; });
                splitIndex = insertVertexIfNeeded(coords, splitPoint);
                console.log('[Split] Retry on other feature, insertVertex result:', splitIndex);
                if (splitIndex >= 0) {
                    targetFeature = otherFeature;
                    targetSource = otherSource;
                }
            }
        }

        if (splitIndex < 0) {
            console.error('[Split] Failed to insert vertex on EITHER feature at', splitPoint);
            showSplitToast('Lỗi: không thể chèn điểm cắt', 'error');
            return;
        }

        // Can't split at start or end
        if (splitIndex === 0 || splitIndex === coords.length - 1) {
            log('[Click] Cannot split at start or end of line, index:', splitIndex);
            showSplitToast('Không thể cắt tại đầu hoặc cuối đường', 'info');
            return;
        }

        // Split
        var parts = splitLine(coords, splitIndex);
        if (!parts) {
            log('[Click] Split failed');
            showSplitToast('Lỗi: không thể chia đường', 'error');
            return;
        }

        // ── Step 5: Replace the feature ──
        var success = splitFeature(targetFeature, parts, targetSource);
        if (success) {
            olMap.render();
            showSplitToast('✂ Đã chia đường thành ' + parts.length + ' phần — Ctrl+Z để hoàn tác', 'success');
            console.log('[Split] ✅ Split into', parts.length, 'parts');
            console.log('[Split] ── End Click Debug ──');

            // Track split point for green highlight
            _splitPointCoords.push([splitPoint[0], splitPoint[1]]);

            // Clear the ready intersection (it's been consumed)
            _readyIntersection = null;
            _readyIntersectionDist = Infinity;

            // Invalidate cache (features changed)
            invalidateCache();

            // Notify autosave
            document.dispatchEvent(new CustomEvent('3dg:features-changed'));

            // Force re-scan after a short delay (source has changed)
            setTimeout(function () {
                if (isActive && _lastScanPixel) {
                    scanNearCursor(_lastScanPixel);
                }
            }, 600);
        }
    }

    // ==================== TOAST ====================
    function showSplitToast(msg, type) {
        var container = document.getElementById('sel-toast-container');
        if (container) {
            var toast = document.createElement('div');
            toast.className = 'sel-toast ' + type;
            toast.textContent = msg;
            container.appendChild(toast);
            toast.addEventListener('animationend', function (e) {
                if (e.animationName === 'sel-toast-out') toast.remove();
            });
            return;
        }
        console.log('[Split]', msg);
    }

    // ==================== INJECT CSS ====================
    function injectSplitStyles() {
        var STYLE_ID = '__3dg-split-style';
        if (document.getElementById(STYLE_ID)) return;

        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = [
            /* Cursor states */
            '.ol-viewport.__split-mode { cursor: crosshair !important; }',
            '.ol-viewport.__split-mode * { cursor: crosshair !important; }',
            '.ol-viewport.__split-mode.__split-near { cursor: pointer !important; }',
            '.ol-viewport.__split-mode.__split-near * { cursor: pointer !important; }',

            /* Marker base style */
            '.__3dg-split-marker {',
            '  width: ' + (MARKER_RADIUS * 2) + 'px;',
            '  height: ' + (MARKER_RADIUS * 2) + 'px;',
            '  border-radius: 50%;',
            '  background: rgba(255, 80, 0, 0.85);',
            '  border: 2px solid #fff;',
            '  box-shadow: 0 0 8px rgba(255, 80, 0, 0.5);',
            '  pointer-events: none;',
            '  z-index: 10;',
            '  transform: translate(-50%, -50%);',
            '  transition: all 0.15s ease;',
            '}',

            /* Ready state — pulsing, larger, cyan */
            '.__3dg-split-marker.--ready {',
            '  width: ' + (MARKER_RADIUS_READY * 2) + 'px;',
            '  height: ' + (MARKER_RADIUS_READY * 2) + 'px;',
            '  background: rgba(0, 200, 255, 0.9);',
            '  border: 2.5px solid #fff;',
            '  box-shadow: 0 0 12px rgba(0, 200, 255, 0.6), 0 0 24px rgba(0, 200, 255, 0.25);',
            '  animation: __3dg-split-pulse 1.2s ease-in-out infinite;',
            '}',

            /* Split-done flash */
            '.__3dg-split-marker.--done {',
            '  background: rgba(0, 200, 80, 0.9);',
            '  border-color: #fff;',
            '  box-shadow: 0 0 16px rgba(0, 200, 80, 0.7);',
            '  animation: __3dg-split-flash 0.4s ease-out forwards;',
            '}',

            /* Pulse animation */
            '@keyframes __3dg-split-pulse {',
            '  0%, 100% { transform: translate(-50%, -50%) scale(1); box-shadow: 0 0 12px rgba(0, 200, 255, 0.6); }',
            '  50% { transform: translate(-50%, -50%) scale(1.25); box-shadow: 0 0 20px rgba(0, 200, 255, 0.8); }',
            '}',

            /* Flash animation */
            '@keyframes __3dg-split-flash {',
            '  0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }',
            '  100% { transform: translate(-50%, -50%) scale(2); opacity: 0; }',
            '}',

            /* ── Feature-Select Mode: Selected marker (green, pulsing) ── */
            '.__3dg-split-marker.--fs-selected {',
            '  width: 20px; height: 20px;',
            '  background: rgba(0, 200, 80, 0.9);',
            '  border: 2.5px solid #fff;',
            '  box-shadow: 0 0 12px rgba(0, 200, 80, 0.6), 0 0 24px rgba(0, 200, 80, 0.25);',
            '  animation: __3dg-split-pulse-green 1.2s ease-in-out infinite;',
            '  pointer-events: auto !important;',
            '  cursor: pointer !important;',
            '  z-index: 20;',
            '}',

            /* Feature-Select Mode: Deselected marker (gray, smaller) */
            '.__3dg-split-marker.--fs-deselected {',
            '  width: 14px; height: 14px;',
            '  background: rgba(150, 150, 150, 0.7);',
            '  border: 2px solid rgba(255,255,255,0.5);',
            '  box-shadow: 0 0 4px rgba(0, 0, 0, 0.3);',
            '  animation: none;',
            '  pointer-events: auto !important;',
            '  cursor: pointer !important;',
            '  z-index: 15;',
            '}',
            '.__3dg-split-marker.--fs-deselected:hover {',
            '  background: rgba(100, 100, 100, 0.9);',
            '  transform: translate(-50%, -50%) scale(1.15);',
            '}',

            /* Green pulse for feature-select markers */
            '@keyframes __3dg-split-pulse-green {',
            '  0%, 100% { transform: translate(-50%, -50%) scale(1); box-shadow: 0 0 12px rgba(0, 200, 80, 0.6); }',
            '  50% { transform: translate(-50%, -50%) scale(1.2); box-shadow: 0 0 20px rgba(0, 200, 80, 0.8); }',
            '}',

            /* ── Feature-Select Toolbar ── */
            '#__3dg-fs-toolbar {',
            '  position: fixed;',
            '  top: 16px;',
            '  left: 50%;',
            '  transform: translateX(-50%);',
            '  display: flex;',
            '  align-items: center;',
            '  gap: 10px;',
            '  padding: 10px 18px;',
            '  background: rgba(30, 30, 40, 0.92);',
            '  backdrop-filter: blur(12px);',
            '  -webkit-backdrop-filter: blur(12px);',
            '  border: 1px solid rgba(255, 255, 255, 0.12);',
            '  border-radius: 12px;',
            '  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);',
            '  z-index: 10000;',
            '  font-family: Inter, -apple-system, sans-serif;',
            '  font-size: 13px;',
            '  color: #e0e0e0;',
            '  animation: __3dg-toolbar-in 0.25s ease-out;',
            '}',

            '.__fs-label { white-space: nowrap; }',
            '.__fs-count { color: #66ff99; font-size: 14px; }',

            '.__fs-btn {',
            '  padding: 6px 14px;',
            '  border: 1px solid rgba(255,255,255,0.15);',
            '  border-radius: 8px;',
            '  background: rgba(255,255,255,0.08);',
            '  color: #e0e0e0;',
            '  font-size: 12px;',
            '  cursor: pointer;',
            '  transition: all 0.15s ease;',
            '  white-space: nowrap;',
            '}',
            '.__fs-btn:hover { background: rgba(255,255,255,0.18); }',

            '.__fs-split-all {',
            '  background: rgba(0, 200, 80, 0.25) !important;',
            '  border-color: rgba(0, 200, 80, 0.4) !important;',
            '  color: #66ff99 !important;',
            '}',
            '.__fs-split-all:hover { background: rgba(0, 200, 80, 0.4) !important; }',

            '.__fs-split-sel {',
            '  background: rgba(0, 150, 255, 0.2) !important;',
            '  border-color: rgba(0, 150, 255, 0.35) !important;',
            '  color: #80d0ff !important;',
            '}',
            '.__fs-split-sel:hover { background: rgba(0, 150, 255, 0.35) !important; }',

            '.__fs-cancel {',
            '  background: rgba(255, 80, 80, 0.15) !important;',
            '  border-color: rgba(255, 80, 80, 0.3) !important;',
            '  color: #ff9999 !important;',
            '  padding: 6px 10px !important;',
            '}',
            '.__fs-cancel:hover { background: rgba(255, 80, 80, 0.3) !important; }',

            '@keyframes __3dg-toolbar-in {',
            '  0% { opacity: 0; transform: translateX(-50%) translateY(-10px); }',
            '  100% { opacity: 1; transform: translateX(-50%) translateY(0); }',
            '}'
        ].join('\n');
        document.head.appendChild(style);
    }

    // ==================== INTERACTION MANAGEMENT ====================

    function disableConflictingInteractions() {
        _disabledInteractions = [];
        try {
            olMap.getInteractions().forEach(function (interaction) {
                var name = interaction.constructor.name || '';

                // DoubleClickZoom
                if (name === 'DoubleClickZoom' || name.includes('DoubleClick')) {
                    if (interaction.getActive()) {
                        interaction.__splitDisabled = true;
                        interaction.setActive(false);
                        _disabledInteractions.push(interaction);
                    }
                }

                // Draw interactions
                if (typeof interaction.removeLastPoint === 'function' &&
                    typeof interaction.finishDrawing === 'function') {
                    if (interaction.getActive()) {
                        interaction.__splitDisabled = true;
                        interaction.setActive(false);
                        _disabledInteractions.push(interaction);
                    }
                }

                // DragBox
                if (name === 'DragBox' || name.includes('DragBox') ||
                    (typeof interaction.getGeometry === 'function' && name !== 'Draw')) {
                    if (interaction.getActive()) {
                        interaction.__splitDisabled = true;
                        interaction.setActive(false);
                        _disabledInteractions.push(interaction);
                    }
                }

                // Select interaction
                if (name === 'Select' || name.includes('Select') ||
                    (typeof interaction.getFeatures === 'function' && typeof interaction.getStyle === 'function')) {
                    if (interaction.getActive()) {
                        interaction.__splitDisabled = true;
                        interaction.setActive(false);
                        _disabledInteractions.push(interaction);
                    }
                }
            });
        } catch (e) { }

        // Watch for React re-adding interactions via MutationObserver
        _startInteractionObserver();
    }

    function reEnableInteractions() {
        _stopInteractionObserver();

        for (var i = 0; i < _disabledInteractions.length; i++) {
            try {
                _disabledInteractions[i].setActive(true);
                delete _disabledInteractions[i].__splitDisabled;
            } catch (e) { }
        }
        _disabledInteractions = [];

        // Also re-enable anything else that might have been disabled
        try {
            olMap.getInteractions().forEach(function (interaction) {
                if (interaction.__splitDisabled) {
                    interaction.setActive(true);
                    delete interaction.__splitDisabled;
                }
            });
        } catch (e) { }
    }

    // MutationObserver to catch React re-creating interactions
    var _interactionObserver = null;
    var _interactionCheckTimeout = null;

    function _startInteractionObserver() {
        if (_interactionObserver) return;

        // Listen for changes to the interaction collection
        try {
            var interactionCollection = olMap.getInteractions();
            if (interactionCollection && interactionCollection.on) {
                _interactionObserver = interactionCollection.on('add', function () {
                    // Debounce: React may add multiple interactions at once
                    if (_interactionCheckTimeout) clearTimeout(_interactionCheckTimeout);
                    _interactionCheckTimeout = setTimeout(function () {
                        if (isActive) {
                            // Re-disable any new conflicting interactions
                            olMap.getInteractions().forEach(function (interaction) {
                                var name = interaction.constructor.name || '';
                                if (interaction.__splitDisabled) return; // Already handled
                                if (!interaction.getActive()) return;

                                var shouldDisable = false;
                                if (name === 'DoubleClickZoom' || name.includes('DoubleClick')) shouldDisable = true;
                                if (typeof interaction.removeLastPoint === 'function' &&
                                    typeof interaction.finishDrawing === 'function') shouldDisable = true;

                                if (shouldDisable) {
                                    interaction.__splitDisabled = true;
                                    interaction.setActive(false);
                                    _disabledInteractions.push(interaction);
                                    log('Disabled newly added interaction:', name);
                                }
                            });
                        }
                    }, 100);
                });
            }
        } catch (e) {
            log('Could not observe interactions:', e);
        }
    }

    function _stopInteractionObserver() {
        if (_interactionObserver) {
            try {
                var interactionCollection = olMap.getInteractions();
                if (interactionCollection && interactionCollection.un) {
                    interactionCollection.un('add', _interactionObserver.listener || _interactionObserver);
                }
            } catch (e) { }
            _interactionObserver = null;
        }
        if (_interactionCheckTimeout) {
            clearTimeout(_interactionCheckTimeout);
            _interactionCheckTimeout = null;
        }
    }

    // ==================== ACTIVATE / DEACTIVATE ====================

    function activateSplitTool() {
        if (isActive) return;
        isActive = true;
        window.__splitToolActive = true;
        _splitPointCoords = [];
        _nearbyIntersections = [];
        _readyIntersection = null;
        _readyIntersectionDist = Infinity;
        _lastScanPixel = null;
        _cacheDirty = true;

        var viewport = document.querySelector('.ol-viewport');
        if (!viewport) return;

        viewport.classList.add('__split-mode');

        // Single-click handler (capture phase)
        _viewportClickHandler = handleClick;
        viewport.addEventListener('click', _viewportClickHandler, true);

        // Pointermove handler for real-time scanning
        _viewportPointermoveHandler = handlePointermove;
        viewport.addEventListener('pointermove', _viewportPointermoveHandler, false);

        // Update DOM marker positions on pan/zoom + invalidate cache if view moved
        _moveEndKey = olMap.on('moveend', function () {
            updateDOMMarkerPositions();
            // Check if we need to rebuild cache (view panned outside cached area)
            // _cacheDirty will be checked on next pointermove scan
            _cacheDirty = true;
        });

        // Start cache invalidation listeners
        startCacheInvalidationListeners();

        // Build initial cache
        rebuildIntersectionCache();

        // Disable conflicting interactions
        disableConflictingInteractions();

        showSplitToast('✂ Di chuyển chuột gần giao điểm, click để cắt. Esc để thoát.', 'info');
        console.log('[Split] ✅ Split tool activated (move cursor near intersections, click to split)');
    }

    function deactivateSplitTool() {
        if (!isActive) return;
        isActive = false;
        window.__splitToolActive = false;

        // Exit feature-select mode if active
        if (_featureSelectMode) exitFeatureSelectMode();

        _splitPointCoords = [];
        _nearbyIntersections = [];
        _readyIntersection = null;
        _readyIntersectionDist = Infinity;
        _lastScanPixel = null;

        // Clear cache
        _globalCache = [];
        _cacheExtent = null;
        _cacheGrid = null;
        _cacheDirty = true;

        // Stop cache invalidation listeners
        stopCacheInvalidationListeners();

        // Cancel pending RAF
        if (_rafId) {
            cancelAnimationFrame(_rafId);
            _rafId = null;
        }
        _pendingEvent = null;

        var viewport = document.querySelector('.ol-viewport');
        if (viewport) {
            viewport.classList.remove('__split-mode');
            viewport.classList.remove('__split-near');

            if (_viewportClickHandler) {
                viewport.removeEventListener('click', _viewportClickHandler, true);
                _viewportClickHandler = null;
            }
            if (_viewportPointermoveHandler) {
                viewport.removeEventListener('pointermove', _viewportPointermoveHandler, false);
                _viewportPointermoveHandler = null;
            }
        }

        clearPreview();
        clearAllMarkers();

        if (_domMarkerContainer && _domMarkerContainer.parentNode) {
            _domMarkerContainer.remove();
            _domMarkerContainer = null;
        }

        if (_moveEndKey) {
            try { olMap.un('moveend', _moveEndKey.listener || _moveEndKey); } catch (e) { }
            _moveEndKey = null;
        }

        reEnableInteractions();

        showSplitToast('Split tool tắt', 'info');
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

    // Expose for taskbar
    window.__toggleSplitTool = toggleSplitTool;
    window.__splitToolActive = false;

    // ==================== UNDO SUPPORT ====================

    function setupUndoSupport() {
        var originalHandler = window.__ctrlZHandler;
        if (!originalHandler) return;

        document.removeEventListener('keydown', originalHandler, true);

        var wrappedHandler = function (e) {
            if (!(e.ctrlKey || e.metaKey)) { originalHandler(e); return; }

            if (e.key === 'z' || e.key === 'Z') {
                if (window.__undoStack && window.__undoStack.length > 0) {
                    var top = window.__undoStack[window.__undoStack.length - 1];
                    if (top.action === 'split') {
                        e.preventDefault();
                        e.stopPropagation();

                        var entry = window.__undoStack.pop();
                        undoSplit(entry);
                        return;
                    }
                }
                originalHandler(e);
                return;
            }

            originalHandler(e);
        };

        window.__ctrlZHandler = wrappedHandler;
        document.addEventListener('keydown', wrappedHandler, true);
    }

    function undoSplit(entry) {
        var source = entry._source;
        if (!source) return;

        // Step 1: Remove the new features (created by GeoJSON import)
        for (var i = 0; i < entry.newFeatureIds.length; i++) {
            try {
                var f = source.getFeatureById(entry.newFeatureIds[i]);
                if (f) {
                    // Try DOM delete first (React-aware)
                    var deletedByDOM = false;
                    if (window.__deleteFeatureByDOM) {
                        deletedByDOM = window.__deleteFeatureByDOM(entry.newFeatureIds[i]);
                    }
                    if (!deletedByDOM) {
                        source.removeFeature(f);
                    }
                    console.log('[Split] ↩ Removed new feature:', entry.newFeatureIds[i]);
                }
            } catch (e) { }
        }

        // Step 2: Restore original feature via GeoJSON import
        if (entry.originalFeatureId && entry.originalCoords) {
            cloakModals();
            startModalAutoClick();

            var imported = importFeaturesViaGeoJSON([entry.originalCoords]);
            if (!imported) {
                // Fallback: add directly
                try {
                    var allLines = collectLineStrings();
                    if (allLines.length > 0) {
                        var restoredFeature = allLines[0].feature.clone();
                        restoredFeature.getGeometry().setCoordinates(entry.originalCoords);
                        restoredFeature.setId(entry.originalFeatureId);
                        if (entry.originalProperties) {
                            for (var key in entry.originalProperties) {
                                if (key !== 'geometry' && entry.originalProperties.hasOwnProperty(key)) {
                                    restoredFeature.set(key, entry.originalProperties[key]);
                                }
                            }
                        }
                        source.addFeature(restoredFeature);
                    }
                } catch (e) {
                    console.error('[Split] Error restoring feature:', e);
                }
            }

            setTimeout(function () {
                stopModalAutoClick();
                var modals = document.querySelectorAll('.ant-modal-root, .ant-modal-wrap, .ant-modal');
                for (var r = 0; r < modals.length; r++) {
                    clickAddButton(modals[r]);
                }
                setTimeout(function () { uncloakModals(); }, 500);
            }, 1500);
        }

        olMap.render();

        // Re-scan if tool is active
        if (isActive && _lastScanPixel) {
            setTimeout(function () {
                scanNearCursor(_lastScanPixel);
            }, 300);
        }

        showSplitToast('↩ Undo split thành công', 'success');
        console.log('[Split] ↩ Undo split');

        invalidateCache();
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
            // Alt+S: toggle split tool
            if (e.altKey && !e.ctrlKey && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
                e.preventDefault();
                e.stopPropagation();
                toggleSplitTool();
                return;
            }

            // Esc: exit feature-select mode first, then split mode
            if (e.key === 'Escape' && isActive) {
                e.preventDefault();
                e.stopPropagation();
                if (_featureSelectMode) {
                    exitFeatureSelectMode();
                } else {
                    deactivateSplitTool();
                }
            }
        }, true);

        console.log('[Split] ✅ Split tool ready. Alt+S to toggle, Esc to exit');
    }

    // Listen for map-ready event
    if (window.__olMap) {
        setTimeout(initSplit, 500);
    } else {
        document.addEventListener('3dg:map-ready', function () {
            setTimeout(initSplit, 500);
        }, { once: true });

        // Safety fallback
        setTimeout(function () {
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
