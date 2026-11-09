import type { App } from 'vue';
import type { Router } from 'vue-router';

/**
 * Starts Sentry when VITE_SENTRY_DSN is set (unset locally, so dev errors
 * stay out of it). It loads a few seconds after the page has, when the
 * browser is idle, so it never competes with first paint. Errors before then
 * aren't reported.
 */
export function startMonitoring(app: App, router: Router) {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn || typeof window === 'undefined') return;
  const start = () => {
    import('./sentry').then(({ initSentry }) => initSentry(app, router, dsn)).catch(() => {});
  };
  const whenIdle = () =>
    setTimeout(() => {
      if ('requestIdleCallback' in window) window.requestIdleCallback(start, { timeout: 3000 });
      else start();
    }, 4000);
  if (document.readyState === 'complete') whenIdle();
  else window.addEventListener('load', whenIdle, { once: true });
}
