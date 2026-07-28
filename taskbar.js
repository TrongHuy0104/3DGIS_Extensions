// ============================================================
// Floating Taskbar — inject below <header>
// Hover reveal + Ctrl+T to pin/unpin
// Pure JS · No framework · No innerHTML
// ============================================================
(function () {
    'use strict';

    // ── Placeholder actions (replace logic later) ─────────────
    function performUndo() {
        const ev = new KeyboardEvent('keydown', {
            key: 'z', code: 'KeyZ', ctrlKey: true,
            bubbles: true, cancelable: true
        });
        document.dispatchEvent(ev);
    }

    function performRedo() {
        const ev = new KeyboardEvent('keydown', {
            key: 'y', code: 'KeyY', ctrlKey: true,
            bubbles: true, cancelable: true
        });
        document.dispatchEvent(ev);
    }

    // ── Action config ─────────────────────────────────────────
    const actions = [
        {
            id: 'undo',
            icon: '\u21B6',
            title: 'Quay l\u1EA1i (Ctrl + Z)',
            shortcut: 'Ctrl+Z',
            onClick: performUndo
        },
        {
            id: 'redo',
            icon: '\u21B7',
            title: 'Ti\u1EBFp t\u1EE5c (Ctrl + Y)',
            shortcut: 'Ctrl+Y',
            onClick: performRedo
        },
        {
            id: 'split',
            icon: '\u2702',
            title: 'Chia \u0111\u01b0\u1eddng (Alt+S)',
            shortcut: 'Alt+S',
            toggle: true,
            isActive: function () { return !!window.__splitToolActive; },
            onClick: function () { if (window.__toggleSplitTool) window.__toggleSplitTool(); }
        }
    ];

    // ── Selection mode group config ───────────────────────────
    // These are rendered as a separate button group with radio behavior
    const selectionModes = [
        {
            id: 'sel-rectangle',
            icon: '\uD83D\uDD32',
            label: 'Rectangle',
            title: 'Ch\u1ECDn b\u1EB1ng Rectangle (Shift+Drag)',
            mode: 'rectangle'
        },
        {
            id: 'sel-polygon',
            icon: '\u2B20',
            label: 'Polygon',
            title: 'Ch\u1ECDn b\u1EB1ng Polygon (Shift+Click)',
            mode: 'polygon'
        }
    ];

    // ── CSS injection ─────────────────────────────────────────
    function injectStyle() {
        const STYLE_ID = '__3dg-taskbar-style';
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
/* ═══ Taskbar container ═══════════════════════════ */
#__3dg-taskbar {
    position: fixed;
    left: 0;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px 6px;
    background: rgba(255,255,255,0.96);
    border-bottom: 1px solid rgba(0,0,0,0.06);
    box-shadow: 0 2px 12px rgba(0,0,0,0.10);
    border-radius: 0 0 10px 10px;
    z-index: 9990;
    pointer-events: auto;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);

    /* hidden by default */
    transform: translateY(-100%);
    opacity: 0;
    visibility: hidden;
    transition: transform 0.28s cubic-bezier(.4,0,.2,1),
                opacity   0.22s ease,
                visibility 0s linear 0.28s;
}
#__3dg-taskbar.--visible {
    transform: translateY(0);
    opacity: 1;
    visibility: visible;
    transition: transform 0.28s cubic-bezier(.4,0,.2,1),
                opacity   0.22s ease,
                visibility 0s linear 0s;
}

/* Pinned indicator — subtle left accent */
#__3dg-taskbar.--pinned {
    border-left: 3px solid #1677ff;
}

