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

    // ── Create the taskbar element ────────────────────────────
    function createTaskbar() {
        const bar = document.createElement('div');
        bar.id = '__3dg-taskbar';

        for (let i = 0; i < actions.length; i++) {
            bar.appendChild(createButton(actions[i]));
        }

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
        header.addEventListener('mouseenter', function () {
            window.__taskbarHovered = true;
            reveal();
        });
        header.addEventListener('mouseleave', function () {
            window.__taskbarHovered = false;
            scheduleHide();
        });

        // Taskbar hover: keep open + suppress panel-autohide
        bar.addEventListener('mouseenter', function () {
            cancelHide();
            window.__taskbarHovered = true;
        });
        bar.addEventListener('mouseleave', function () {
            window.__taskbarHovered = false;
            scheduleHide();
        });

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
