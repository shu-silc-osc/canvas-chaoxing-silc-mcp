const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const modulePath = path.join(__dirname, '../static/cursor.js');

function load() {
  assert.ok(fs.existsSync(modulePath), 'contextual cursor controller has not been implemented');
  return require(modulePath);
}

function fixture({ fine = true, reduced = false } = {}) {
  const listeners = new Map();
  const frames = new Map();
  let id = 0;
  function element() {
    const classes = new Set();
    return {
      style: {}, dataset: {}, textContent: '', parentNode: null, children: [],
      classList: { add: s => classes.add(s), remove: s => classes.delete(s), contains: s => classes.has(s), toggle(s, on) { on ? classes.add(s) : classes.delete(s); } },
      setAttribute() {},
      appendChild(child) { if (child.parentNode) child.parentNode.children = child.parentNode.children.filter(c => c !== child); this.children.push(child); child.parentNode = this; },
      remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this); this.parentNode = null; },
      closest() { return null; },
    };
  }
  const document = {
    body: element(), documentElement: element(), hidden: false,
    createElement: element,
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name) { listeners.delete(name); },
    elementFromPoint() { return document.hit || document.body; },
  };
  const media = query => ({ matches: query.includes('reduced-motion') ? reduced : fine, addEventListener() {}, removeEventListener() {} });
  const window = {
    matchMedia: media,
    requestAnimationFrame(fn) { frames.set(++id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name) { listeners.delete(name); },
  };
  return {
    document, window,
    emit(name, event = {}) { listeners.get(name)?.(event); },
    frame(time) { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(time)); },
    target(label, dialog = null, disabled = false) {
      const icon = element();
      icon.getAttribute = name => name === 'data-cursor-label' ? label : null;
      icon.closest = selector => selector === '[data-cursor-label]' ? icon : selector === 'dialog[open]' ? dialog : selector === ':disabled, [aria-disabled="true"]' && disabled ? icon : null;
      document.hit = icon;
      return icon;
    },
    element,
  };
}

test('follow motion approaches the target without overshooting and respects reduced motion', () => {
  const { followPosition } = load();
  const next = followPosition({ x: 0, y: 0 }, { x: 100, y: 50 }, 16, false);
  assert.ok(next.x > 0 && next.x < 100);
  assert.ok(next.y > 0 && next.y < 50);
  const settled = followPosition(next, { x: 100, y: 50 }, 1000, false);
  assert.ok(settled.x > 99.99 && settled.x <= 100);
  assert.deepEqual(followPosition({ x: 0, y: 0 }, { x: 100, y: 50 }, 16, true), { x: 100, y: 50 });
});

test('icon context updates its label and clears it when the pointer leaves', () => {
  const { createContextualCursor } = load();
  const f = fixture();
  const cursor = createContextualCursor(f);
  const icon = f.target('课程');
  f.emit('pointermove', { pointerType: 'mouse', clientX: 100, clientY: 80, target: icon });
  f.frame(16);
  assert.equal(cursor.element.dataset.context, 'true');
  assert.equal(cursor.label.textContent, '课程');
  assert.ok(f.document.documentElement.classList.contains('has-context-cursor'));
  f.document.hit = f.document.body;
  f.emit('pointerover', { pointerType: 'mouse', target: f.document.body });
  assert.equal(cursor.element.dataset.context, 'false');
  assert.equal(cursor.label.textContent, '');
});

test('coarse pointers and touch input never hide the native cursor', () => {
  const { createContextualCursor } = load();
  for (const options of [{ fine: false }, { fine: true }]) {
    const f = fixture(options); const cursor = createContextualCursor(f);
    f.emit('pointermove', { pointerType: options.fine ? 'touch' : 'mouse', clientX: 12, clientY: 15, target: f.document.body });
    assert.ok(!f.document.documentElement.classList.contains('has-context-cursor'));
    assert.notEqual(cursor.element.dataset.visible, 'true');
  }
});

test('viewport exit and window blur restore the system cursor', () => {
  const { createContextualCursor } = load();
  for (const event of ['pointerout', 'blur']) {
    const f = fixture(); const cursor = createContextualCursor(f);
    f.emit('pointermove', { pointerType: 'mouse', clientX: 20, clientY: 20, target: f.document.body });
    f.emit(event, { relatedTarget: null });
    assert.ok(!f.document.documentElement.classList.contains('has-context-cursor'));
    assert.equal(cursor.element.dataset.visible, 'false');
  }
});

test('cursor enters the modal top layer and returns to the body on close', () => {
  const { createContextualCursor } = load();
  const f = fixture(); const cursor = createContextualCursor(f); const dialog = f.element();
  const target = f.target('关闭', dialog);
  f.emit('pointermove', { pointerType: 'mouse', clientX: 40, clientY: 40, target });
  assert.equal(cursor.element.parentNode, dialog);
  f.emit('close', { target: dialog });
  assert.equal(cursor.element.parentNode, f.document.body);
  assert.equal(cursor.element.dataset.context, 'false');
});

test('disabled icons do not advertise an action', () => {
  const { createContextualCursor } = load();
  const f = fixture(); const cursor = createContextualCursor(f); const target = f.target('刷新', null, true);
  f.emit('pointermove', { pointerType: 'mouse', clientX: 40, clientY: 40, target });
  assert.equal(cursor.element.dataset.context, 'false');
});

test('follow easing resumes after a long stationary pause instead of snapping', () => {
  const { createContextualCursor } = load();
  const f = fixture(); const cursor = createContextualCursor(f);
  f.emit('pointermove', { pointerType: 'mouse', clientX: 100, clientY: 100, target: f.document.body });
  f.frame(16);
  f.emit('pointermove', { pointerType: 'mouse', clientX: 400, clientY: 100, target: f.document.body });
  f.frame(10000);
  const left = Number(cursor.element.style.transform.match(/translate3d\(([-\d.]+)px/)[1]);
  assert.ok(left > 56 && left < 356, 'the displayed dot should still be following between the old and new positions');
});
