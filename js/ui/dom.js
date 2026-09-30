/* Utilidades DOM: creacion de elementos, iconos, avisos, menus y dialogos modales. */
(function () {
  'use strict';
  const O = (window.OAT = window.OAT || {});

  function h(tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'indeterminate') el[k] = v;
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c === undefined || c === null || c === false) return;
    if (Array.isArray(c)) c.forEach((x) => append(el, x));
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function icon(name, cls) {
    const s = h('span', { class: 'icon' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' });
    s.innerHTML = (window.OAT_ICONS && window.OAT_ICONS[name]) || '';
    return s;
  }
  function iconBtn(name, title, onClick, cls, extra) {
    return h('button', Object.assign({ type: 'button', class: 'btn icon-btn' + (cls ? ' ' + cls : ''), title, 'aria-label': title, onclick: onClick }, extra || {}), icon(name));
  }
  function btn(label, onClick, cls, iconName, extra) {
    return h('button', Object.assign({ type: 'button', class: 'btn' + (cls ? ' ' + cls : ''), onclick: onClick }, extra || {}), iconName ? icon(iconName) : null, label ? h('span', null, label) : null);
  }

  /* ---------- Avisos ---------- */
  function toast(msg, kind, ms) {
    let box = document.getElementById('toasts');
    if (!box) { box = h('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(box); }
    const t = h('div', { class: 'toast ' + (kind || 'info') }, icon(kind === 'error' ? 'alert-circle' : kind === 'ok' ? 'check' : 'info'), h('span', null, msg));
    box.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 250); }, ms || (kind === 'error' ? 6000 : 3200));
  }

  /* ---------- Menus ---------- */
  let openMenu = null;
  function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', escMenu, true); } }
  function outside(e) { if (openMenu && !openMenu.contains(e.target)) closeMenu(); }
  function escMenu(e) { if (e.key === 'Escape') closeMenu(); }
  function showMenu(anchor, items) {
    closeMenu();
    const m = h('div', { class: 'menu', role: 'menu' });
    items.forEach((it) => {
      if (it.separator) { m.appendChild(h('div', { class: 'menu-sep' })); return; }
      if (it.header) { m.appendChild(h('div', { class: 'menu-head' }, it.header)); return; }
      m.appendChild(h('button', { type: 'button', role: 'menuitem', class: 'menu-item' + (it.danger ? ' danger' : ''), disabled: !!it.disabled, onclick: () => { closeMenu(); it.onClick && it.onClick(); } }, it.icon ? icon(it.icon) : h('span', { class: 'icon' }), h('span', null, it.label), it.hint ? h('small', null, it.hint) : null));
    });
    document.body.appendChild(m);
    let x; let y;
    if (anchor instanceof Element) { const r = anchor.getBoundingClientRect(); x = r.left; y = r.bottom + 2; } else { x = anchor.x; y = anchor.y; }
    const mw = m.offsetWidth; const mh = m.offsetHeight;
    m.style.left = Math.max(4, Math.min(x, window.innerWidth - mw - 4)) + 'px';
    m.style.top = Math.max(4, Math.min(y, window.innerHeight - mh - 4)) + 'px';
    openMenu = m;
    setTimeout(() => { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', escMenu, true); }, 0);
    const first = m.querySelector('.menu-item:not([disabled])'); if (first) first.focus();
    return m;
  }

  /* ---------- Modales ---------- */
  function modal(opts) {
    const prevFocus = document.activeElement;
    const overlay = h('div', { class: 'overlay' });
    const dlg = h('div', { class: 'dialog' + (opts.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title });
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    const api = {
      el: dlg, promise,
      close(v) { overlay.remove(); document.removeEventListener('keydown', onKey, true); if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) { /* ignore */ } resolve(v); }
    };
    const head = h('div', { class: 'dialog-head' }, h('h2', null, opts.title), h('button', { type: 'button', class: 'btn icon-btn', title: 'Cerrar', 'aria-label': 'Cerrar', onclick: () => api.close(opts.cancelValue) }, icon('x')));
    const body = h('div', { class: 'dialog-body' }, opts.content);
    const foot = h('div', { class: 'dialog-foot' });
    (opts.actions || []).forEach((a) => {
      const b = h('button', { type: 'button', class: 'btn ' + (a.kind || ''), disabled: !!a.disabled, onclick: async () => {
        if (a.onClick) { const r = await a.onClick(api); if (r === false) return; }
        api.close(a.value);
      } }, a.label);
      if (a.ref) a.ref(b);
      foot.appendChild(b);
    });
    dlg.append(head, body, foot);
    overlay.appendChild(dlg);
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); api.close(opts.cancelValue); }
      else if (e.key === 'Tab') {
        const f = Array.from(dlg.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((x) => x.offsetParent !== null);
        if (!f.length) return;
        const first = f[0]; const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    setTimeout(() => { const f = dlg.querySelector('[autofocus], input, select, textarea') || foot.querySelector('.primary, .danger') || foot.querySelector('button'); if (f) f.focus(); }, 0);
    return api;
  }
  function confirmDialog(o) {
    const content = h('div', { class: 'stack' }, h('p', null, o.message), o.details && o.details.length ? h('ul', { class: 'detail-list' }, o.details.slice(0, 40).map((d) => h('li', null, d)), o.details.length > 40 ? h('li', null, '... y ' + (o.details.length - 40) + ' más') : null) : null);
    return modal({ title: o.title, content, cancelValue: false, actions: [{ label: o.cancelLabel || 'Cancelar', value: false }, { label: o.confirmLabel || 'Aceptar', kind: o.danger ? 'danger' : 'primary', value: true }] }).promise;
  }
  function promptDialog(o) {
    const input = h('input', { type: 'text', value: o.value || '', placeholder: o.placeholder || '', 'aria-label': o.label, autofocus: true });
    const err = h('div', { class: 'field-error', role: 'alert' });
    const content = h('div', { class: 'stack' }, o.message ? h('p', null, o.message) : null, h('label', { class: 'field' }, h('span', { class: 'field-label' }, o.label), input), err);
    let api;
    const submit = () => {
      const v = input.value.trim();
      const msg = o.validate ? o.validate(v) : (v ? '' : 'Este campo es obligatorio');
      if (msg) { err.textContent = msg; return false; }
      return true;
    };
    api = modal({ title: o.title, content, cancelValue: null, actions: [{ label: 'Cancelar', value: null }, { label: o.confirmLabel || 'Aceptar', kind: 'primary', onClick: () => submit(), value: '__ok__' }] });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (submit()) api.close('__ok__'); } });
    return api.promise.then((v) => (v === '__ok__' ? input.value.trim() : null));
  }

  /* ---------- Separadores redimensionables ---------- */
  const LAYOUT_KEY = 'oat.layout.v1';
  const layout = (() => { try { return JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}') || {}; } catch (e) { return {}; } })();
  const unitOf = (o) => (o.container ? '%' : 'px');
  function applyLayoutVar(o, v) { document.documentElement.style.setProperty(o.varName, v + unitOf(o)); }
  /** Restaura un tamaño guardado sin crear el separador (para aplicarlo antes del primer pintado). */
  function restoreSize(o) { if (typeof layout[o.varName] === 'number') applyLayoutVar(o, layout[o.varName]); }
  /**
   * Crea un separador arrastrable que ajusta una variable CSS de :root y la recuerda en localStorage.
   * o: { axis: 'x' (mueve a izquierda/derecha) | 'y', varName, def, min, max (número o función), invert (arrastrar
   * hacia la izquierda/arriba agranda), container (función que devuelve el elemento de referencia: valores en %),
   * measure (función con el tamaño actual cuando no hay uno guardado), label, className }.
   * Teclado: flechas para ajustar, Inicio/Fin para mínimo/máximo; doble clic o Intro restauran el tamaño por defecto.
   */
  function splitter(o) {
    const lim = (v) => (typeof v === 'function' ? v() : v);
    const pct = !!o.container;
    const el = h('div', { class: 'splitter splitter-' + o.axis + (o.className ? ' ' + o.className : ''), role: 'separator', tabindex: 0, 'aria-label': o.label, 'aria-orientation': o.axis === 'x' ? 'vertical' : 'horizontal', title: o.label + ' (doble clic: tamaño original)' });
    // Sin tamaño guardado se parte del tamaño real (el CSS puede cambiarlo según el ancho de pantalla).
    const current = () => (typeof layout[o.varName] === 'number' ? layout[o.varName] : (o.measure && o.measure()) || o.def);
    function persist() { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch (e) { /* opcional */ } }
    function aria(v) {
      el.setAttribute('aria-valuenow', String(Math.round(v)));
      el.setAttribute('aria-valuemin', String(Math.round(lim(o.min))));
      el.setAttribute('aria-valuemax', String(Math.round(lim(o.max))));
    }
    function set(v, save) {
      v = Math.round(Math.min(lim(o.max), Math.max(lim(o.min), v)) * 10) / 10;
      layout[o.varName] = v;
      applyLayoutVar(o, v);
      aria(v);
      if (save) persist();
    }
    /** Vuelve al tamaño definido en la hoja de estilos (que puede variar según el ancho de pantalla). */
    function reset() { delete layout[o.varName]; document.documentElement.style.removeProperty(o.varName); aria(o.def); persist(); }
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const pos0 = o.axis === 'x' ? e.clientX : e.clientY;
      const v0 = current();
      const size = pct ? (o.axis === 'x' ? o.container().clientWidth : o.container().clientHeight) || 1 : 1;
      document.body.classList.add('resizing', 'resizing-' + o.axis);
      el.classList.add('dragging');
      const move = (ev) => {
        let d = (o.axis === 'x' ? ev.clientX : ev.clientY) - pos0;
        if (o.invert) d = -d;
        set(v0 + (pct ? (d / size) * 100 : d), false);
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        document.body.classList.remove('resizing', 'resizing-' + o.axis);
        el.classList.remove('dragging');
        set(current(), true);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
    el.addEventListener('dblclick', reset);
    el.addEventListener('keydown', (e) => {
      const step = (pct ? 2 : 16) * (e.shiftKey ? 3 : 1);
      const grow = o.axis === 'x' ? { ArrowRight: 1, ArrowLeft: -1 } : { ArrowDown: 1, ArrowUp: -1 };
      if (e.key in grow) { e.preventDefault(); set(current() + grow[e.key] * step * (o.invert ? -1 : 1), true); }
      else if (e.key === 'Home') { e.preventDefault(); set(lim(o.min), true); }
      else if (e.key === 'End') { e.preventDefault(); set(lim(o.max), true); }
      else if (e.key === 'Enter') { e.preventDefault(); reset(); }
    });
    aria(current());
    restoreSize(o);
    return el;
  }

  O.dom = { h, clear, icon, iconBtn, btn, toast, showMenu, closeMenu, modal, confirmDialog, promptDialog, splitter, restoreSize };
})();
