// Content script: inject code vào page context (MAIN world)
// Load tuần tự để đảm bảo inject.js setup shared globals trước
const scripts = ['inject.js', 'autosave.js', 'selection.js', 'panel-autohide.js', 'snapping.js', 'taskbar.js'];

function injectNext(index) {
    if (index >= scripts.length) return;
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL(scripts[index]);
    script.onload = function () {
        this.remove();
        injectNext(index + 1);
    };
    (document.head || document.documentElement).appendChild(script);
}

injectNext(0);
