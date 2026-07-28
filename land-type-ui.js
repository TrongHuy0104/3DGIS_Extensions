// ============================================================
//  LAND TYPE UI — Chọn loại đất trước khi vẽ
//  - Badge trên taskbar hiển thị loại đất đang chọn
//  - Panel selector: danh sách loại đất nhóm theo NNP/PNN/CSD
//  - Lưu selection vào window.__currentLandType
// ============================================================

(function () {
    'use strict';

    var DEBUG = false;
    function log() { if (DEBUG) console.log.apply(console, ['[LandTypeUI]'].concat(Array.prototype.slice.call(arguments))); }

    var panelVisible = false;
    var badgeEl = null;
    var panelEl = null;

    // ==================== INJECT CSS ====================
    function injectStyles() {
        var STYLE_ID = '__lt-style';
        if (document.getElementById(STYLE_ID)) return;

        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = '\
/* ═══ Land Type Badge on Taskbar ═══════════════════ */\
#__lt-badge {\
    display: inline-flex;\
    align-items: center;\
    gap: 5px;\
    min-width: 32px;\
    height: 28px;\
    padding: 0 8px;\
    border: 1px solid transparent;\
    border-radius: 6px;\
    background: transparent;\
    color: #444;\
    font-size: 12px;\
    font-family: "Segoe UI", system-ui, sans-serif;\
    cursor: pointer;\
    user-select: none;\
    transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;\
    white-space: nowrap;\
}\
#__lt-badge:hover {\
    background: #f0f0f0;\
    border-color: rgba(0,0,0,0.10);\
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);\
}\
#__lt-badge.--active {\
    background: #e6f4ff;\
    border-color: #1677ff;\
    color: #1677ff;\
    box-shadow: 0 0 0 2px rgba(22, 119, 255, 0.15);\
}\
#__lt-badge .lt-color-box {\
    width: 14px;\
    height: 14px;\
    border-radius: 3px;\
    border: 1px solid rgba(0,0,0,0.15);\
    flex-shrink: 0;\
}\
#__lt-badge .lt-code {\
    font-weight: 600;\
    font-size: 12px;\
}\
#__lt-badge .lt-arrow {\
    font-size: 10px;\
    opacity: 0.5;\
    margin-left: 1px;\
}\
\
/* ═══ Land Type Selector Panel ═════════════════════ */\
#__lt-panel {\
    position: fixed;\
    z-index: 99998;\
    min-width: 300px;\
    max-width: 340px;\
    max-height: 460px;\
    background: rgba(15, 23, 42, 0.96);\
    backdrop-filter: blur(20px);\
    -webkit-backdrop-filter: blur(20px);\
    border: 1px solid rgba(255, 255, 255, 0.1);\
    border-radius: 14px;\
    color: #e2e8f0;\
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);\
    font-family: "Segoe UI", system-ui, sans-serif;\
    font-size: 13px;\
    display: flex;\
    flex-direction: column;\
    opacity: 0;\
    transform: translateY(-8px) scale(0.96);\
    pointer-events: none;\
    transition: all 0.22s cubic-bezier(0.4, 0, 0.2, 1);\
}\
#__lt-panel.--visible {\
    opacity: 1;\
    transform: translateY(0) scale(1);\
    pointer-events: auto;\
}\
\
/* Header */\
.lt-panel-header {\
    display: flex;\
    justify-content: space-between;\
    align-items: center;\
    padding: 14px 16px 10px;\
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);\
    flex-shrink: 0;\
}\
.lt-panel-header span {\
    font-weight: 600;\
    font-size: 14px;\
    letter-spacing: -0.01em;\
}\
.lt-panel-close {\
    background: none;\
    border: none;\
    color: #94a3b8;\
    cursor: pointer;\
    font-size: 16px;\
    padding: 2px 6px;\
    border-radius: 4px;\
    transition: all 0.15s;\
}\
.lt-panel-close:hover { color: #e2e8f0; background: rgba(255,255,255,0.1); }\
\
/* Search */\
.lt-search-wrap {\
    padding: 8px 12px;\
    flex-shrink: 0;\
}\
.lt-search-wrap input {\
    width: 100%;\
    padding: 7px 10px;\
    background: rgba(255, 255, 255, 0.06);\
    border: 1px solid rgba(255, 255, 255, 0.1);\
    border-radius: 8px;\
    color: #e2e8f0;\
    font-size: 13px;\
    font-family: inherit;\
    outline: none;\
    transition: border-color 0.15s;\
    box-sizing: border-box;\
}\
.lt-search-wrap input::placeholder { color: #64748b; }\
.lt-search-wrap input:focus {\
    border-color: rgba(99, 102, 241, 0.5);\
    background: rgba(255, 255, 255, 0.08);\
}\
\
/* Scrollable body */\
.lt-panel-body {\
    overflow-y: auto;\
    flex: 1;\
    padding: 4px 0;\
    max-height: 340px;\
}\
.lt-panel-body::-webkit-scrollbar { width: 5px; }\
.lt-panel-body::-webkit-scrollbar-track { background: transparent; }\
.lt-panel-body::-webkit-scrollbar-thumb {\
    background: rgba(255,255,255,0.15);\
    border-radius: 3px;\
}\
\
/* Group accordion */\
.lt-group-header {\
    display: flex;\
    align-items: center;\
    gap: 6px;\
    padding: 8px 14px;\
    cursor: pointer;\
    user-select: none;\
    color: #94a3b8;\
    font-size: 12px;\
    font-weight: 600;\
    text-transform: uppercase;\
    letter-spacing: 0.04em;\
    transition: color 0.15s;\
}\
.lt-group-header:hover { color: #e2e8f0; }\
.lt-group-header .lt-group-arrow {\
    font-size: 10px;\
    transition: transform 0.2s;\
    display: inline-block;\
}\
.lt-group-header.--expanded .lt-group-arrow {\
    transform: rotate(90deg);\
}\
.lt-group-items {\
    display: none;\
}\
.lt-group-items.--expanded {\
    display: block;\
}\
\
/* Land type item */\
.lt-item {\
    display: flex;\
    align-items: center;\
    gap: 10px;\
    padding: 8px 14px 8px 28px;\
    cursor: pointer;\
    transition: background 0.12s;\
    border-left: 3px solid transparent;\
}\
.lt-item:hover {\
    background: rgba(255, 255, 255, 0.06);\
}\
.lt-item.--selected {\
    background: rgba(99, 102, 241, 0.15);\
    border-left-color: #6366f1;\
}\
.lt-item .lt-item-color {\
    width: 18px;\
    height: 18px;\
    border-radius: 4px;\
    border: 1px solid rgba(255,255,255,0.2);\
    flex-shrink: 0;\
}\
.lt-item .lt-item-info {\
    flex: 1;\
    min-width: 0;\
}\
.lt-item .lt-item-code {\
    font-weight: 700;\
    font-size: 13px;\
    color: #e2e8f0;\
}\
.lt-item .lt-item-name {\
    font-size: 11px;\
    color: #94a3b8;\
    white-space: nowrap;\
    overflow: hidden;\
    text-overflow: ellipsis;\
}\
\
/* Footer */\
.lt-panel-footer {\
    padding: 8px 12px;\
    border-top: 1px solid rgba(255, 255, 255, 0.08);\
    flex-shrink: 0;\
}\
.lt-clear-btn {\
    display: flex;\
    align-items: center;\
    gap: 6px;\
    width: 100%;\
    padding: 8px 12px;\
    background: rgba(255, 255, 255, 0.04);\
    border: 1px solid rgba(255, 255, 255, 0.08);\
    border-radius: 8px;\
    color: #94a3b8;\
    font-size: 12px;\
    font-family: inherit;\
    cursor: pointer;\
    transition: all 0.15s;\
}\
.lt-clear-btn:hover {\
    background: rgba(255, 255, 255, 0.08);\
    color: #e2e8f0;\
    border-color: rgba(255, 255, 255, 0.15);\
}\
\
/* Hidden items (search filter) */\
.lt-item.--hidden { display: none; }\
.lt-group-header.--hidden { display: none; }\
';
        document.head.appendChild(style);
    }

    // ==================== CREATE BADGE ====================
    function createBadge() {
        var badge = document.createElement('button');
        badge.id = '__lt-badge';
        badge.setAttribute('type', 'button');
        badge.setAttribute('title', 'Chọn loại đất');

        var colorBox = document.createElement('span');
        colorBox.className = 'lt-color-box';
        colorBox.style.background = '#94a3b8';

        var codeSpan = document.createElement('span');
        codeSpan.className = 'lt-code';
        codeSpan.textContent = 'Loại đất';

        var arrow = document.createElement('span');
        arrow.className = 'lt-arrow';
        arrow.textContent = '▾';

        badge.appendChild(colorBox);
        badge.appendChild(codeSpan);
        badge.appendChild(arrow);

        badge.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            togglePanel();
        });

        return badge;
    }

    // ==================== UPDATE BADGE ====================
    function updateBadge() {
        if (!badgeEl) return;
        var colorBox = badgeEl.querySelector('.lt-color-box');
        var codeSpan = badgeEl.querySelector('.lt-code');

        if (window.__currentLandType) {
            var info = window.__getLandType(window.__currentLandType);
            if (info) {
                colorBox.style.background = 'rgb(' + info.rgb[0] + ',' + info.rgb[1] + ',' + info.rgb[2] + ')';
                codeSpan.textContent = info.code;
                badgeEl.setAttribute('title', info.code + ' — ' + info.name);
                badgeEl.classList.add('--active');
            }
        } else {
            colorBox.style.background = '#94a3b8';
            codeSpan.textContent = 'Loại đất';
            badgeEl.setAttribute('title', 'Chọn loại đất');
            badgeEl.classList.remove('--active');
        }
    }

    // ==================== CREATE PANEL ====================
    function createPanel() {
        var panel = document.createElement('div');
        panel.id = '__lt-panel';

        // ── Header ──
        var header = document.createElement('div');
        header.className = 'lt-panel-header';
        var title = document.createElement('span');
        title.textContent = '🏷 Chọn loại đất';
        var closeBtn = document.createElement('button');
        closeBtn.className = 'lt-panel-close';
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            togglePanel(false);
        });
        header.appendChild(title);
        header.appendChild(closeBtn);
        panel.appendChild(header);

        // ── Search ──
        var searchWrap = document.createElement('div');
        searchWrap.className = 'lt-search-wrap';
        var searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = '🔍 Tìm mã hoặc tên loại đất...';
        searchInput.addEventListener('input', function () {
            filterItems(this.value.trim().toLowerCase());
        });
        // Prevent keyboard shortcuts from firing when typing in search
        searchInput.addEventListener('keydown', function (e) {
            e.stopPropagation();
        });
        searchWrap.appendChild(searchInput);
        panel.appendChild(searchWrap);

        // ── Body (scrollable) ──
        var body = document.createElement('div');
        body.className = 'lt-panel-body';
        body.id = '__lt-panel-body';

        var groups = window.__LAND_GROUPS || [];
        for (var g = 0; g < groups.length; g++) {
            var group = groups[g];
            var types = window.__getLandTypesByGroup ? window.__getLandTypesByGroup(group.code) : [];

            // Group header
            var groupHeader = document.createElement('div');
            groupHeader.className = 'lt-group-header' + (g === 0 ? ' --expanded' : '');
            groupHeader.setAttribute('data-group', group.code);
            groupHeader.innerHTML = '<span class="lt-group-arrow">▸</span> ' +
                group.icon + ' ' + group.name + ' <span style="opacity:0.5">(' + types.length + ')</span>';
            groupHeader.addEventListener('click', (function (gc) {
                return function () {
                    this.classList.toggle('--expanded');
                    var items = body.querySelector('.lt-group-items[data-group="' + gc + '"]');
                    if (items) items.classList.toggle('--expanded');
                };
            })(group.code));
            body.appendChild(groupHeader);

            // Group items container
            var itemsContainer = document.createElement('div');
            itemsContainer.className = 'lt-group-items' + (g === 0 ? ' --expanded' : '');
            itemsContainer.setAttribute('data-group', group.code);

            for (var t = 0; t < types.length; t++) {
                var lt = types[t];
                var item = document.createElement('div');
                item.className = 'lt-item';
                item.setAttribute('data-code', lt.code);
                item.setAttribute('data-search', (lt.code + ' ' + lt.name).toLowerCase());

                // Check if currently selected
                if (window.__currentLandType === lt.code) {
                    item.classList.add('--selected');
                }

                var colorEl = document.createElement('span');
                colorEl.className = 'lt-item-color';
                colorEl.style.background = 'rgb(' + lt.rgb[0] + ',' + lt.rgb[1] + ',' + lt.rgb[2] + ')';

                var infoEl = document.createElement('div');
                infoEl.className = 'lt-item-info';

                var codeEl = document.createElement('div');
                codeEl.className = 'lt-item-code';
                codeEl.textContent = lt.code;

                var nameEl = document.createElement('div');
                nameEl.className = 'lt-item-name';
                nameEl.textContent = lt.name;

                infoEl.appendChild(codeEl);
                infoEl.appendChild(nameEl);
                item.appendChild(colorEl);
                item.appendChild(infoEl);

                item.addEventListener('click', (function (code) {
                    return function (e) {
                        e.stopPropagation();
                        selectLandType(code);
                    };
                })(lt.code));

                itemsContainer.appendChild(item);
            }

            body.appendChild(itemsContainer);
        }

        panel.appendChild(body);

        // ── Footer: Clear button ──
        var footer = document.createElement('div');
        footer.className = 'lt-panel-footer';
        var clearBtn = document.createElement('button');
        clearBtn.className = 'lt-clear-btn';
        clearBtn.innerHTML = '⊘ Bỏ chọn loại đất';
        clearBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            selectLandType(null);
        });
        footer.appendChild(clearBtn);
        panel.appendChild(footer);

        // Click inside panel → stop propagation
        panel.addEventListener('click', function (e) { e.stopPropagation(); });

        return panel;
    }

    // ==================== SELECT LAND TYPE ====================
    function selectLandType(code) {
        window.__currentLandType = code;

        // Update selected state in panel
        if (panelEl) {
            var items = panelEl.querySelectorAll('.lt-item');
            for (var i = 0; i < items.length; i++) {
                if (items[i].getAttribute('data-code') === code) {
                    items[i].classList.add('--selected');
                } else {
                    items[i].classList.remove('--selected');
                }
            }
        }

        // Update badge
        updateBadge();

        // Close panel
        togglePanel(false);

        // Log
        if (code) {
            var info = window.__getLandType(code);
            console.log('[LandTypeUI] ✅ Selected: ' + code + ' — ' + (info ? info.name : ''));
        } else {
            console.log('[LandTypeUI] ⊘ Land type cleared');
        }

        // Dispatch event for other modules
        document.dispatchEvent(new CustomEvent('3dg:landtype-changed', {
            detail: { code: code }
        }));
    }

    // ==================== FILTER ITEMS ====================
    function filterItems(query) {
        if (!panelEl) return;
        var body = panelEl.querySelector('.lt-panel-body');
        if (!body) return;

        var items = body.querySelectorAll('.lt-item');
        var groupHeaders = body.querySelectorAll('.lt-group-header');
        var groupContainers = body.querySelectorAll('.lt-group-items');

        // Track visible count per group
        var visiblePerGroup = {};

        for (var i = 0; i < items.length; i++) {
            var searchData = items[i].getAttribute('data-search') || '';
            var match = !query || searchData.indexOf(query) !== -1;
            items[i].classList.toggle('--hidden', !match);

            // Find parent group
            var parent = items[i].parentElement;
            var groupCode = parent ? parent.getAttribute('data-group') : null;
            if (groupCode) {
                if (!visiblePerGroup[groupCode]) visiblePerGroup[groupCode] = 0;
                if (match) visiblePerGroup[groupCode]++;
            }
        }

        // Show/hide group headers and expand groups with matches
        for (var j = 0; j < groupHeaders.length; j++) {
            var gc = groupHeaders[j].getAttribute('data-group');
            var hasVisible = (visiblePerGroup[gc] || 0) > 0;
            groupHeaders[j].classList.toggle('--hidden', !hasVisible && !!query);

            // Auto-expand groups with matches when searching
            if (query && hasVisible) {
                groupHeaders[j].classList.add('--expanded');
                var container = body.querySelector('.lt-group-items[data-group="' + gc + '"]');
                if (container) container.classList.add('--expanded');
            }
        }
    }

    // ==================== TOGGLE PANEL ====================
    function togglePanel(forceState) {
        panelVisible = forceState !== undefined ? forceState : !panelVisible;

        if (panelVisible) {
            // Position panel below badge
            positionPanel();
            panelEl.classList.add('--visible');

            // Focus search input
            var searchInput = panelEl.querySelector('input');
            if (searchInput) {
                searchInput.value = '';
                filterItems(''); // Reset filter
                setTimeout(function () { searchInput.focus(); }, 100);
            }
        } else {
            panelEl.classList.remove('--visible');
        }
    }

    function positionPanel() {
        if (!badgeEl || !panelEl) return;
        var rect = badgeEl.getBoundingClientRect();

        // Position below badge, aligned right
        panelEl.style.top = (rect.bottom + 6) + 'px';

        // Align right edge with badge right edge, but don't go off screen
        var panelWidth = 320; // approximate
        var left = rect.right - panelWidth;
        if (left < 10) left = 10;
        panelEl.style.left = left + 'px';
    }

    // ==================== INJECT INTO TASKBAR ====================
    function injectIntoTaskbar() {
        var taskbar = document.getElementById('__3dg-taskbar');
        if (!taskbar) return false;

        // Check if already injected
        if (document.getElementById('__lt-badge')) return true;

        // Create badge
        badgeEl = createBadge();

        // Insert before the pin badge (last child)
        var pinBadge = taskbar.querySelector('.tb-pin-badge');
        if (pinBadge) {
            taskbar.insertBefore(badgeEl, pinBadge);
        } else {
            taskbar.appendChild(badgeEl);
        }

        // Create and append panel to body
        panelEl = createPanel();
        document.body.appendChild(panelEl);

        // Close panel when clicking outside
        document.addEventListener('click', function () {
            if (panelVisible) togglePanel(false);
        });

        // Close panel on Escape
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && panelVisible) {
                togglePanel(false);
            }
        });

        log('Badge injected into taskbar');
        return true;
    }

    // ==================== INIT ====================
    function init() {
        // Check prerequisites
        if (!window.__LAND_TYPES || !window.__LAND_GROUPS) {
            console.warn('[LandTypeUI] ⚠️ land-types.js not loaded yet, retrying...');
            setTimeout(init, 1000);
            return;
        }

        injectStyles();

        // Try to inject into taskbar (may not be created yet)
        if (!injectIntoTaskbar()) {
            // Poll until taskbar is ready
            var attempts = 0;
            var timer = setInterval(function () {
                attempts++;
                if (injectIntoTaskbar()) {
                    clearInterval(timer);
                    console.log('[LandTypeUI] ✅ Ready! Click badge on taskbar to select land type.');
                } else if (attempts > 30) {
                    clearInterval(timer);
                    console.warn('[LandTypeUI] ⚠️ Taskbar not found after 30s');
                }
            }, 1000);
        } else {
            console.log('[LandTypeUI] ✅ Ready! Click badge on taskbar to select land type.');
        }
    }

    // Start
    if (document.readyState === 'complete') {
        setTimeout(init, 500);
    } else {
        window.addEventListener('load', function () { setTimeout(init, 500); });
    }
})();
