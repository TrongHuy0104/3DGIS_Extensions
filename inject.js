(function waitForMap() {
    const viewport = document.querySelector('.ol-viewport');
    if (!viewport) { setTimeout(waitForMap, 1000); return; }
    setTimeout(initCtrlZ, 2000);
})();

function initCtrlZ() {
    if (window.__ctrlZHandler) document.removeEventListener('keydown', window.__ctrlZHandler);
    if (window.__featureClickHandler) document.removeEventListener('click', window.__featureClickHandler, true);

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

    const olMap = findOlMap();
    if (!olMap) { setTimeout(initCtrlZ, 3000); return; }

    window.__redoStack = [];

    // ===== SNAPPING FEATURE =====
    // Tự động bắt điểm (snap) vào điểm đầu tiên khi trỏ chuột lại gần điểm đầu
    function setupSnappingForDraw(drawInteraction) {
        if (drawInteraction.__snappingWrapped) return;
        drawInteraction.__snappingWrapped = true;

        const originalHandleEvent = drawInteraction.handleEvent;
        drawInteraction.handleEvent = function (mapBrowserEvent) {
            let shouldFinish = false;
            try {
                const geom = this.sketchFeature_?.getGeometry();
                if (geom) {
                    const type = geom.getType();
                    let firstCoord = null;

                    if (type === 'LineString') {
                        const coords = geom.getCoordinates();
                        // Chỉ bắt điểm khi đã vẽ được ít nhất 2 điểm cố định (mảng coords có ít nhất 3 phần tử gồm cả điểm pointer)
                        if (coords.length > 2) {
                            firstCoord = coords[0];
                        }
                    } else if (type === 'Polygon') {
                        const rings = geom.getCoordinates();
                        // Đối với Polygon, cần ít nhất 3 điểm cố định (mảng rings[0] có ít nhất 4 phần tử bao gồm cả điểm pointer và điểm đóng)
                        if (rings.length > 0 && rings[0].length > 3) {
                            firstCoord = rings[0][0];
                        }
                    }

                    if (firstCoord) {
                        const firstPixel = olMap.getPixelFromCoordinate(firstCoord);
                        const eventPixel = mapBrowserEvent.pixel;

                        if (firstPixel && eventPixel) {
                            const dx = eventPixel[0] - firstPixel[0];
                            const dy = eventPixel[1] - firstPixel[1];
                            const distance = Math.sqrt(dx * dx + dy * dy);
                            const tolerance = 20; // Khoảng cách bắt điểm (pixel)

                            if (distance < tolerance) {
                                // Đè tọa độ sự kiện thành tọa độ của điểm đầu
                                try {
                                    mapBrowserEvent.coordinate = [...firstCoord];
                                    mapBrowserEvent.pixel = [...firstPixel];
                                } catch (err) {
                                    Object.defineProperty(mapBrowserEvent, 'coordinate', { value: [...firstCoord], writable: true, configurable: true });
                                    Object.defineProperty(mapBrowserEvent, 'pixel', { value: [...firstPixel], writable: true, configurable: true });
                                }

                                // Nếu người dùng thả chuột (pointerup) hoặc click để vẽ điểm cuối vào điểm đầu
                                if (mapBrowserEvent.type === 'pointerup' || mapBrowserEvent.type === 'click' || mapBrowserEvent.type === 'singleclick') {
                                    shouldFinish = true;
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                console.error("Error in wrapped handleEvent:", e);
            }

            // Chạy trình xử lý gốc trước để OpenLayers thêm điểm cuối cùng vào danh sách
            const result = originalHandleEvent.call(this, mapBrowserEvent);

            if (shouldFinish) {
                try {
                    this.finishDrawing();
                } catch (e) {}
            }

            return result;
        };
    }

    function scanDrawInteractions() {
        try {
            olMap.getInteractions().forEach(interaction => {
                if (typeof interaction.finishDrawing === 'function' && typeof interaction.removeLastPoint === 'function') {
                    setupSnappingForDraw(interaction);
                }
            });
        } catch (e) {}
    }

    // Lắng nghe sự kiện thêm interaction mới vào map
    try {
        olMap.getInteractions().on('add', (e) => {
            const interaction = e.element;
            if (interaction && typeof interaction.finishDrawing === 'function' && typeof interaction.removeLastPoint === 'function') {
                setupSnappingForDraw(interaction);
            }
        });
    } catch (e) {}

    // Định kỳ quét để đảm bảo không bỏ sót
    setInterval(scanDrawInteractions, 2000);
    scanDrawInteractions();

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
            } catch (e) {}
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

        const geojson = {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                geometry: geometry,
                properties: null,
                id: entry.featureId
            }]
        };

        const input = document.querySelector('input[accept*=".geojson"]');
        if (!input) return false;

        const blob = new Blob([JSON.stringify(geojson)], { type: 'application/geo+json' });
        const file = new File([blob], 'redo.geojson', { type: 'application/geo+json' });
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
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

            const activeDraw = olMap.getInteractions().getArray()
                .find(i => typeof i.removeLastPoint === 'function' && i.sketchFeature_ != null);
            if (activeDraw) { activeDraw.removeLastPoint(); olMap.render(); return; }

            if (window.__selectedFeatureId) {
                const r = undoOneCoord(window.__selectedFeatureId);
                if (r === 'deleted') window.__selectedFeatureId = null;
                if (r !== 'skip') { olMap.render(); return; }
                window.__selectedFeatureId = null;
            }

            const rows = document.querySelectorAll('div[data-feature-id]');
            for (let i = rows.length - 1; i >= 0; i--) {
                const r = undoOneCoord(rows[i].getAttribute('data-feature-id'));
                if (r === 'removed' || r === 'deleted') { olMap.render(); return; }
            }
            olMap.render();
            return;
        }

        // Ctrl+Y: REDO
        if (e.key === 'y' || e.key === 'Y') {
            e.preventDefault();
            redoOneStep();
            olMap.render();
        }
    };
    document.addEventListener('keydown', window.__ctrlZHandler);
}
