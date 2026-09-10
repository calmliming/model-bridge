/* Gallery scaling and compatibility for the original index.html#route links. */
(() => {
  'use strict';
  const legacyRoutes = new Set([
    'overview', 'models', 'accounts', 'account-groups', 'keys', 'users',
    'payments', 'redeem-codes', 'subscription-plans', 'stats', 'docs',
    'api-docs', 'settings', 'user-overview', 'user-models', 'user-keys',
    'user-usage', 'user-api-docs', 'landing', 'login', 'user-login', 'accept-invite',
  ]);
  const redirectLegacyRoute = () => {
    const route = location.hash.slice(1);
    if (!legacyRoutes.has(route)) return false;
    location.replace('overview.html#' + (route === 'user-login' ? 'login' : route));
    return true;
  };
  if (redirectLegacyRoute()) return;
  window.addEventListener('hashchange', redirectLegacyRoute);
  const viewports = [...document.querySelectorAll('.preview-viewport')];
  const resize = (viewport) => {
    viewport.style.setProperty('--preview-scale', String(viewport.clientWidth / 1280));
  };
  viewports.forEach(resize);
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver((entries) => {
      entries.forEach(({ target }) => resize(target));
    });
    viewports.forEach((viewport) => observer.observe(viewport));
  } else {
    window.addEventListener('resize', () => viewports.forEach(resize));
  }
})();
