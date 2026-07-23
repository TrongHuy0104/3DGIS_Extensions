// Content script chỉ làm 1 việc: inject code vào page context
const script = document.createElement('script');
script.src = chrome.runtime.getURL('inject.js');
script.onload = function () { this.remove(); };
(document.head || document.documentElement).appendChild(script);
