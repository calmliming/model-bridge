/* Standalone landing-page interactions. No API requests or external dependencies. */
(() => {
  'use strict';
  if (new URLSearchParams(location.search).has('preview')) {
    document.documentElement.dataset.preview = 'true';
    return;
  }
  const menu = document.querySelector('[data-menu]');
  const nav = document.querySelector('.site-nav');
  const closeMenu = () => {
    menu?.setAttribute('aria-expanded', 'false');
    nav?.classList.remove('is-open');
  };
  menu?.addEventListener('click', () => {
    const open = menu.getAttribute('aria-expanded') !== 'true';
    menu.setAttribute('aria-expanded', String(open));
    nav?.classList.toggle('is-open', open);
  });
  nav?.addEventListener('click', (event) => {
    if (event.target.closest('a')) closeMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu?.getAttribute('aria-expanded') === 'true') {
      closeMenu();
      menu.focus();
    }
  });
  const status = document.querySelector('[data-status]');
  let statusTimeout;
  const announce = (message) => {
    if (!status) return;
    status.textContent = message;
    status.classList.add('visible');
    clearTimeout(statusTimeout);
    statusTimeout = setTimeout(() => status.classList.remove('visible'), 2600);
  };
  document.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      const panel = button.closest('.code-panel');
      const pre = panel.querySelector('[role="tabpanel"]:not([hidden]) pre') || panel.querySelector('pre');
      const code = pre.textContent;
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(code);
        announce('接入示例已复制');
      } catch {
        const range = document.createRange();
        range.selectNodeContents(pre);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        announce('已选中示例，请按 Ctrl / ⌘ + C 复制');
      }
    });
  });
  document.querySelectorAll('[data-code-tabs]').forEach((tablist) => {
    const buttons = [...tablist.querySelectorAll('[role="tab"]')];
    const activate = (button) => {
      buttons.forEach((item) => {
        const active = item === button;
        item.setAttribute('aria-selected', String(active));
        item.tabIndex = active ? 0 : -1;
        document.getElementById(item.getAttribute('aria-controls')).hidden = !active;
      });
    };
    buttons.forEach((button, index) => {
      button.addEventListener('click', () => activate(button));
      button.addEventListener('keydown', (event) => {
        let next;
        if (event.key === 'ArrowRight') next = buttons[(index + 1) % buttons.length];
        if (event.key === 'ArrowLeft') next = buttons[(index - 1 + buttons.length) % buttons.length];
        if (event.key === 'Home') next = buttons[0];
        if (event.key === 'End') next = buttons[buttons.length - 1];
        if (next) { event.preventDefault(); activate(next); next.focus(); }
      });
    });
  });
})();
