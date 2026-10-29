// Loaded as a classic, blocking <script src> in index.html's <head> (not inline) since
// ROADMAP 16.8: the Content-Security-Policy allows scripts from 'self' only, and an
// external file needs no per-edit hash in the policy. Blocking is the point: it must run
// before first paint.
// ROADMAP Batch 10 item 7 — set the theme before first paint so a dark-mode
// reload never flashes the light background. The server preference (loaded by
// useTheme after mount) arrives too late for that; localStorage is the fast path,
// mirrored on every change. Wrapped in try/catch: a private window or blocked
// site-data must not stop the page rendering.
(function () {
  try {
    var stored = localStorage.getItem('betuveto_theme'); // 'light' | 'dark' | 'system' | null
    var systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var dark = stored === 'dark' || ((stored === 'system' || !stored) && systemDark);
    document.documentElement.classList.toggle('dark', dark);
  } catch {
    /* leave the light default */
  }
})();