/* ═══ Action buttons ══════════════════════════════ */
#__3dg-taskbar .tb-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 32px;
    height: 28px;
    padding: 0 7px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: #444;
    font-size: 15px;
    cursor: pointer;
    user-select: none;
    transition: background 0.15s, color 0.15s, border-color 0.15s,
                box-shadow 0.15s, transform 0.1s;
}
#__3dg-taskbar .tb-btn:hover:not(:disabled) {
    background: #f0f0f0;
    border-color: rgba(0,0,0,0.10);
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    color: #111;
}
#__3dg-taskbar .tb-btn:active:not(:disabled) {
    background: #e2e2e2;
    transform: scale(0.94);
}
#__3dg-taskbar .tb-btn:disabled {
    opacity: 0.30;
    cursor: not-allowed;
}
#__3dg-taskbar .tb-btn.--active {
    background: #e6f4ff;
    border-color: #1677ff;
    color: #1677ff;
    box-shadow: 0 0 0 2px rgba(22, 119, 255, 0.15);
}
#__3dg-taskbar .tb-btn.--active:hover {
    background: #d6eaff;
}

/* ═══ Separator ═══════════════════════════════════ */
#__3dg-taskbar .tb-sep {
    width: 1px;
    height: 20px;
    background: rgba(0,0,0,0.10);
    margin: 0 4px;
    flex-shrink: 0;
}

/* ═══ Selection mode group ════════════════════════ */
#__3dg-taskbar .tb-sel-group {
    display: inline-flex;
    align-items: center;
    gap: 1px;
    background: #f5f5f5;
    border-radius: 6px;
    padding: 2px;
}
#__3dg-taskbar .tb-sel-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    color: #666;
    cursor: pointer;
    font-size: 12px;
    font-family: 'Segoe UI', system-ui, sans-serif;
    white-space: nowrap;
    user-select: none;
    transition: all 0.15s ease;
}
#__3dg-taskbar .tb-sel-btn:hover {
    background: rgba(255,255,255,0.8);
    color: #333;
}
#__3dg-taskbar .tb-sel-btn.--active {
    background: #fff;
    border-color: #9333ea;
    color: #9333ea;
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(147,51,234,0.15);
}
#__3dg-taskbar .tb-sel-btn .tb-sel-icon {
    font-size: 13px;
}
#__3dg-taskbar .tb-rule-btn {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 3px 7px;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    color: #999;
    cursor: pointer;
    font-size: 11px;
    font-family: 'Segoe UI', system-ui, sans-serif;
    white-space: nowrap;
    user-select: none;
    transition: all 0.15s ease;
}
#__3dg-taskbar .tb-rule-btn:hover {
    background: #f0f0f0;
    color: #666;
}
#__3dg-taskbar .tb-rule-btn.--active {
    background: #e8f4f8;
    border-color: #0891b2;
    color: #0891b2;
    font-weight: 600;
}

