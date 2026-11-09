// Sets the theme before the app paints, so a dark-mode visitor never sees a
// flash of light. Saved choice first, then the device setting. A file rather
// than an inline script so the CSP can keep script-src 'self'.
(function () {
  try {
    var stored = localStorage.getItem('theme');
    var dark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  } catch (e) {
    // Storage blocked (some private modes): the toggle still works for the visit.
  }
})();
