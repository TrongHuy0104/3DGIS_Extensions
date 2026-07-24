// ============================================================
//  SNAPPING FEATURE — Tự động bắt điểm vào điểm đầu tiên khi trỏ chuột lại gần điểm đầu
//  - Khi vẽ Polygon/LineString, nếu chuột gần điểm đầu → snap vào
//  - Click/pointerup khi đang snap → tự động finishDrawing()
// ============================================================

(function () {
    'use strict';

    let olMap = null;

    // Tìm map thông qua shared findOlMap từ inject.js hoặc tự quét reactFiber
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

    // Khởi tạo
    if (window.__olMap) {
        setTimeout(initSnapping, 500);
    } else {
        document.addEventListener('3dg:map-ready', () => {
            setTimeout(initSnapping, 500);
        }, { once: true });

        setTimeout(() => {
            if (!olMap) {
                (function waitForMap() {
                    if (!document.querySelector('.ol-viewport')) {
                        setTimeout(waitForMap, 1000);
                        return;
                    }
                    setTimeout(initSnapping, 3000);
                })();
            }
        }, 10000);
    }

    // Thiết lập snapping cho draw interaction
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
                        // Chỉ bắt điểm khi đã vẽ được ít nhất 2 điểm cố định
                        // (mảng coords có ít nhất 3 phần tử gồm cả điểm pointer)
                        if (coords.length > 2) {
                            firstCoord = coords[0];
                        }
                    } else if (type === 'Polygon') {
                        const rings = geom.getCoordinates();
                        // Đối với Polygon, cần ít nhất 3 điểm cố định
                        // (mảng rings[0] có ít nhất 4 phần tử bao gồm cả điểm pointer và điểm đóng)
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

                                // Nếu người dùng click để vẽ điểm cuối vào điểm đầu → tự động kết thúc
                                if (mapBrowserEvent.type === 'pointerup' || mapBrowserEvent.type === 'click' || mapBrowserEvent.type === 'singleclick') {
                                    shouldFinish = true;
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                console.error('[Snapping] Error in handleEvent:', e);
            }

            // Chạy trình xử lý gốc trước để OpenLayers thêm điểm cuối cùng
            const result = originalHandleEvent.call(this, mapBrowserEvent);

            if (shouldFinish) {
                try {
                    this.finishDrawing();
                } catch (e) {}
            }

            return result;
        };

        console.log('[Snapping] 📌 Wrapped draw interaction');
    }

    // Quét tìm tất cả Draw interactions hiện tại
    function scanDrawInteractions() {
        try {
            olMap.getInteractions().forEach(interaction => {
                if (typeof interaction.finishDrawing === 'function' && typeof interaction.removeLastPoint === 'function') {
                    setupSnappingForDraw(interaction);
                }
            });
        } catch (e) {}
    }

    // Init Snapping Module
    function initSnapping() {
        olMap = window.__olMap || findOlMap();
        if (!olMap) { setTimeout(initSnapping, 3000); return; }

        console.log('[Snapping] ✅ Map found. Initializing snapping...');

        // Lắng nghe sự kiện thêm interaction mới vào map
        try {
            olMap.getInteractions().on('add', (e) => {
                const interaction = e.element;
                if (interaction && typeof interaction.finishDrawing === 'function' && typeof interaction.removeLastPoint === 'function') {
                    setupSnappingForDraw(interaction);
                }
            });
        } catch (e) {}

        // Định kỳ quét để đảm bảo không bỏ sót (khi React render lại)
        setInterval(scanDrawInteractions, 2000);
        scanDrawInteractions();

        console.log('[Snapping] 📌 Snapping ready! Tolerance = 20px');
    }
})();
