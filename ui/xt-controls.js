/**
 * xT studio — điều khiển giao diện:
 *  1) Ô nhập nhiều dòng tự giãn theo nội dung (không thanh cuộn trong ô).
 *  2) Dropdown tự vẽ thay danh sách mặc định của hệ điều hành; vẫn ghi vào <select> gốc
 *     và phát sự kiện input/change nên logic cũ của app không đổi.
 */
(function () {
  'use strict';

  /* ---------------- 1. Ô nhập tự giãn ---------------- */
  const MAX_VH = Infinity; // giãn hết theo nội dung, không thanh cuộn trong ô
  function fit(t) {
    if (!t || t.tagName !== 'TEXTAREA' || t.offsetParent === null || t.dataset.xtFixed != null) return;
    const cs = getComputedStyle(t);
    const borders = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    const max = Math.round(window.innerHeight * MAX_VH);
    t.style.height = 'auto';
    let sh = t.scrollHeight;
    // Ô trống: đo theo chữ gợi ý để hiện đủ ví dụ, không bị cắt
    if (!desc.get.call(t) && t.placeholder) {
      desc.set.call(t, t.placeholder);
      sh = Math.max(sh, t.scrollHeight);
      desc.set.call(t, '');
    }
    const want = sh + (cs.boxSizing === 'border-box' ? borders : 0);
    t.style.height = Math.min(want, max) + 'px';
    t.style.overflowY = want > max ? 'auto' : 'hidden';
  }
  const fitAll = root => (root || document).querySelectorAll('textarea').forEach(fit);

  // Giá trị đổi bằng JS (không phát sự kiện input) cũng tự giãn
  const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  Object.defineProperty(HTMLTextAreaElement.prototype, 'value', {
    configurable: true,
    get() { return desc.get.call(this); },
    set(v) { desc.set.call(this, v); requestAnimationFrame(() => fit(this)); },
  });
  document.addEventListener('input', e => { if (e.target.tagName === 'TEXTAREA') fit(e.target); }, true);
  document.addEventListener('app:tab', () => requestAnimationFrame(() => fitAll()));
  document.addEventListener('toggle', e => fitAll(e.target), true); // mở <details>
  window.addEventListener('resize', () => fitAll());

  /* ---------------- 2. Dropdown ---------------- */
  const CHECK = '<svg class="xi" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>';
  let menu = null, cur = null, items = [], active = -1, filterInput = null;

  const usable = s => s && s.tagName === 'SELECT' && !s.multiple && !(s.size > 1) && !s.disabled;

  function close(refocus) {
    if (!menu) return;
    menu.remove(); menu = null;
    if (cur) { cur.classList.remove('xt-open'); if (refocus) cur.focus({ preventScroll: true }); }
    cur = null; items = []; active = -1; filterInput = null;
  }

  function choose(i) {
    const it = items[i];
    if (!it || it.disabled) return;
    const s = cur;
    if (s.selectedIndex !== it.index) {
      s.selectedIndex = it.index;
      s.dispatchEvent(new Event('input', { bubbles: true }));
      s.dispatchEvent(new Event('change', { bubbles: true }));
    }
    close(true);
  }

  function setActive(i, scroll) {
    const vis = items.filter(x => !x.el.hidden && !x.disabled);
    if (!vis.length) return;
    if (i < 0) i = 0;
    items.forEach(x => x.el.classList.remove('on'));
    active = i;
    const it = items[i];
    if (it) { it.el.classList.add('on'); if (scroll) it.el.scrollIntoView({ block: 'nearest' }); }
  }
  function step(dir) {
    const order = items.map((x, i) => i).filter(i => !items[i].el.hidden && !items[i].disabled);
    if (!order.length) return;
    const pos = order.indexOf(active);
    const next = pos < 0 ? order[0] : order[Math.min(order.length - 1, Math.max(0, pos + dir))];
    setActive(next, true);
  }

  function place() {
    if (!menu || !cur) return;
    const r = cur.getBoundingClientRect();
    const gap = 6, pad = 12;
    const below = window.innerHeight - r.bottom - pad - gap;
    const above = r.top - pad - gap;
    const natural = menu.scrollHeight;
    const up = natural > below && above > below;
    const maxH = Math.max(160, up ? above : below);
    menu.style.maxHeight = maxH + 'px';
    const w = Math.min(Math.max(r.width, 200), 460);
    let left = Math.min(r.left, window.innerWidth - w - pad);
    menu.style.width = w + 'px';
    menu.style.left = Math.max(pad, left) + 'px';
    if (up) { menu.style.top = ''; menu.style.bottom = (window.innerHeight - r.top + gap) + 'px'; }
    else { menu.style.bottom = ''; menu.style.top = (r.bottom + gap) + 'px'; }
  }

  function open(s) {
    close(false);
    cur = s;
    s.classList.add('xt-open');
    menu = document.createElement('div');
    menu.className = 'xt-menu';
    menu.setAttribute('role', 'listbox');
    const list = document.createElement('div');
    list.className = 'xt-menu-list';
    const opts = [...s.options];
    if (opts.filter(o => !o.hidden).length > 12) {
      const wrap = document.createElement('div');
      wrap.className = 'xt-menu-search';
      wrap.innerHTML = '<svg class="xi" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';
      filterInput = document.createElement('input');
      filterInput.type = 'text';
      filterInput.placeholder = 'Tìm…';
      filterInput.spellcheck = false;
      wrap.appendChild(filterInput);
      menu.appendChild(wrap);
      filterInput.addEventListener('input', () => {
        const q = filterInput.value.trim().toLowerCase();
        items.forEach(x => { x.el.hidden = q && !x.text.toLowerCase().includes(q); });
        list.querySelectorAll('.xt-menu-group').forEach(g => {
          let n = g.nextElementSibling, any = false;
          while (n && !n.classList.contains('xt-menu-group')) { if (!n.hidden) any = true; n = n.nextElementSibling; }
          g.hidden = !any;
        });
        const first = items.findIndex(x => !x.el.hidden && !x.disabled);
        setActive(first, true);
      });
    }
    let lastGroup = null;
    opts.forEach((o, index) => {
      if (o.hidden) return;
      const g = o.parentElement.tagName === 'OPTGROUP' ? o.parentElement : null;
      if (g && g !== lastGroup) {
        const h = document.createElement('div');
        h.className = 'xt-menu-group';
        h.textContent = g.label;
        list.appendChild(h);
      }
      lastGroup = g;
      const el = document.createElement('div');
      el.className = 'xt-menu-item' + (o.selected ? ' sel' : '') + (o.disabled || (g && g.disabled) ? ' dis' : '');
      el.setAttribute('role', 'option');
      el.innerHTML = `<span class="xt-menu-txt"></span>${o.selected ? CHECK : ''}`;
      el.firstChild.textContent = o.textContent.trim();
      if (o.title) el.title = o.title;
      const it = { el, index, text: o.textContent, disabled: o.disabled || (g && g.disabled) };
      el.addEventListener('mousemove', () => { if (!it.disabled) setActive(items.indexOf(it)); });
      el.addEventListener('mousedown', e => { e.preventDefault(); choose(items.indexOf(it)); });
      items.push(it);
      list.appendChild(el);
    });
    if (!items.length) { const em = document.createElement('div'); em.className = 'xt-menu-empty'; em.textContent = 'Không có lựa chọn'; list.appendChild(em); }
    menu.appendChild(list);
    document.body.appendChild(menu);
    place();
    const selIdx = items.findIndex(x => x.index === s.selectedIndex);
    setActive(selIdx >= 0 ? selIdx : items.findIndex(x => !x.disabled), false);
    if (items[active]) items[active].el.scrollIntoView({ block: 'center' });
    if (filterInput) filterInput.focus({ preventScroll: true });
  }

  // Mở menu thay danh sách hệ thống
  document.addEventListener('mousedown', e => {
    if (menu && menu.contains(e.target)) return;
    const s = e.target.closest && e.target.closest('select');
    if (e.button !== 0 || !usable(s)) { if (menu) close(false); return; }
    e.preventDefault();
    if (cur === s) { close(true); return; }
    s.focus({ preventScroll: true });
    open(s);
  }, true);

  document.addEventListener('keydown', e => {
    if (menu) {
      if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
      else if (e.key === 'Escape') { e.preventDefault(); close(true); }
      else if (e.key === 'Tab') close(false);
      return;
    }
    const s = e.target;
    if (usable(s) && (e.key === ' ' || e.key === 'Enter' || (e.altKey && e.key === 'ArrowDown') || e.key === 'F4')) {
      e.preventDefault();
      open(s);
    }
  }, true);

  document.addEventListener('scroll', e => { if (menu && !menu.contains(e.target)) close(false); }, true);
  window.addEventListener('resize', () => close(false));
  window.addEventListener('blur', () => close(false));
  document.addEventListener('app:tab', () => close(false));

  /* ---------------- Khởi động ---------------- */
  function start() {
    fitAll();
    new MutationObserver(muts => {
      for (const m of muts) m.addedNodes.forEach(n => {
        if (n.nodeType !== 1) return;
        if (n.tagName === 'TEXTAREA') requestAnimationFrame(() => fit(n));
        else if (n.querySelector && n.querySelector('textarea')) requestAnimationFrame(() => fitAll(n));
      });
    }).observe(document.body, { childList: true, subtree: true });
    // Tab đang mở sẵn lúc khởi động: đo lại khi phông chữ đã tải
    if (document.fonts) document.fonts.ready.then(() => fitAll());
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.xtFit = fitAll;
})();
