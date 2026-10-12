(function (root) {
  'use strict';

  function followPosition(current, target, elapsed, reduced) {
    const amount = reduced ? 1 : 1 - Math.exp(-Math.max(0, elapsed) / 55);
    return { x: current.x + (target.x - current.x) * amount, y: current.y + (target.y - current.y) * amount };
  }

  function createContextualCursor({ document, window }) {
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const element = document.createElement('div');
    const dot = document.createElement('span');
    const label = document.createElement('span');
    element.className = 'context-cursor';
    dot.className = 'cursor-dot';
    label.className = 'cursor-label';
    element.setAttribute('aria-hidden', 'true');
    element.dataset.visible = 'false';
    element.dataset.context = 'false';
    element.appendChild(dot);
    element.appendChild(label);
    document.body.appendChild(element);
    let position = { x: 0, y: 0 };
    let target = position;
    let frame = null;
    let lastTime = null;
    let visible = false;

    function context(node) {
      const host = node?.closest?.('dialog[open]') || document.body;
      if (element.parentNode !== host) host.appendChild(element);
      const icon = node?.closest?.('[data-cursor-label]');
      const text = icon && !icon.closest(':disabled, [aria-disabled="true"]') ? icon.getAttribute('data-cursor-label') || '' : '';
      element.dataset.context = text ? 'true' : 'false';
      if (label.textContent !== text) label.textContent = text;
    }

    function paint(time) {
      frame = null;
      if (!visible) return;
      position = followPosition(position, target, lastTime === null ? 16 : time - lastTime, reduced.matches);
      lastTime = time;
      element.style.transform = `translate3d(${position.x - 44}px, ${position.y - 44}px, 0)`;
      context(document.elementFromPoint(target.x, target.y));
      if (Math.abs(position.x - target.x) + Math.abs(position.y - target.y) > 0.1) frame = window.requestAnimationFrame(paint);
      else lastTime = null;
    }

    function schedule() {
      if (visible && frame === null) frame = window.requestAnimationFrame(paint);
    }

    function hide() {
      visible = false;
      lastTime = null;
      element.dataset.visible = 'false';
      element.dataset.context = 'false';
      label.textContent = '';
      document.documentElement.classList.remove('has-context-cursor');
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
    }

    function move(event) {
      if (!fine.matches || event.pointerType !== 'mouse') { hide(); return; }
      target = { x: event.clientX, y: event.clientY };
      if (!visible) {
        position = target;
        element.style.transform = `translate3d(${target.x - 44}px, ${target.y - 44}px, 0)`;
        visible = true;
        element.dataset.visible = 'true';
        document.documentElement.classList.add('has-context-cursor');
      }
      context(event.target);
      schedule();
    }

    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerover', event => { if (visible) context(event.target); }, { passive: true });
    document.addEventListener('pointerout', event => { if (!event.relatedTarget) hide(); }, { passive: true });
    document.addEventListener('pointercancel', hide, { passive: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) hide(); });
    document.addEventListener('keydown', event => { if (event.key === 'Tab') hide(); });
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
    document.addEventListener('click', schedule, { passive: true });
    document.addEventListener('close', event => {
      if (element.parentNode === event.target) { document.body.appendChild(element); hide(); }
    }, true);
    window.addEventListener('blur', hide);
    fine.addEventListener('change', () => { if (!fine.matches) hide(); });
    reduced.addEventListener('change', schedule);
    if (window.MutationObserver) new window.MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    return { element, label };
  }

  if (typeof module === 'object' && module.exports) module.exports = { followPosition, createContextualCursor };
  else if (root.document && root.matchMedia) createContextualCursor({ document: root.document, window: root });
})(typeof window === 'undefined' ? globalThis : window);
