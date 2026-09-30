/* Editor visual de schemas (inline o referenciados): general, propiedades, elementos, restricciones, composicion, uso y YAML del nodo. */
(function () {
  'use strict';
  const O = (window.OAT = window.OAT || {});
  const { h, icon, iconBtn, btn, modal } = O.dom;
  const F = O.forms;
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean'];
  const FORMATS = { string: ['date', 'date-time', 'password', 'byte', 'binary', 'email', 'uuid', 'uri', 'hostname', 'ipv4', 'ipv6'], integer: ['int32', 'int64'], number: ['float', 'double'] };

  /** Dialogo para elegir un componente existente. */
  function chooseComponent(app, type, title) {
    const names = (app.project.getModel().components[type] || []).map((c) => c.name);
    if (!names.length) { app.toast('No hay componentes de tipo ' + type + ' definidos', 'error'); return Promise.resolve(null); }
    const sel = h('select', { size: Math.min(8, names.length + 1), 'aria-label': title });
    names.forEach((n) => sel.appendChild(h('option', { value: n }, n)));
    sel.value = names[0];
    const m = modal({ title, content: h('div', { class: 'stack' }, sel), cancelValue: null, actions: [{ label: 'Cancelar', value: null }, { label: 'Elegir', kind: 'primary', onClick: () => true, value: '__ok__' }] });
    sel.addEventListener('dblclick', () => m.close('__ok__'));
    return m.promise.then((v) => (v === '__ok__' ? sel.value : null));
  }
  function summarize(app, node) {
    if (node === undefined) return 'sin definir';
    if (!isObj(node)) return String(node);
    if (typeof node.$ref === 'string') return '\u2192 ' + (F.refName(node.$ref) || node.$ref);
    if (node.type === 'array') return 'array<' + summarize(app, node.items) + '>';
    for (const k of ['allOf', 'oneOf', 'anyOf']) if (Array.isArray(node[k])) return k + '(' + node[k].length + ')';
    if (node.enum && !node.type) return 'enum';
    return (node.type || (node.properties ? 'object' : 'any')) + (node.format ? ':' + node.format : '');
  }

  function schemaEditor(app, basePath, opts) {
    opts = opts || {};
    const root = h('div', { class: 'schema-editor' + (opts.embedded ? ' embedded' : '') });
    let sub = [];
    const tabState = {};
    const P = () => app.project;
    const ops = O.ops;

    const render = () => {
      root.textContent = '';
      const path = basePath.concat(sub);
      if (sub.length) {
        const bc = h('div', { class: 'breadcrumb' });
        bc.appendChild(h('button', { type: 'button', class: 'crumb', onclick: () => { sub = []; render(); } }, opts.label || 'Schema'));
        sub.forEach((s, i) => { bc.appendChild(icon('chevron-right')); bc.appendChild(h('button', { type: 'button', class: 'crumb', onclick: () => { sub = sub.slice(0, i + 1); render(); } }, String(s))); });
        root.appendChild(bc);
      }
      root.appendChild(body(path));
    };
    const rerenderAll = () => { render(); };

    function body(path) {
      let node = P().read(path, false);
      let via = null;
      if (opts.isComponentRoot && !sub.length && isObj(node) && typeof node.$ref === 'string') {
        const target = P().read(path, true);
        if (isObj(target) && typeof target.$ref !== 'string') { via = node.$ref; node = target; }
      }
      const key = path.join('/');
      if (node === undefined) {
        return h('div', { class: 'empty-slot' }, h('span', { class: 'muted' }, 'Sin definir'),
          h('div', { class: 'row' }, TYPES.map((t) => btn(t, () => app.edit('Definir ' + t, (tx) => tx.set(path, t === 'array' ? { type: 'array', items: { type: 'string' } } : t === 'object' ? { type: 'object', properties: {} } : { type: t }), { after: rerenderAll }), 'small')),
            btn('Referencia...', async () => { const n = await chooseComponent(app, 'schemas', 'Referenciar schema'); if (n) app.op(() => ops.setRef(P(), path, 'schemas', n), { after: rerenderAll }); }, 'small', 'link')));
      }
      if (!isObj(node)) return h('div', { class: 'muted' }, 'Valor no editable visualmente: usa la pestana YAML.');
      if (typeof node.$ref === 'string') return refPanel(path, node);
      const bar = h('div', { class: 'row toolbar-row' });
      if (!opts.noModeBar) {
        bar.appendChild(btn('Usar referencia...', async () => { const n = await chooseComponent(app, 'schemas', 'Referenciar schema'); if (n) app.op(() => ops.setRef(P(), path, 'schemas', n), { after: rerenderAll }); }, 'small', 'link'));
        if (!opts.isComponentRoot) bar.appendChild(btn('Extraer a schema reutilizable...', async () => {
          const name = await app.prompt({ title: 'Extraer a schema reutilizable', label: 'Nombre del nuevo schema', validate: (v) => (!/^[A-Za-z0-9._-]+$/.test(v) ? 'Solo letras, numeros, punto, guion y guion bajo' : (P().getModel().components.schemas.some((c) => c.name === v) ? 'Ya existe un schema con ese nombre' : '')) });
          if (name) app.op(() => ops.extractInline(P(), path, name), { after: rerenderAll, ok: 'Schema "' + name + '" creado' });
        }, 'small', 'package'));
      }
      const defs = [{ id: 'general', label: 'General', render: () => general(path, node) }];
      const isObjLike = node.type === 'object' || node.properties || (!node.type && !node.items);
      if (!opts.compact || node.type === 'object') { if (isObjLike) defs.push({ id: 'props', label: 'Propiedades', badge: node.properties ? Object.keys(node.properties).length : 0, render: () => props(path, node) }); }
      if (node.type === 'array') defs.push({ id: 'items', label: 'Elementos', render: () => items(path) });
      defs.push({ id: 'constraints', label: 'Restricciones', render: () => constraints(path, node) });
      if (!opts.compact) defs.push({ id: 'compose', label: 'Composición', badge: ['allOf', 'oneOf', 'anyOf'].reduce((n, k) => n + (Array.isArray(node[k]) ? node[k].length : 0), 0) || '', render: () => compose(path, node) });
      if (opts.usage) defs.push({ id: 'usage', label: 'Usos', render: () => usage() });
      defs.push({ id: 'advanced', label: 'Avanzado', render: () => h('div', { class: 'stack' }, F.section('Extensiones x-*'), F.extensions(app, path), F.section('YAML del nodo'), F.nodeYaml(app, path, { after: rerenderAll })) });
      const initial = defs.some((d) => d.id === tabState[key]) ? tabState[key] : defs[0].id;
      const tabs = F.tabs(defs, initial, (id) => { tabState[key] = id; });
      return h('div', { class: 'stack' }, via ? h('div', { class: 'callout' }, icon('link'), h('span', null, 'Este schema se define en otro fichero mediante $ref (' + via + '). Los cambios se guardan en ese fichero y afectan a todos sus consumidores.')) : null, bar, tabs);
    }

    function refPanel(path, node) {
      const name = F.aliasName(app, 'schemas', path, node.$ref);
      const raw = h('input', { type: 'text', class: 'mono', value: node.$ref, 'aria-label': 'Referencia $ref' });
      raw.addEventListener('change', () => app.edit('Editar $ref', (tx) => tx.set(path.concat(['$ref']), raw.value.trim()), { after: rerenderAll }));
      const ph = P().phys(path, false);
      const usageRefs = !ph.error && P().refIndex().find((r) => r.file === ph.file && r.path.length === ph.path.length + 1 && r.path.every((s, i) => (i === ph.path.length ? s === '$ref' : String(s) === String(ph.path[i]))));
      const status = usageRefs && usageRefs.error ? h('div', { class: 'callout error' }, icon('alert-circle'), h('span', null, usageRefs.message)) : null;
      return h('div', { class: 'stack' },
        h('div', { class: 'row wrap' }, h('span', { class: 'badge ref' }, '$ref'),
          F.componentSelect(app, 'schemas', name, (n) => app.op(() => ops.setRef(P(), path, 'schemas', n), { after: rerenderAll }), { label: 'Schema referenciado' }),
          name ? btn('Abrir schema', () => app.select({ kind: 'component', type: 'schemas', name }), 'small', 'external-link') : null,
          btn('Convertir en inline', () => {
            const resolved = P().read(path, true);
            if (resolved === undefined) { app.toast('No se puede resolver la referencia', 'error'); return; }
            app.edit('Convertir referencia en inline', (tx) => tx.set(path, JSON.parse(JSON.stringify(resolved))), { after: rerenderAll });
          }, 'small', 'copy')),
        F.field('Referencia', raw, 'Puede apuntar a un fichero local (./schemas/x.yaml) o a #/components/schemas/Nombre.'), status);
    }

    function general(path, node) {
      const dl = 'fmt-' + Math.random().toString(36).slice(2, 7);
      const fmts = FORMATS[node.type] || [];
      const g = F.grid(
        F.select(app, 'Tipo', path.concat(['type']), TYPES, { after: rerenderAll }),
        F.text(app, 'Formato', path.concat(['format']), { list: dl }),
        F.text(app, 'Título', path.concat(['title'])),
        F.text(app, 'Descripción', path.concat(['description']), { textarea: true, rows: 2, cls: 'span2' }));
      g.appendChild(h('datalist', { id: dl }, fmts.map((f) => h('option', { value: f }))));
      const flags = h('div', { class: 'row wrap flags' }, ['nullable', 'readOnly', 'writeOnly', 'deprecated'].map((k) => F.bool(app, k, path.concat([k]), { text: k })));
      const parse = (s) => (node.type === 'integer' || node.type === 'number' ? (isFinite(Number(s)) ? Number(s) : s) : node.type === 'boolean' ? s === 'true' : s);
      return h('div', { class: 'stack' }, g, flags,
        F.grid(F.yamlValue(app, 'Valor por defecto', path.concat(['default'])), F.yamlValue(app, 'Ejemplo', path.concat(['example']))),
        F.chips(app, 'Valores permitidos (enum)', path.concat(['enum']), { parse, placeholder: 'Añadir valor y Enter' }),
        F.section('Documentación externa'),
        F.grid(F.text(app, 'URL', path.concat(['externalDocs', 'url'])), F.text(app, 'Descripción', path.concat(['externalDocs', 'description']))),
        F.section('Discriminator'),
        F.grid(F.text(app, 'Propiedad', path.concat(['discriminator', 'propertyName'])), F.yamlValue(app, 'Mapping (YAML)', path.concat(['discriminator', 'mapping']))));
    }

    function props(path, node) {
      const wrap = h('div', { class: 'stack' });
      const propsNode = P().read(path.concat(['properties']), true) || {};
      const req = Array.isArray(node.required) ? node.required : [];
      const names = Object.keys(propsNode);
      const list = h('div', { class: 'prop-table' });
      if (names.length) list.appendChild(h('div', { class: 'prop-row head' }, h('span', null, 'Nombre'), h('span', null, 'Tipo'), h('span', null, 'Oblig.'), h('span', null, 'Descripción'), h('span', null, '')));
      names.forEach((n, i) => {
        const pn = propsNode[n];
        const nameIn = h('input', { type: 'text', value: n, 'aria-label': 'Nombre de la propiedad ' + n });
        nameIn.addEventListener('change', () => { const v = nameIn.value.trim(); if (!v || v === n) { nameIn.value = n; return; } app.op(() => ops.renameProperty(P(), path, n, v), { after: rerenderAll }); });
        const reqIn = h('input', { type: 'checkbox', checked: req.includes(n), 'aria-label': n + ' obligatoria' });
        reqIn.addEventListener('change', () => app.op(() => ops.setRequired(P(), path, n, reqIn.checked), { rerender: false }));
        const desc = h('input', { type: 'text', value: isObj(pn) && typeof pn.description === 'string' ? pn.description : '', placeholder: '', 'aria-label': 'Descripción de ' + n, disabled: isObj(pn) && !!pn.$ref });
        desc.addEventListener('change', () => app.edit('Descripción de ' + n, (tx) => tx.set(path.concat(['properties', n, 'description']), desc.value === '' ? undefined : desc.value), { coalesce: true }));
        list.appendChild(h('div', { class: 'prop-row' }, nameIn,
          h('button', { type: 'button', class: 'type-chip', title: 'Editar ' + n, onclick: () => { sub = sub.concat(['properties', n]); render(); } }, summarize(app, pn)),
          reqIn, desc,
          h('span', { class: 'row-actions' },
            iconBtn('pencil', 'Editar ' + n, () => { sub = sub.concat(['properties', n]); render(); }),
            iconBtn('chevron-up', 'Subir ' + n, () => app.op(() => ops.moveProperty(P(), path, n, -1), { after: rerenderAll }), '', { disabled: i === 0 }),
            iconBtn('chevron-down', 'Bajar ' + n, () => app.op(() => ops.moveProperty(P(), path, n, 1), { after: rerenderAll }), '', { disabled: i === names.length - 1 }),
            iconBtn('trash-2', 'Eliminar ' + n, async () => { if (await app.confirm({ title: 'Eliminar propiedad', message: 'Se eliminará la propiedad "' + n + '".', confirmLabel: 'Eliminar', danger: true })) app.op(() => ops.deleteProperty(P(), path, n), { after: rerenderAll }); }, 'danger-text'))));
      });
      if (!names.length) list.appendChild(h('p', { class: 'muted' }, 'Sin propiedades.'));
      wrap.appendChild(list);
      const nn = h('input', { type: 'text', placeholder: 'nombre', 'aria-label': 'Nombre de la nueva propiedad' });
      const tt = h('select', { 'aria-label': 'Tipo de la nueva propiedad' }, TYPES.map((t) => h('option', { value: t }, t)), h('option', { value: '$ref' }, 'referencia a schema'));
      tt.value = 'string';
      const rq = h('input', { type: 'checkbox', 'aria-label': 'Nueva propiedad obligatoria' });
      const add = async () => {
        const name = nn.value.trim();
        if (!name) { nn.focus(); return; }
        let def;
        if (tt.value === '$ref') {
          const target = await chooseComponent(app, 'schemas', 'Referenciar schema');
          if (!target) return;
          def = { $ref: ops.componentRef(P(), path.concat(['properties', name]), 'schemas', target) };
        } else def = tt.value === 'array' ? { type: 'array', items: { type: 'string' } } : tt.value === 'object' ? { type: 'object', properties: {} } : { type: tt.value };
        app.op(() => ops.addProperty(P(), path, name, def, rq.checked), { after: rerenderAll });
      };
      nn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
      wrap.appendChild(h('div', { class: 'row wrap add-row' }, nn, tt, h('label', { class: 'check' }, rq, h('span', null, 'Obligatoria')), btn('Añadir propiedad', add, 'primary', 'plus')));
      // additionalProperties
      const ap = node.additionalProperties;
      const apSel = h('select', { 'aria-label': 'additionalProperties' }, h('option', { value: '' }, '(sin definir)'), h('option', { value: 'true' }, 'Permitir cualquier propiedad'), h('option', { value: 'false' }, 'Prohibir propiedades adicionales'), h('option', { value: 'schema' }, 'Definir schema (diccionario)'));
      apSel.value = ap === undefined ? '' : ap === true ? 'true' : ap === false ? 'false' : 'schema';
      apSel.addEventListener('change', () => app.edit('additionalProperties', (tx) => tx.set(path.concat(['additionalProperties']), apSel.value === '' ? undefined : apSel.value === 'schema' ? { type: 'string' } : apSel.value === 'true'), { after: rerenderAll }));
      wrap.appendChild(F.section('Propiedades adicionales'));
      wrap.appendChild(F.field('additionalProperties', apSel));
      if (isObj(ap)) wrap.appendChild(schemaEditor(app, path.concat(['additionalProperties']), { compact: true, embedded: true, label: 'Valores del diccionario', noModeBar: false }));
      return wrap;
    }

    function items(path) {
      return h('div', { class: 'stack' }, F.section('Schema de los elementos'), schemaEditor(app, path.concat(['items']), { compact: true, embedded: true, label: 'Elementos' }));
    }

    function constraints(path, node) {
      const t = node.type;
      const g = F.grid();
      const num = (k, label) => g.appendChild(F.number(app, label || k, path.concat([k])));
      const bool = (k) => g.appendChild(h('div', { class: 'field' }, F.bool(app, k, path.concat([k]), { text: k })));
      if (!t || t === 'string') { num('minLength'); num('maxLength'); g.appendChild(F.text(app, 'pattern', path.concat(['pattern']), { mono: true })); }
      if (!t || t === 'number' || t === 'integer') { num('minimum'); num('maximum'); num('multipleOf'); bool('exclusiveMinimum'); bool('exclusiveMaximum'); }
      if (!t || t === 'array') { num('minItems'); num('maxItems'); bool('uniqueItems'); }
      if (!t || t === 'object') { num('minProperties'); num('maxProperties'); }
      return h('div', { class: 'stack' }, g, h('p', { class: 'muted' }, 'Los campos vacios se eliminan del YAML.'));
    }

    function compose(path, node) {
      const wrap = h('div', { class: 'stack' });
      ['allOf', 'oneOf', 'anyOf'].forEach((k) => {
        const arr = Array.isArray(node[k]) ? node[k] : [];
        const head = F.section(k + (arr.length ? ' (' + arr.length + ')' : ''), [
          btn('Referencia', async () => { const n = await chooseComponent(app, 'schemas', 'Añadir referencia a ' + k); if (n) app.edit('Añadir a ' + k, (tx) => tx.push(path.concat([k]), { $ref: ops.componentRef(P(), path.concat([k, arr.length]), 'schemas', n) }), { after: rerenderAll }); }, 'small', 'link'),
          btn('Inline', () => app.edit('Añadir a ' + k, (tx) => tx.push(path.concat([k]), { type: 'object', properties: {} }), { after: rerenderAll }), 'small', 'plus')]);
        wrap.appendChild(head);
        arr.forEach((entry, i) => {
          wrap.appendChild(F.fold(k + '[' + i + '] ' + summarize(app, entry), schemaEditor(app, path.concat([k, i]), { compact: true, embedded: true, label: k + '[' + i + ']' }), false, [
            iconBtn('chevron-up', 'Subir', () => app.edit('Reordenar ' + k, (tx) => tx.reorder(path.concat([k]), i, -1), { after: rerenderAll }), '', { disabled: i === 0 }),
            iconBtn('chevron-down', 'Bajar', () => app.edit('Reordenar ' + k, (tx) => tx.reorder(path.concat([k]), i, 1), { after: rerenderAll }), '', { disabled: i === arr.length - 1 }),
            iconBtn('trash-2', 'Eliminar', () => app.edit('Eliminar de ' + k, (tx) => { const next = arr.filter((_, j) => j !== i); tx.set(path.concat([k]), next.length ? next : undefined); }, { after: rerenderAll }), 'danger-text')]));
        });
      });
      wrap.appendChild(F.section('not', node.not === undefined ? btn('Definir', () => app.edit('Definir not', (tx) => tx.set(path.concat(['not']), { type: 'string' }), { after: rerenderAll }), 'small', 'plus') : iconBtn('trash-2', 'Quitar not', () => app.edit('Quitar not', (tx) => tx.del(path.concat(['not'])), { after: rerenderAll }), 'danger-text')));
      if (node.not !== undefined) wrap.appendChild(schemaEditor(app, path.concat(['not']), { compact: true, embedded: true, label: 'not' }));
      return wrap;
    }

    function usage() {
      const { type, name } = opts.usage;
      const list = ops.componentConsumers(P(), type, name);
      if (!list.length) return h('p', { class: 'muted' }, 'Ningún elemento referencia este componente.');
      return h('div', { class: 'stack' }, h('p', null, list.length + ' referencia(s):'), h('ul', { class: 'usage-list' }, list.map((u) => h('li', null, h('button', { type: 'button', class: 'link', onclick: () => app.goLocation(u.file, u.yamlPath, u.logical) }, u.label), h('small', { class: 'muted' }, ' ' + u.file)))));
    }

    render();
    root.reset = () => { sub = []; render(); };
    return root;
  }

  O.schemaUI = { schemaEditor, chooseComponent, summarize };
})();
