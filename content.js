// Content script: inject code vào page context (MAIN world)
['inject.js', 'autosave.js'].forEach(file => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL(file);
    script.onload = function () { this.remove(); };
    (document.head || document.documentElement).appendChild(script);
});
