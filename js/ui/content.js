/* Editores de parámetros, cabeceras, cuerpos, respuestas y seguridad. */
(function () {
  'use strict';
  const O = (window.OAT = window.OAT || {});
  const { h, icon, iconBtn, btn, showMenu } = O.dom;
  const F = O.forms;
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const MEDIA = ['application/json', 'application/xml', 'application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain', 'text/html', 'application/octet-stream', 'application/problem+json'];
  const CODES = { 200: 'Operación correcta', 201: 'Recurso creado', 202: 'Aceptado', 204: 'Sin contenido', 400: 'Petición no válida', 401: 'No autenticado', 403: 'Acceso denegado', 404: 'No encontrado', 409: 'Conflicto', 422: 'Datos no válidos', 429: 'Demasiadas peticiones', 500: 'Error interno', 503: 'Servicio no disponible', default: 'Error inesperado' };
  const S = () => O.schemaUI;

  /* ---------- Referencia a componente genérica ---------- */
  function refBox(app, path, type, node, after) {
    const name = F.aliasName(app, type, path, node.$ref);
    const raw = h('input', { type: 'text', class: 'mono', value: node.$ref, 'aria-label': 'Referencia $ref' });
    raw.addEventListener('change', () => app.edit('Editar $ref', (tx) => tx.set(path.concat(['$ref']), raw.value.trim()), { after }));
    return h('div', { class: 'stack' },
      h('div', { class: 'row wrap' }, h('span', { class: 'badge ref' }, '$ref'),
        F.componentSelect(app, type, name, (n) => app.op(() => O.ops.setRef(app.project, path, type, n), { after }), { label: 'Componente referenciado' }),
        name ? btn('Abrir componente', () => app.select({ kind: 'component', type, name }), 'small', 'external-link') : null,
        btn('Convertir en local', () => {
          const resolved = app.project.read(path, true);
          if (resolved === undefined) { app.toast('No se puede resolver la referencia', 'error'); return; }
          app.edit('Convertir referencia en local', (tx) => tx.set(path, JSON.parse(JSON.stringify(resolved))), { after });
        }, 'small', 'copy')),
      F.field('Referencia', raw));
  }

  /* ---------- Parámetros ---------- */
  function paramForm(app, path, o) {
    o = o || {};
    const P = app.project;
    const node = P.read(path, false);
    const after = o.after || (() => {});
    if (!isObj(node)) return h('p', { class: 'muted' }, 'Parámetro no editable visualmente.');
    if (typeof node.$ref === 'string') return refBox(app, path, 'parameters', node, after);
    const inSel = h('select', { 'aria-label': 'Ubicación del parámetro' }, ['path', 'query', 'header', 'cookie'].map((x) => h('option', { value: x }, x)));
    inSel.value = node.in || 'query';
    inSel.addEventListener('change', () => app.edit('Ubicación del parámetro', (tx) => { tx.set(path.concat(['in']), inSel.value); if (inSel.value === 'path') tx.set(path.concat(['required']), true); }, { after }));
    const reqField = node.in === 'path'
      ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: true, disabled: true }), h('span', null, 'Obligatorio (siempre en path)'))
      : F.bool(app, 'Obligatorio', path.concat(['required']), { explicitFalse: false, text: 'Obligatorio', after });
    return h('div', { class: 'stack' },
      F.grid(F.text(app, 'Nombre', path.concat(['name']), { after: o.onRename }), F.field('Ubicación', inSel), F.text(app, 'Descripción', path.concat(['description']), { cls: 'span2' })),
      h('div', { class: 'row wrap flags' }, reqField, F.bool(app, 'Obsoleto', path.concat(['deprecated']), { text: 'Obsoleto' }), node.in === 'query' ? F.bool(app, 'Permitir vacío', path.concat(['allowEmptyValue']), { text: 'Permitir valor vacío' }) : null),
      F.section('Schema del parámetro'),
      S().schemaEditor(app, path.concat(['schema']), { compact: true, embedded: true, label: 'Schema', noModeBar: false }),
      F.grid(F.yamlValue(app, 'Ejemplo', path.concat(['example'])), F.select(app, 'style', path.concat(['style']), ['form', 'simple', 'matrix', 'label', 'spaceDelimited', 'pipeDelimited', 'deepObject']), F.bool(app, 'explode', path.concat(['explode']), { text: 'explode', explicitFalse: true })));
  }

  function paramSummary(app, listPath, i) {
    const p = app.project.read(listPath.concat([i]), false);
    if (!isObj(p)) return '(parámetro)';
    if (p.$ref) return '\u2192 ' + (F.refName(p.$ref) || p.$ref);
    return h('span', { class: 'sum' }, h('span', { class: 'badge in-' + p.in }, p.in || '?'), h('strong', null, p.name || '(sin nombre)'), p.required ? h('span', { class: 'badge req' }, 'obligatorio') : null, h('span', { class: 'muted' }, ' ' + S().summarize(app, p.schema)));
  }

  /** Lista de parámetros (de operación o de path item). `route` permite sugerir los parámetros de ruta que faltan. */
  function paramsList(app, listPath, o) {
    o = o || {};
    const wrap = h('div', { class: 'stack' });
    const P = app.project;
    const render = () => {
      wrap.textContent = '';
      const arr = P.read(listPath, true);
      const list = Array.isArray(arr) ? arr : [];
      const actions = [];
      const addBtn = btn('Añadir parámetro', (e) => showMenu(e.currentTarget, [
        { label: 'Parámetro de consulta (query)', icon: 'plus', onClick: () => add({ name: 'nuevoParametro', in: 'query', required: false, schema: { type: 'string' } }) },
        { label: 'Parámetro de ruta (path)', icon: 'plus', onClick: () => add({ name: 'nuevoParametro', in: 'path', required: true, schema: { type: 'string' } }) },
        { label: 'Cabecera (header)', icon: 'plus', onClick: () => add({ name: 'X-Nueva-Cabecera', in: 'header', required: false, schema: { type: 'string' } }) },
        { label: 'Cookie', icon: 'plus', onClick: () => add({ name: 'nuevaCookie', in: 'cookie', required: false, schema: { type: 'string' } }) },
        { separator: true },
        { label: 'Referencia a parámetro reutilizable...', icon: 'link', onClick: async () => { const n = await S().chooseComponent(app, 'parameters', 'Referenciar parámetro'); if (n) add({ $ref: O.ops.componentRef(P, listPath.concat([list.length]), 'parameters', n) }); } }
      ]), 'primary', 'plus');
      actions.push(addBtn);
      if (o.route) {
        const have = new Set();
        const collect = (l) => (Array.isArray(l) ? l : []).forEach((p) => { const r = isObj(p) && p.$ref ? P.read(['components', 'parameters', F.refName(p.$ref) || ''], true) : p; if (isObj(r) && r.in === 'path') have.add(r.name); });
        collect(list); if (o.parentList) collect(P.read(o.parentList, true));
        const missing = O.ops.pathParamsFromRoute(o.route).filter((n) => !have.has(n));
        if (missing.length) actions.push(btn('Añadir parámetros de ruta: ' + missing.join(', '), () => app.edit('Añadir parámetros de ruta', (tx) => missing.forEach((n) => tx.push(listPath, { name: n, in: 'path', required: true, schema: { type: 'string' } })), { after: render }), '', 'route'));
      }
      wrap.appendChild(h('div', { class: 'row wrap' }, actions));
      if (!list.length) wrap.appendChild(h('p', { class: 'muted' }, 'Sin parámetros.'));
      list.forEach((_, i) => {
        wrap.appendChild(F.fold(paramSummary(app, listPath, i), paramForm(app, listPath.concat([i]), { after: render }), false, [
          iconBtn('chevron-up', 'Subir parámetro', () => app.edit('Reordenar parámetros', (tx) => tx.reorder(listPath, i, -1), { after: render }), '', { disabled: i === 0 }),
          iconBtn('chevron-down', 'Bajar parámetro', () => app.edit('Reordenar parámetros', (tx) => tx.reorder(listPath, i, 1), { after: render }), '', { disabled: i === list.length - 1 }),
          iconBtn('copy', 'Duplicar parámetro', () => app.edit('Duplicar parámetro', (tx) => tx.duplicate(listPath, i), { after: render })),
          iconBtn('trash-2', 'Eliminar parámetro', () => app.edit('Eliminar parámetro', (tx) => { tx.del(listPath.concat([i])); if (list.length === 1) tx.del(listPath); }, { after: render }), 'danger-text')]));
      });
    };
    const add = (p) => app.edit('Añadir parámetro', (tx) => tx.push(listPath, p), { after: render });
    render();
    return wrap;
  }

  /* ---------- Cabeceras ---------- */
  function headerForm(app, path, after) {
    const node = app.project.read(path, false);
    if (!isObj(node)) return h('p', { class: 'muted' }, 'Cabecera no editable visualmente.');
    if (typeof node.$ref === 'string') return refBox(app, path, 'headers', node, after);
    return h('div', { class: 'stack' },
      F.text(app, 'Descripción', path.concat(['description'])),
      h('div', { class: 'row wrap flags' }, F.bool(app, 'Obligatoria', path.concat(['required']), { text: 'Obligatoria' }), F.bool(app, 'Obsoleta', path.concat(['deprecated']), { text: 'Obsoleta' })),
      S().schemaEditor(app, path.concat(['schema']), { compact: true, embedded: true, label: 'Schema' }),
      F.yamlValue(app, 'Ejemplo', path.concat(['example'])));
  }
  function headersEditor(app, path) {
    const wrap = h('div', { class: 'stack' });
    const render = () => {
      wrap.textContent = '';
      const map = app.project.read(path, true);
      const names = isObj(map) ? Object.keys(map) : [];
      const nn = h('input', { type: 'text', placeholder: 'X-Cabecera', 'aria-label': 'Nombre de la nueva cabecera' });
      const add = () => {
        const n = nn.value.trim();
        if (!n) return;
        if (names.includes(n)) { app.toast('Ya existe la cabecera ' + n, 'error'); return; }
        app.edit('Añadir cabecera ' + n, (tx) => tx.set(path.concat([n]), { description: '', schema: { type: 'string' } }), { after: render });
      };
      nn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
      wrap.appendChild(h('div', { class: 'row wrap add-row' }, nn, btn('Añadir cabecera', add, '', 'plus')));
      names.forEach((n) => wrap.appendChild(F.fold(h('span', { class: 'sum' }, h('strong', null, n)), headerForm(app, path.concat([n]), render), false, [
        iconBtn('pencil', 'Renombrar cabecera', async () => { const v = await app.prompt({ title: 'Renombrar cabecera', label: 'Nombre', value: n, validate: (x) => (!x ? 'Obligatorio' : x !== n && names.includes(x) ? 'Ya existe' : '') }); if (v && v !== n) app.edit('Renombrar cabecera', (tx) => tx.renameKey(path, n, v), { after: render }); }),
        iconBtn('trash-2', 'Eliminar cabecera', () => app.edit('Eliminar cabecera', (tx) => { tx.del(path.concat([n])); if (names.length === 1) tx.del(path); }, { after: render }), 'danger-text')])));
    };
    render();
    return wrap;
  }

  /* ---------- Contenido (media types) ---------- */
  function contentEditor(app, contentPath, o) {
    o = o || {};
    const wrap = h('div', { class: 'stack' });
    const render = () => {
      wrap.textContent = '';
      const map = app.project.read(contentPath, true);
      const types = isObj(map) ? Object.keys(map) : [];
      const addMedia = (mt) => {
        if (types.includes(mt)) { app.toast('Ya existe ' + mt, 'error'); return; }
        app.edit('Añadir media type ' + mt, (tx) => tx.set(contentPath.concat([mt]), { schema: { type: 'object', properties: {} } }), { after: render });
      };
      wrap.appendChild(h('div', { class: 'row wrap' }, btn('Añadir contenido', (e) => showMenu(e.currentTarget, MEDIA.filter((m) => !types.includes(m)).map((m) => ({ label: m, icon: 'plus', onClick: () => addMedia(m) })).concat([{ separator: true }, { label: 'Otro media type...', icon: 'pencil', onClick: async () => { const v = await app.prompt({ title: 'Media type', label: 'Media type', placeholder: 'application/vnd.ejemplo+json', validate: (x) => (!/^[\w!#$&^.+*-]+\/[\w!#$&^.+*-]+$/.test(x) ? 'Formato tipo/subtipo' : '') }); if (v) addMedia(v); } }])), '', 'plus')));
      if (!types.length) wrap.appendChild(h('p', { class: 'muted' }, o.emptyText || 'Sin contenido.'));
      types.forEach((mt) => {
        const base = contentPath.concat([mt]);
        wrap.appendChild(F.fold(h('span', { class: 'sum' }, h('strong', null, mt), h('span', { class: 'muted' }, ' ' + S().summarize(app, (map[mt] || {}).schema))), h('div', { class: 'stack' },
          S().schemaEditor(app, base.concat(['schema']), { compact: true, embedded: true, label: 'Schema' }),
          F.yamlValue(app, 'Ejemplo', base.concat(['example']))), true, [
          iconBtn('trash-2', 'Eliminar ' + mt, () => app.edit('Eliminar contenido ' + mt, (tx) => { tx.del(base); if (types.length === 1) tx.del(contentPath); }, { after: render }), 'danger-text')]));
      });
    };
    render();
    return wrap;
  }

  /* ---------- Cuerpo de petición ---------- */
  function bodyForm(app, path, after) {
    const node = app.project.read(path, false);
    if (!isObj(node)) return h('p', { class: 'muted' }, 'Cuerpo no editable visualmente.');
    if (typeof node.$ref === 'string') return refBox(app, path, 'requestBodies', node, after);
    return h('div', { class: 'stack' },
      F.grid(F.text(app, 'Descripción', path.concat(['description']), { cls: 'span2' })),
      F.bool(app, 'Obligatorio', path.concat(['required']), { text: 'Cuerpo obligatorio' }),
      F.section('Contenido'),
      contentEditor(app, path.concat(['content']), { emptyText: 'Añade al menos un media type.' }));
  }
  function bodyEditor(app, opPath) {
    const path = opPath.concat(['requestBody']);
    const wrap = h('div', { class: 'stack' });
    const render = () => {
      wrap.textContent = '';
      const node = app.project.read(path, false);
      if (node === undefined) {
        wrap.appendChild(h('div', { class: 'empty-slot' }, h('span', { class: 'muted' }, 'Esta operación no tiene cuerpo de petición.'), h('div', { class: 'row' },
          btn('Añadir cuerpo JSON', () => app.edit('Añadir cuerpo', (tx) => tx.set(path, { required: true, content: { 'application/json': { schema: { type: 'object', properties: {} } } } }), { after: render }), 'primary', 'plus'),
          btn('Referenciar cuerpo reutilizable...', async () => { const n = await S().chooseComponent(app, 'requestBodies', 'Referenciar cuerpo'); if (n) app.op(() => O.ops.setRef(app.project, path, 'requestBodies', n), { after: render }); }, '', 'link'))));
        return;
      }
      wrap.appendChild(h('div', { class: 'row' }, btn('Eliminar cuerpo', async () => { if (await app.confirm({ title: 'Eliminar cuerpo de petición', message: 'Se eliminará el requestBody de esta operación.', confirmLabel: 'Eliminar', danger: true })) app.edit('Eliminar cuerpo', (tx) => tx.del(path), { after: render }); }, 'danger-text', 'trash-2')));
      wrap.appendChild(bodyForm(app, path, render));
    };
    render();
    return wrap;
  }

  /* ---------- Respuestas ---------- */
  function responseForm(app, path, after) {
    const node = app.project.read(path, false);
    if (!isObj(node)) return h('p', { class: 'muted' }, 'Respuesta no editable visualmente.');
    if (typeof node.$ref === 'string') return refBox(app, path, 'responses', node, after);
    return h('div', { class: 'stack' },
      F.text(app, 'Descripción', path.concat(['description']), { hint: 'Obligatoria en OpenAPI 3.0' }),
      F.section('Cabeceras'), headersEditor(app, path.concat(['headers'])),
      F.section('Contenido'), contentEditor(app, path.concat(['content']), { emptyText: 'Sin cuerpo de respuesta.' }));
  }
  function responsesEditor(app, opPath) {
    const path = opPath.concat(['responses']);
    const wrap = h('div', { class: 'stack' });
    const render = () => {
      wrap.textContent = '';
      const map = app.project.read(path, true);
      const codes = isObj(map) ? Object.keys(map) : [];
      const add = (code, desc) => {
        if (codes.includes(code)) { app.toast('Ya existe la respuesta ' + code, 'error'); return; }
        app.edit('Añadir respuesta ' + code, (tx) => tx.set(path.concat([code]), { description: desc || CODES[code] || 'Respuesta' }), { after: render });
      };
      wrap.appendChild(h('div', { class: 'row wrap' }, btn('Añadir respuesta', (e) => showMenu(e.currentTarget, Object.keys(CODES).filter((c) => !codes.includes(c)).map((c) => ({ label: c + ' \u2013 ' + CODES[c], onClick: () => add(c) })).concat([{ separator: true }, { label: 'Otro código...', icon: 'pencil', onClick: async () => { const v = await app.prompt({ title: 'Código de respuesta', label: 'Código HTTP', placeholder: '418, 2XX o default', validate: (x) => (!/^([1-5]\d\d|[1-5]XX|default)$/.test(x) ? 'Usa 100-599, 2XX o default' : '') }); if (v) add(v); } }])), 'primary', 'plus')));
      if (!codes.length) wrap.appendChild(h('p', { class: 'muted' }, 'Sin respuestas: OpenAPI exige al menos una.'));
      codes.forEach((code, i) => {
        const r = map[code];
        const cls = /^2/.test(code) ? 'ok' : /^[45]/.test(code) ? 'err' : /^3/.test(code) ? 'warn' : '';
        wrap.appendChild(F.fold(h('span', { class: 'sum' }, h('span', { class: 'badge code ' + cls }, code), h('span', null, isObj(r) ? (r.$ref ? '\u2192 ' + (F.refName(r.$ref) || r.$ref) : r.description || '') : '')), responseForm(app, path.concat([code]), render), false, [
          iconBtn('pencil', 'Cambiar código', async () => { const v = await app.prompt({ title: 'Cambiar código', label: 'Código HTTP', value: code, validate: (x) => (!/^([1-5]\d\d|[1-5]XX|default)$/.test(x) ? 'Usa 100-599, 2XX o default' : x !== code && codes.includes(x) ? 'Ya existe' : '') }); if (v && v !== code) app.edit('Cambiar código de respuesta', (tx) => tx.renameKey(path, code, v), { after: render }); }),
          iconBtn('chevron-up', 'Subir', () => app.edit('Reordenar respuestas', (tx) => tx.reorder(path, code, -1), { after: render }), '', { disabled: i === 0 }),
          iconBtn('chevron-down', 'Bajar', () => app.edit('Reordenar respuestas', (tx) => tx.reorder(path, code, 1), { after: render }), '', { disabled: i === codes.length - 1 }),
          iconBtn('trash-2', 'Eliminar respuesta', async () => { if (await app.confirm({ title: 'Eliminar respuesta', message: 'Se eliminará la respuesta ' + code + '.', confirmLabel: 'Eliminar', danger: true })) app.edit('Eliminar respuesta ' + code, (tx) => tx.del(path.concat([code])), { after: render }); }, 'danger-text')]));
      });
    };
    render();
    return wrap;
  }

  /* ---------- Seguridad ---------- */
  function securityEditor(app, path, o) {
    o = o || {};
    const wrap = h('div', { class: 'stack' });
    const render = () => {
      wrap.textContent = '';
      const sec = app.project.read(path, true);
      const schemes = (app.project.getModel().components.securitySchemes || []).map((s) => s.name);
      const list = Array.isArray(sec) ? sec : null;
      const state = list === null ? (o.inherit ? 'Hereda la seguridad global del contrato' : 'Sin requisitos de seguridad') : (list.length === 0 ? 'Público: sin autenticación' : list.length + ' alternativa(s) de autenticación');
      wrap.appendChild(h('div', { class: 'row wrap' }, h('span', { class: 'muted' }, state),
        btn('Añadir requisito', () => { if (!schemes.length) { app.toast('Define primero un esquema en components.securitySchemes', 'error'); return; } app.edit('Añadir requisito de seguridad', (tx) => tx.push(path, { [schemes[0]]: [] }), { after: render }); }, '', 'plus'),
        o.inherit ? btn('Marcar como público', () => app.edit('Operación pública', (tx) => tx.set(path, []), { after: render }), '', 'lock') : null,
        o.inherit && list !== null ? btn('Heredar del contrato', () => app.edit('Heredar seguridad', (tx) => tx.del(path), { after: render }), '', 'refresh-cw') : null));
      (list || []).forEach((req, i) => {
        const schemeNames = isObj(req) ? Object.keys(req) : [];
        const body = h('div', { class: 'stack' });
        schemeNames.forEach((sn) => {
          const sel = h('select', { 'aria-label': 'Esquema de seguridad' }, (schemes.includes(sn) ? schemes : schemes.concat([sn])).map((x) => h('option', { value: x }, x)));
          sel.value = sn;
          sel.addEventListener('change', () => app.edit('Cambiar esquema', (tx) => tx.renameKey(path.concat([i]), sn, sel.value), { after: render }));
          body.appendChild(h('div', { class: 'row wrap' }, sel, F.chips(app, 'Scopes', path.concat([i, sn]), { placeholder: 'scope', cls: 'grow' }), iconBtn('trash-2', 'Quitar esquema', () => app.edit('Quitar esquema', (tx) => { tx.del(path.concat([i, sn])); }, { after: render }), 'danger-text')));
        });
        const free = schemes.filter((s) => !schemeNames.includes(s));
        if (free.length) body.appendChild(btn('Combinar con otro esquema', () => app.edit('Combinar esquema', (tx) => tx.set(path.concat([i, free[0]]), []), { after: render }), 'small', 'plus'));
        wrap.appendChild(F.fold('Alternativa ' + (i + 1) + ': ' + (schemeNames.join(' + ') || '(vacía: público)'), body, true, [iconBtn('trash-2', 'Eliminar requisito', () => app.edit('Eliminar requisito', (tx) => { tx.del(path.concat([i])); if (list.length === 1 && !o.inherit) tx.del(path); }, { after: render }), 'danger-text')]));
      });
    };
    render();
    return wrap;
  }

  O.content = { paramForm, paramsList, headerForm, headersEditor, contentEditor, bodyForm, bodyEditor, responseForm, responsesEditor, securityEditor, refBox };
})();
