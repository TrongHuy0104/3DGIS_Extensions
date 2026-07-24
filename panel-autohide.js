// ============================================================
//  PANEL AUTO-HIDE — Ẩn panel "Biên tập dữ liệu" sang trái
//  Dùng MutationObserver trên style attribute + RAF loop
// ============================================================

(function () {
    'use strict';

    function log(...args) { console.log('[PanelHide]', ...args); }

    const TRIGGER_ZONE = 80;

    let panelWrapper = null;
    let isVisible = false;
    let mouseX = 9999;
    let styleObserver = null;
    let suppressStyleObserver = false;

    // ==================== INJECT CSS ====================
    (function () {
        const s = document.createElement('style');
        s.textContent = `
            [data-autohide] {
                transition: transform 0.5s cubic-bezier(.25, .1, .25, 1) !important;
                will-change: transform !important;
            }
        `;
        (document.head || document.documentElement).appendChild(s);
        log('CSS injected');
    })();

    // ==================== TÌM PANEL ====================
    function findPanel() {
        const titles = document.querySelectorAll('.ant-card-head-title');
        for (const el of titles) {
            if (el.textContent.trim() === 'Biên tập dữ liệu') {
                const card = el.closest('.ant-card');
                if (!card) continue;
                const wrapper = card.parentElement;
                log('Found wrapper element:', wrapper?.tagName, wrapper?.className?.substring(0, 50));
                return wrapper;
            }
        }
        return null;
    }

    // ==================== SET TRANSFORM ====================
    function setTransform(el, value) {
        // Tạm tắt observer để tránh infinite loop
        suppressStyleObserver = true;
        el.style.setProperty('transform', value, 'important');
        el.style.setProperty('opacity', '1', 'important');
        el.style.setProperty('top', '0px', 'important');
        // Re-enable observer ở microtask tiếp theo
        Promise.resolve().then(() => { suppressStyleObserver = false; });
    }

    function hidePanel() {
        if (!panelWrapper) return;
        setTransform(panelWrapper, 'translateX(-110%)');
        isVisible = false;
    }

    function showPanel() {
        if (!panelWrapper) return;
        setTransform(panelWrapper, 'translateX(0%)');
        isVisible = true;
    }

    // ==================== STYLE OBSERVER ====================
    // Bắt React ghi đè style → override lại ngay
    function watchStyleChanges(el) {
        if (styleObserver) styleObserver.disconnect();

        styleObserver = new MutationObserver((mutations) => {
            if (suppressStyleObserver) return;
            for (const m of mutations) {
                if (m.attributeName === 'style') {
                    // React vừa ghi đè style → re-apply transform
                    const current = el.style.transform;
                    if (isVisible && current !== 'translateX(0%)') {
                        log('React overrode style (visible), re-applying...');
                        setTransform(el, 'translateX(0%)');
                    } else if (!isVisible && current !== 'translateX(-110%)') {
                        log('React overrode style (hidden), re-applying...');
                        setTransform(el, 'translateX(-110%)');
                    }
                }
            }
        });

        styleObserver.observe(el, { attributes: true, attributeFilter: ['style'] });
        log('Style observer attached');
    }

    // ==================== MOUSE TRACKING ====================
    document.addEventListener('mousemove', (e) => {
        mouseX = e.clientX;
        if (!panelWrapper || !document.body.contains(panelWrapper)) return;

        // Don't auto-hide while user is interacting with the taskbar
        if (window.__taskbarHovered) return;

        if (!isVisible && mouseX <= TRIGGER_ZONE) {
            showPanel();
            log('→ Show (mouse at', mouseX, ')');
        } else if (isVisible) {
            const rect = panelWrapper.getBoundingClientRect();
            if (mouseX > rect.right + 50) {
                hidePanel();
                log('→ Hide (mouse at', mouseX, ')');
            }
        }
    });

    document.addEventListener('mouseleave', () => {
        mouseX = 9999;
        if (isVisible && panelWrapper) {
            hidePanel();
            log('→ Hide (mouse left window)');
        }
    });

    // ==================== INIT ====================
    function trySetup() {
        // Đã setup rồi và panel còn trong DOM
        if (panelWrapper && document.body.contains(panelWrapper)) return true;

        // Panel bị remove → reset
        if (panelWrapper && !document.body.contains(panelWrapper)) {
            log('Panel removed from DOM');
            if (styleObserver) styleObserver.disconnect();
            panelWrapper = null;
            isVisible = false;
        }

        const wrapper = findPanel();
        if (!wrapper) return false;

        panelWrapper = wrapper;
        wrapper.setAttribute('data-autohide', '1');

        // Ẩn ngay lập tức
        hidePanel();

        // Watch React style changes
        watchStyleChanges(wrapper);

        console.log('[PanelHide] ✅ Panel auto-hide activated!');
        return true;
    }

    // Polling liên tục để tìm panel (đơn giản + đáng tin cậy)
    log('Starting panel detection...');
    const poll = setInterval(() => {
        trySetup();
    }, 500);

    // Dừng polling sau 5 phút
    setTimeout(() => clearInterval(poll), 300000);

})();
