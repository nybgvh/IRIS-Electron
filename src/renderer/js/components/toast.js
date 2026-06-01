(function () {
  function toast(message, type) {
    const stack = document.getElementById('toast-stack');
    if (!stack) return;
    const el = document.createElement('div');
    el.className = 'toast' + (type === 'error' ? ' error' : '');
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }
  window.IRIS = window.IRIS || {};
  window.IRIS.toast = toast;
})();