/* ═══ Pin status badge ════════════════════════════ */
#__3dg-taskbar .tb-pin-badge {
    display: none;
    align-items: center;
    margin-left: auto;
    padding: 0 6px;
    font-size: 11px;
    color: #1677ff;
    user-select: none;
    white-space: nowrap;
}
#__3dg-taskbar.--pinned .tb-pin-badge {
    display: inline-flex;
}
`;
        document.head.appendChild(style);
    }

    // ── Create a single action button ─────────────────────────
    function createButton(cfg) {
        const btn = document.createElement('button');
        btn.className = 'tb-btn';
        btn.id = '__3dg-btn-' + cfg.id;
        btn.setAttribute('title', cfg.title);
        btn.setAttribute('type', 'button');

        if (cfg.toggle && typeof cfg.isActive === 'function' && cfg.isActive()) {
            btn.classList.add('--active');
        }

        const iconSpan = document.createElement('span');
        iconSpan.textContent = cfg.icon;
        btn.appendChild(iconSpan);

        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (!btn.disabled && typeof cfg.onClick === 'function') {
                cfg.onClick();
                // Update toggle state after click
                if (cfg.toggle && typeof cfg.isActive === 'function') {
                    // Small delay to let the tool update its state
                    setTimeout(function () {
                        btn.classList.toggle('--active', cfg.isActive());
                    }, 50);
                }
            }
        });

        return btn;
    }

    // ── Create selection mode group ─────────────────────────────
    function createSelectionGroup() {
        var group = document.createElement('div');
        group.className = 'tb-sel-group';
        group.id = '__3dg-sel-group';

        // Mode buttons (radio behavior)
        for (var i = 0; i < selectionModes.length; i++) {
            (function (cfg) {
                var btn = document.createElement('button');
                btn.className = 'tb-sel-btn';
                btn.id = '__3dg-btn-' + cfg.id;
                btn.setAttribute('title', cfg.title);
                btn.setAttribute('type', 'button');

                var iconEl = document.createElement('span');
                iconEl.className = 'tb-sel-icon';
                iconEl.textContent = cfg.icon;
                btn.appendChild(iconEl);

                var labelEl = document.createElement('span');
                labelEl.textContent = cfg.label;
                btn.appendChild(labelEl);

                // Set initial active state
                var currentMode = window.__selectionMode || 'rectangle';
                if (currentMode === cfg.mode) btn.classList.add('--active');

                btn.addEventListener('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (window.__setSelectionMode) {
                        window.__setSelectionMode(cfg.mode);
                    }
                    // Update radio state for all mode buttons
                    updateSelectionGroupState();
                });

                group.appendChild(btn);
            })(selectionModes[i]);
        }

        return group;
    }

    // ── Create rule toggle button ─────────────────────────────
    function createRuleToggle() {
        var btn = document.createElement('button');
        btn.className = 'tb-rule-btn';
        btn.id = '__3dg-btn-sel-rule';
        btn.setAttribute('type', 'button');
        btn.setAttribute('title', 'Toggle: Intersects / Contains');
        updateRuleBtnText(btn);

        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (window.__toggleSelectionRule) {
                window.__toggleSelectionRule();
            }
            setTimeout(function () {
                updateRuleBtnText(btn);
            }, 50);
        });

        return btn;
    }

    function updateRuleBtnText(btn) {
        if (!btn) btn = document.getElementById('__3dg-btn-sel-rule');
        if (!btn) return;
        var rule = window.__selectionRule || 'intersects';
        btn.textContent = rule === 'intersects' ? '\u2229 Intersects' : '\u2282 Contains';
        btn.classList.toggle('--active', rule === 'contains');
    }

    function updateSelectionGroupState() {
        var currentMode = window.__selectionMode || 'rectangle';
        for (var i = 0; i < selectionModes.length; i++) {
            var cfg = selectionModes[i];
            var btn = document.getElementById('__3dg-btn-' + cfg.id);
            if (btn) btn.classList.toggle('--active', currentMode === cfg.mode);
        }
    }

    // Expose updater for selection.js to call
    window.__updateTaskbarSelectionState = function () {
        updateSelectionGroupState();
        updateRuleBtnText();
    };

    // ── Create the taskbar element ────────────────────────────
    function createTaskbar() {
        const bar = document.createElement('div');
        bar.id = '__3dg-taskbar';

        // Action buttons (undo, redo, split)
        for (let i = 0; i < actions.length; i++) {
            bar.appendChild(createButton(actions[i]));
        }

        // Separator
        var sep1 = document.createElement('div');
        sep1.className = 'tb-sep';
        bar.appendChild(sep1);

        // Selection mode group
        bar.appendChild(createSelectionGroup());

        // Rule toggle
        bar.appendChild(createRuleToggle());

        // Pin status badge (shown only when pinned)
        const badge = document.createElement('span');
        badge.className = 'tb-pin-badge';
        badge.textContent = '\uD83D\uDCCC Ctrl+Alt+T';
        bar.appendChild(badge);

        return bar;
    }

    // ── Show / Hide ───────────────────────────────────────────
    function showTaskbar(bar) {
        bar.classList.add('--visible');
    }

    function hideTaskbar(bar) {
        bar.classList.remove('--visible');
    }

    // ── Position below header ─────────────────────────────────
    function positionTaskbar(header, bar) {
        const rect = header.getBoundingClientRect();
        bar.style.top = rect.bottom + 'px';
        bar.style.left = rect.left + 'px';
        bar.style.width = rect.width + 'px';
    }

    // ── Main init ─────────────────────────────────────────────
    function initTaskbar() {
        if (document.getElementById('__3dg-taskbar')) return;

        const header = document.querySelector('header');
        if (!header) {
            setTimeout(initTaskbar, 800);
            return;
        }

        injectStyle();

        const bar = createTaskbar();
        document.body.appendChild(bar);

        // Initial position
        positionTaskbar(header, bar);

        // Keep position in sync
        let rafId = null;
        function updatePosition() {
            rafId = null;
            positionTaskbar(header, bar);
        }
        function scheduleUpdate() {
            if (!rafId) rafId = requestAnimationFrame(updatePosition);
        }
        window.addEventListener('scroll', scheduleUpdate, { passive: true });
        window.addEventListener('resize', scheduleUpdate, { passive: true });

        // ── State ─────────────────────────────────────────────
        let isPinned = false;
        let hideTimer = null;
        const HIDE_DELAY = 250;

        function cancelHide() {
            if (hideTimer !== null) {
                clearTimeout(hideTimer);
                hideTimer = null;
            }
        }

        function scheduleHide() {
            if (isPinned) return;
            cancelHide();
            hideTimer = setTimeout(function () {
                hideTaskbar(bar);
                hideTimer = null;
            }, HIDE_DELAY);
        }

        function reveal() {
            cancelHide();
            positionTaskbar(header, bar);
            showTaskbar(bar);
        }

        // ── Hover: header → reveal, leave → hide ─────────────
        let currentHeader = header;

        function attachHeaderListeners(h) {
            h.addEventListener('mouseenter', function () {
                window.__taskbarHovered = true;
                reveal();
            });
            h.addEventListener('mouseleave', function () {
                window.__taskbarHovered = false;
                scheduleHide();
            });
        }

        attachHeaderListeners(header);

        // Taskbar hover: keep open + suppress panel-autohide
        bar.addEventListener('mouseenter', function () {
            cancelHide();
            window.__taskbarHovered = true;
        });
        bar.addEventListener('mouseleave', function () {
            window.__taskbarHovered = false;
            scheduleHide();
        });

        // Fallback: document mousemove → detect hover ở header area
        // Bắt trường hợp header bị React swap hoặc event listener mất
        document.addEventListener('mousemove', function (e) {
            if (!currentHeader || !document.body.contains(currentHeader)) return;
            var rect = currentHeader.getBoundingClientRect();
            var isOverHeader = (
                e.clientY >= rect.top &&
                e.clientY <= rect.bottom &&
                e.clientX >= rect.left &&
                e.clientX <= rect.right
            );
            if (isOverHeader && !bar.classList.contains('--visible')) {
                window.__taskbarHovered = true;
                reveal();
            }
        }, { passive: true });

        // Periodic: re-detect header nếu React swap DOM
        setInterval(function () {
            var newHeader = document.querySelector('header');
            if (newHeader && newHeader !== currentHeader) {
                console.log('[Taskbar] 🔄 Header changed, re-attaching');
                currentHeader = newHeader;
                attachHeaderListeners(newHeader);
                positionTaskbar(newHeader, bar);
            }
        }, 3000);

        // ── Alt+T: toggle pin ─────────────────────────────
        document.addEventListener('keydown', function (e) {
            if (e.altKey && e.ctrlKey && !e.shiftKey && (e.key === 't' || e.key === 'T')) {
                e.preventDefault();
                e.stopPropagation();

                isPinned = !isPinned;
                bar.classList.toggle('--pinned', isPinned);

                if (isPinned) {
                    reveal();
                } else {
                    scheduleHide();
                }
            }
        }, true);

        console.log('[Taskbar] \u2705 Ready (hover header + Ctrl+Alt+T to pin)');
    }

    // ── Go! ───────────────────────────────────────────────────
    initTaskbar();
})();
