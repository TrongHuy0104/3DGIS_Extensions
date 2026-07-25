// Content script: inject code vào page context (MAIN world)
// Load tuần tự để đảm bảo inject.js setup shared globals trước
const scripts = ['inject.js', 'autosave.js', 'selection.js', 'panel-autohide.js', 'snapping.js', 'taskbar.js', 'split.js'];

function injectNext(index) {
    if (index >= scripts.length) {
        // All scripts loaded — health check sau 5s
        const check = document.createElement('script');
        check.textContent = `
            setTimeout(function() {
                console.log('[Extension] ─── Health Check ───');
                console.log('[Extension] __olMap:', !!window.__olMap);
                console.log('[Extension] __findOlMap:', !!window.__findOlMap);
                console.log('[Extension] __undoStack:', !!window.__undoStack);
                console.log('[Extension] __ctrlZHandler:', !!window.__ctrlZHandler);
                console.log('[Extension] __splitToolActive:', window.__splitToolActive);
                console.log('[Extension] __toggleSplitTool:', !!window.__toggleSplitTool);
                console.log('[Extension] Taskbar:', !!document.getElementById('__3dg-taskbar'));
                console.log('[Extension] AutoSave indicator:', !!document.getElementById('as-indicator'));
                console.log('[Extension] ─── End Check ───');
            }, 5000);
        `;
        (document.head || document.documentElement).appendChild(check);
        check.remove();
        return;
    }
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL(scripts[index]);
    script.onload = function () {
        console.log('[Extension] ✅ Loaded:', scripts[index]);
        this.remove();
        injectNext(index + 1);
    };
    script.onerror = function () {
        console.error('[Extension] ❌ FAILED to load:', scripts[index]);
        this.remove();
        // Tiếp tục load script tiếp theo dù script hiện tại lỗi
        injectNext(index + 1);
    };
    (document.head || document.documentElement).appendChild(script);
}

injectNext(0);
