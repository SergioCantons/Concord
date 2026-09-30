/* Constructores de campos de formulario enlazados a rutas logicas del contrato. */
(function () {
  'use strict';
  const O = (window.OAT = window.OAT || {});
  const { h, icon, iconBtn, btn } = O.dom;
  const YAML = () => O.vendor.YAML;
  const F = (O.forms = {});

  F.field = function (label, control, hint, cls) {
    const tag = control && /^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName || '') ? 'label' : 'div';
    return h(tag, { class: 'field' + (cls ? ' ' + cls : '') }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'field-hint' }, hint) : null);
  };
  F.section = function (title, actions) {
    return h('div', { class: 'section-head' }, h('h3', null, title), h('div', { class: 'section-actions' }, actions));
  };
  F.grid = function () { return h('div', { class: 'form-grid' }, Array.prototype.slice.call(arguments)); };

  function val(app, path) { return app.project.read(path, false); }

  F.text = function (app, label, path, o) {
    o = o || {};
    const cur = val(app, path);
    const el = o.textarea ? h('textarea', { rows: o.rows || 3, spellcheck: false }) : h('input', { type: 'text', placeholder: o.placeholder || '', list: o.list || null });
    el.value = cur === undefined || cur === null ? '' : String(cur);
    if (o.mono) el.classList.add('mono');
    el.addEventListener('change', () => {
      const v = el.value;
      app.edit(label, (tx) => tx.set(path, v === '' ? undefined : (o.transform ? o.transform(v) : v)), { coalesce: true, after: o.after });
    });
    return F.field(label, el, o.hint, o.cls);
  };
  F.number = function (app, label, path, o) {
    o = o || {};
    const cur = val(app, path);
    const el = h('input', { type: 'text', inputmode: 'decimal', placeholder: o.placeholder || '' });
    el.value = cur === undefined || cur === null ? '' : String(cur);
    el.addEventListener('change', () => {
      const t = el.value.trim();
      if (t !== '' && !isFinite(Number(t))) { el.classList.add('invalid'); app.toast('Introduce un número válido en "' + label + '"', 'error'); return; }
      el.classList.remove('invalid');
      app.edit(label, (tx) => tx.set(path, t === '' ? undefined : Number(t)), { coalesce: true, after: o.after });
    });
    return F.field(label, el, o.hint, o.cls);
  };
  F.select = function (app, label, path, options, o) {
    o = o || {};
    const cur = val(app, path);
    const el = h('select');
    const opts = (o.empty === false ? [] : [{ v: '', l: o.emptyLabel || '(sin definir)' }]).concat(options.map((x) => (typeof x === 'string' ? { v: x, l: x } : x)));
    opts.forEach((x) => el.appendChild(h('option', { value: x.v }, x.l)));
    const curS = cur === undefined || cur === null ? '' : String(cur);
    if (curS && !opts.some((x) => x.v === curS)) el.appendChild(h('option', { value: curS }, curS));
    el.value = curS;
    el.addEventListener('change', () => { const v = el.value; app.edit(label, (tx) => tx.set(path, v === '' ? undefined : v), { after: o.after }); });
    return F.field(label, el, o.hint, o.cls);
  };
  F.bool = function (app, label, path, o) {
    o = o || {};
    const cur = val(app, path);
    const el = h('input', { type: 'checkbox', checked: cur === true });
    el.addEventListener('change', () => { const v = el.checked; app.edit(label, (tx) => tx.set(path, v ? true : (o.explicitFalse ? false : undefined)), { after: o.after }); });
    return h('label', { class: 'check' + (o.cls ? ' ' + o.cls : '') }, el, h('span', null, o.text || label));
  };
  /** Valor arbitrario (YAML/JSON) en un textarea. */
  F.yamlValue = function (app, label, path, o) {
    o = o || {};
    const cur = val(app, path);
    const el = h('textarea', { rows: o.rows || 2, spellcheck: false, class: 'mono' });
    const err = h('span', { class: 'field-error' });
    el.value = cur === undefined ? '' : (typeof cur === 'string' ? (/^[\w .-]*$/.test(cur) && cur !== '' && !/^(true|false|null|~|\d[\d.eE+-]*)$/i.test(cur) ? cur : JSON.stringify(cur)) : YAML().stringify(cur, { lineWidth: 0 }).trimEnd());
    el.addEventListener('change', () => {
      const t = el.value.trim();
      let parsed;
      if (t !== '') { try { parsed = YAML().parse(t); } catch (e) { err.textContent = 'YAML no válido: ' + String(e.message).split('\n')[0]; el.classList.add('invalid'); return; } }
      err.textContent = ''; el.classList.remove('invalid');
      app.edit(label, (tx) => tx.set(path, t === '' ? undefined : parsed), { coalesce: true, after: o.after });
    });
    return h('label', { class: 'field' + (o.cls ? ' ' + o.cls : '') }, h('span', { class: 'field-label' }, label), el, err, o.hint ? h('span', { class: 'field-hint' }, o.hint) : null);
  };
  /** Lista de valores simples (tags, enum...) como etiquetas editables. */
  F.chips = function (app, label, path, o) {
    o = o || {};
    const wrap = h('div', { class: 'chips-field' });
    const render = () => {
      const cur = app.project.read(path, false);
      const arr = Array.isArray(cur) ? cur : [];
      wrap.textContent = '';
      const list = h('div', { class: 'chips' });
      arr.forEach((v, i) => list.appendChild(h('span', { class: 'chip' }, h('span', null, String(v)), h('button', { type: 'button', title: 'Quitar ' + v, 'aria-label': 'Quitar ' + v, onclick: () => app.edit(label, (tx) => { const n = arr.slice(); n.splice(i, 1); tx.set(path, n.length ? n : undefined); }, { after: render }) }, icon('x')))));
      const input = h('input', { type: 'text', placeholder: o.placeholder || 'Añadir...', list: o.list || null, 'aria-label': 'Añadir a ' + label });
      const add = () => {
        const parts = input.value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
        if (!parts.length) return;
        const vals = parts.map((p) => (o.parse ? o.parse(p) : p));
        app.edit(label, (tx) => tx.set(path, arr.concat(vals.filter((v) => !arr.includes(v)))), { after: render });
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } });
      input.addEventListener('change', add);
      wrap.append(list, input);
    };
    render();
    return h('div', { class: 'field' + (o.cls ? ' ' + o.cls : '') }, h('span', { class: 'field-label' }, label), wrap);
  };

  /** Editor de extensiones x-* de un nodo. */
  F.extensions = function (app, path) {
    const wrap = h('div', { class: 'stack' });
    const render = () => {
      wrap.textContent = '';
      const node = app.project.read(path, false) || {};
      const keys = Object.keys(node).filter((k) => k.startsWith('x-'));
      if (!keys.length) wrap.appendChild(h('p', { class: 'muted' }, 'Sin extensiones x-*.'));
      keys.forEach((k) => {
        wrap.appendChild(h('div', { class: 'ext-row' }, h('code', null, k), F.yamlValue(app, k, path.concat([k]), { cls: 'grow' }), iconBtn('trash-2', 'Eliminar ' + k, () => app.edit('Eliminar ' + k, (tx) => tx.del(path.concat([k])), { after: render }), 'danger-text')));
      });
      const name = h('input', { type: 'text', placeholder: 'x-mi-extension', 'aria-label': 'Nombre de la extension' });
      const value = h('input', { type: 'text', placeholder: 'valor (YAML)', 'aria-label': 'Valor de la extension' });
      wrap.appendChild(h('div', { class: 'ext-add' }, name, value, btn('Añadir', () => {
        let k = name.value.trim();
        if (!k) return;
        if (!k.startsWith('x-')) k = 'x-' + k;
        if (keys.includes(k)) { app.toast('La extension ya existe', 'error'); return; }
        let v = value.value.trim();
        try { v = v === '' ? null : YAML().parse(v); } catch (e) { app.toast('Valor YAML no válido', 'error'); return; }
        app.edit('Añadir ' + k, (tx) => tx.set(path.concat([k]), v === null ? '' : v), { after: render });
      }, '', 'plus')));
    };
    render();
    return wrap;
  };

  /** Edita un nodo completo como YAML (campos exoticos: callbacks, links, servers de operacion...). */
  F.nodeYaml = function (app, path, o) {
    o = o || {};
    const cur = app.project.read(path, false);
    const ta = h('textarea', { rows: o.rows || 12, spellcheck: false, class: 'mono', 'aria-label': 'YAML del nodo' });
    ta.value = cur === undefined ? '' : YAML().stringify(cur, { lineWidth: 0 }).trimEnd();
    const err = h('div', { class: 'field-error', role: 'alert' });
    const apply = () => {
      try {
        const ok = app.edit(o.label || 'Editar YAML del nodo', (tx) => tx.setYaml(path, ta.value));
        if (ok) { err.textContent = ''; app.toast('Nodo actualizado', 'ok'); if (o.after) o.after(); }
      } catch (e) { err.textContent = e.message; }
    };
    return h('div', { class: 'stack' }, ta, err, h('div', { class: 'row' }, btn('Aplicar YAML', apply, 'primary', 'check'), h('span', { class: 'muted' }, 'Sustituye este nodo; los cambios se pueden deshacer.')));
  };

  /** Selector de componentes por nombre. */
  F.componentSelect = function (app, type, current, onPick, o) {
    o = o || {};
    const names = (app.project.getModel().components[type] || []).map((c) => c.name);
    const sel = h('select', { 'aria-label': o.label || 'Componente' });
    sel.appendChild(h('option', { value: '' }, o.placeholder || '(elige un componente)'));
    names.forEach((n) => sel.appendChild(h('option', { value: n }, n)));
    if (current && !names.includes(current)) sel.appendChild(h('option', { value: current }, current + ' (no encontrado)'));
    sel.value = current || '';
    sel.addEventListener('change', () => { if (sel.value) onPick(sel.value); });
    return sel;
  };
  /** Nombre del componente al que apunta una ref interna (#/components/tipo/nombre) o null. */
  F.refName = function (ref, type) {
    const m = /(?:^|#)\/components\/([^/]+)\/([^/]+)$/.exec(ref || '');
    if (!m || (type && m[1] !== type)) return null;
    try { return decodeURIComponent(m[2]).replace(/~1/g, '/').replace(/~0/g, '~'); } catch (e) { return m[2]; }
  };

  /** Nombre del componente al que apunta una referencia, aunque sea mediante un $ref a fichero que un componente ya expone. */
  F.aliasName = function (app, type, holderLogical, ref) {
    const direct = F.refName(ref, type);
    if (direct) return direct;
    const P = app.project;
    const holder = P.phys(holderLogical, false);
    if (holder.error) return null;
    const t = P.resolveRef(holder.file, ref);
    if (t.error) return null;
    for (const c of P.getModel().components[type] || []) {
      if (!c.ref) continue;
      const cp = P.phys(['components', type, c.name], false);
      if (cp.error) continue;
      const r2 = P.resolveRef(cp.file, c.ref);
      if (!r2.error && r2.file === t.file && r2.segs.join('/') === t.segs.join('/')) return c.name;
    }
    return null;
  };

  F.methodBadge = function (m) { return h('span', { class: 'method m-' + m }, m.toUpperCase()); };
  F.badge = function (text, cls) { return h('span', { class: 'badge' + (cls ? ' ' + cls : '') }, text); };

  /** Bloque plegable sin marco anidado. */
  F.fold = function (summary, body, open, actions) {
    const d = h('details', { class: 'fold' }, h('summary', null, h('span', { class: 'fold-title' }, summary), h('span', { class: 'fold-actions', onclick: (e) => e.stopPropagation() }, actions)), h('div', { class: 'fold-body' }, body));
    if (open) d.open = true;
    return d;
  };
  F.tabs = function (defs, initial, onChange) {
    const wrap = h('div', { class: 'tabs-wrap' });
    const bar = h('div', { class: 'tabs', role: 'tablist' });
    const body = h('div', { class: 'tab-body', role: 'tabpanel' });
    let current = initial || defs[0].id;
    const show = (id) => {
      current = id;
      if (onChange) onChange(id);
      Array.from(bar.children).forEach((b) => { const on = b.dataset.id === id; b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
      body.textContent = '';
      const d = defs.find((x) => x.id === id) || defs[0];
      body.appendChild(d.render());
    };
    defs.forEach((d) => bar.appendChild(h('button', { type: 'button', role: 'tab', class: 'tab', dataset: { id: d.id }, onclick: () => show(d.id) }, d.label, d.badge ? h('span', { class: 'tab-badge' }, d.badge) : null)));
    wrap.append(bar, body);
    show(current);
    wrap.show = show;
    return wrap;
  };
})();
