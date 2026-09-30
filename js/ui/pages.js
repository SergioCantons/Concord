/* Páginas contextuales del área principal: resumen/info, ruta, operación, componente y fichero. */
(function () {
  'use strict';
  const O = (window.OAT = window.OAT || {});
  const { h, icon, iconBtn, btn, showMenu, modal } = O.dom;
  const F = O.forms;
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];
  const TYPE_LABEL = { schemas: 'Schema', responses: 'Respuesta', parameters: 'Parámetro', examples: 'Ejemplo', requestBodies: 'Cuerpo de petición', headers: 'Cabecera', securitySchemes: 'Esquema de seguridad', links: 'Link', callbacks: 'Callback' };
  const PAGE = (O.pages = {});
  PAGE.TYPE_LABEL = TYPE_LABEL;

  function header(lead, title, sub, actions) {
    return h('div', { class: 'page-head' }, h('div', { class: 'page-title' }, lead, h('div', null, h('h2', null, title), sub ? h('p', { class: 'muted' }, sub) : null)), h('div', { class: 'page-actions' }, actions));
  }
  function defined(app, logical) {
    const p = app.project.phys(logical, true);
    return p.error ? null : p.file;
  }
  function locationChip(app, logical) {
    const f = defined(app, logical);
    if (!f) return null;
    return h('button', { type: 'button', class: 'file-chip', title: 'Abrir el fichero en YAML', onclick: () => app.showYamlFor(logical) }, icon('file-code'), h('span', null, f));
  }
  async function moveToFile(app, logical, suggestion) {
    const name = await app.prompt({ title: 'Mover a fragmento', label: 'Ruta del nuevo fichero (relativa al proyecto)', value: suggestion, message: 'El contenido se moverá a un fichero nuevo y aquí quedará un $ref relativo.', validate: (v) => { if (!/\.(ya?ml|json)$/i.test(v)) return 'Usa la extensión .yaml o .yml'; try { O.fileio.safePath(v); } catch (e) { return e.message; } return app.project.files.has(v.replace(/\\/g, '/')) ? 'Ya existe ese fichero' : ''; } });
    if (!name) return;
    if (app.edit('Mover a fragmento', (tx) => tx.extractToFile(logical, name), { rerender: true })) app.toast('Movido a ' + name, 'ok');
  }

  /* ---------- Info / resumen ---------- */
  PAGE.info = function (app) {
    const P = app.project;
    const m = P.getModel();
    const counts = {};
    let ops = 0;
    m.paths.forEach((p) => p.methods.forEach((x) => { counts[x.method] = (counts[x.method] || 0) + 1; ops++; }));
    const stats = h('div', { class: 'stats' },
      stat(m.paths.length, 'rutas'), stat(ops, 'operaciones'), stat((m.components.schemas || []).length, 'schemas'), stat(m.tags.length, 'tags'), stat(m.files.length, 'ficheros'),
      h('div', { class: 'stat methods' }, METHODS.filter((x) => counts[x]).map((x) => h('span', { class: 'method m-' + x, title: counts[x] + ' operaciones ' + x.toUpperCase() }, x.toUpperCase() + ' ' + counts[x]))));
    function stat(n, label) { return h('div', { class: 'stat' }, h('strong', null, String(n)), h('span', null, label)); }
    const tabs = F.tabs([
      { id: 'general', label: 'General', render: () => general() },
      { id: 'servers', label: 'Servidores', badge: m.servers.length || '', render: () => servers() },
      { id: 'tags', label: 'Tags', badge: m.tags.length || '', render: () => tags() },
      { id: 'security', label: 'Seguridad', render: () => h('div', { class: 'stack' }, F.section('Requisitos globales'), O.content.securityEditor(app, ['security']), F.section('Esquemas definidos'), schemes()) },
      { id: 'ext', label: 'Extensiones', render: () => h('div', { class: 'stack' }, F.section('Extensiones de info'), F.extensions(app, ['info']), F.section('Extensiones del contrato'), F.extensions(app, [])) }
    ], app.tabMemory.info || 'general', (id) => { app.tabMemory.info = id; });

    function general() {
      const versions = ['3.0.0', '3.0.1', '3.0.2', '3.0.3'];
      const cur = String(m.openapi || '');
      const opts = versions.concat(cur && !versions.includes(cur) ? [cur] : []);
      const warn = /^3\.1/.test(cur) ? h('div', { class: 'callout warn' }, icon('alert-triangle'), h('span', null, 'OpenAPI 3.1 no está totalmente soportado: la validación estructural se omite y algunas funciones pueden ser parciales.')) : null;
      return h('div', { class: 'stack' }, warn,
        F.grid(F.select(app, 'Versión de OpenAPI', ['openapi'], opts, { empty: false }), F.text(app, 'Título', ['info', 'title']), F.text(app, 'Versión del contrato', ['info', 'version']), F.text(app, 'Términos de servicio', ['info', 'termsOfService']),
          F.text(app, 'Descripción', ['info', 'description'], { textarea: true, rows: 4, cls: 'span2' })),
        F.section('Contacto'), F.grid(F.text(app, 'Nombre', ['info', 'contact', 'name']), F.text(app, 'Email', ['info', 'contact', 'email']), F.text(app, 'URL', ['info', 'contact', 'url'])),
        F.section('Licencia'), F.grid(F.text(app, 'Nombre', ['info', 'license', 'name']), F.text(app, 'URL', ['info', 'license', 'url'])),
        F.section('Documentación externa'), F.grid(F.text(app, 'URL', ['externalDocs', 'url']), F.text(app, 'Descripción', ['externalDocs', 'description'])));
    }
    function servers() {
      const wrap = h('div', { class: 'stack' });
      const render = () => {
        wrap.textContent = '';
        const list = P.read(['servers'], true);
        const arr = Array.isArray(list) ? list : [];
        wrap.appendChild(h('div', { class: 'row' }, btn('Añadir servidor', () => app.edit('Añadir servidor', (tx) => tx.push(['servers'], { url: 'https://api.ejemplo.com', description: '' }), { after: render }), 'primary', 'plus')));
        if (!arr.length) wrap.appendChild(h('p', { class: 'muted' }, 'Sin servidores: OpenAPI usa "/" por defecto.'));
        arr.forEach((s, i) => wrap.appendChild(F.fold(h('span', { class: 'sum' }, h('strong', null, (s && s.url) || '(sin URL)'), h('span', { class: 'muted' }, ' ' + ((s && s.description) || ''))), h('div', { class: 'stack' },
          F.grid(F.text(app, 'URL', ['servers', i, 'url']), F.text(app, 'Descripción', ['servers', i, 'description'])), F.yamlValue(app, 'Variables (YAML)', ['servers', i, 'variables'], { rows: 4 })), false, [
          iconBtn('chevron-up', 'Subir', () => app.edit('Reordenar servidores', (tx) => tx.reorder(['servers'], i, -1), { after: render }), '', { disabled: i === 0 }),
          iconBtn('chevron-down', 'Bajar', () => app.edit('Reordenar servidores', (tx) => tx.reorder(['servers'], i, 1), { after: render }), '', { disabled: i === arr.length - 1 }),
          iconBtn('trash-2', 'Eliminar servidor', () => app.edit('Eliminar servidor', (tx) => { tx.del(['servers', i]); if (arr.length === 1) tx.del(['servers']); }, { after: render }), 'danger-text')])));
      };
      render();
      return wrap;
    }
    function tags() {
      const wrap = h('div', { class: 'stack' });
      const render = () => {
        wrap.textContent = '';
        const arr = P.read(['tags'], true);
        const list = Array.isArray(arr) ? arr : [];
        wrap.appendChild(h('div', { class: 'row' }, btn('Añadir tag', async () => { const n = await app.prompt({ title: 'Nuevo tag', label: 'Nombre', validate: (v) => (!v ? 'Obligatorio' : list.some((t) => t && t.name === v) ? 'Ya existe' : '') }); if (n) app.edit('Añadir tag', (tx) => tx.push(['tags'], { name: n }), { after: render }); }, 'primary', 'plus')));
        if (!list.length) wrap.appendChild(h('p', { class: 'muted' }, 'Sin tags declarados.'));
        list.forEach((t, i) => {
          const used = m.paths.reduce((n, p) => n + p.methods.filter((x) => x.tags.includes(t && t.name)).length, 0);
          wrap.appendChild(F.fold(h('span', { class: 'sum' }, h('strong', null, (t && t.name) || '(sin nombre)'), h('span', { class: 'muted' }, ' ' + used + ' operación(es)')), h('div', { class: 'stack' },
            F.text(app, 'Descripción', ['tags', i, 'description']), F.grid(F.text(app, 'Documentación externa (URL)', ['tags', i, 'externalDocs', 'url']), F.text(app, 'Descripción de la documentación', ['tags', i, 'externalDocs', 'description']))), false, [
            iconBtn('pencil', 'Renombrar tag (actualiza operaciones)', async () => { const n = await app.prompt({ title: 'Renombrar tag', label: 'Nombre', value: t.name, validate: (v) => (!v ? 'Obligatorio' : v !== t.name && list.some((x) => x && x.name === v) ? 'Ya existe' : '') }); if (n && n !== t.name) app.op(() => O.ops.renameTag(P, t.name, n), { after: render }); }),
            iconBtn('chevron-up', 'Subir', () => app.edit('Reordenar tags', (tx) => tx.reorder(['tags'], i, -1), { after: render }), '', { disabled: i === 0 }),
            iconBtn('chevron-down', 'Bajar', () => app.edit('Reordenar tags', (tx) => tx.reorder(['tags'], i, 1), { after: render }), '', { disabled: i === list.length - 1 }),
            iconBtn('trash-2', 'Eliminar tag', () => app.edit('Eliminar tag', (tx) => { tx.del(['tags', i]); if (list.length === 1) tx.del(['tags']); }, { after: render }), 'danger-text')]));
        });
      };
      render();
      return wrap;
    }
    function schemes() {
      const list = m.components.securitySchemes || [];
      if (!list.length) return h('p', { class: 'muted' }, 'Sin esquemas de seguridad.');
      return h('ul', { class: 'usage-list' }, list.map((s) => h('li', null, h('button', { type: 'button', class: 'link', onclick: () => app.select({ kind: 'component', type: 'securitySchemes', name: s.name }) }, s.name))));
    }
    return h('div', { class: 'page' }, header(h('span', { class: 'lead-icon' }, icon('info')), m.info.title || 'Contrato', 'Información general, servidores, tags y seguridad', null), stats, tabs);
  };

  /* ---------- Ruta ---------- */
  PAGE.path = function (app, sel) {
    const P = app.project;
    const route = sel.route;
    const entry = P.getModel().paths.find((p) => p.path === route);
    if (!entry) return h('div', { class: 'page' }, h('p', { class: 'muted' }, 'La ruta ya no existe.'));
    const logical = ['paths', route];
    const actions = [
      btn('Renombrar ruta', () => renameRoute(app, route), '', 'pencil'),
      btn('Añadir método', (e) => showMenu(e.currentTarget, METHODS.filter((mm) => !entry.methods.some((x) => x.method === mm)).map((mm) => ({ label: mm.toUpperCase(), onClick: () => app.op(() => { O.ops.addOperation(P, route, mm); app.select({ kind: 'operation', route, method: mm }); }, { rerender: false }) }))), '', 'plus'),
      btn('Más', (e) => showMenu(e.currentTarget, [{ label: 'Mover a fragmento...', icon: 'scissors', onClick: () => moveToFile(app, logical, 'paths/' + O.util.slug(route) + '.yaml') }, { separator: true }, { label: 'Eliminar ruta', icon: 'trash-2', danger: true, onClick: () => deletePath(app, route) }]), '', 'list')
    ];
    const tabs = F.tabs([
      { id: 'general', label: 'General', render: () => h('div', { class: 'stack' }, F.grid(F.text(app, 'Resumen', logical.concat(['summary'])), F.text(app, 'Descripción', logical.concat(['description']), { textarea: true, rows: 3, cls: 'span2' })), locationChip(app, logical)) },
      { id: 'ops', label: 'Operaciones', badge: entry.methods.length, render: () => h('div', { class: 'stack' }, entry.methods.length ? entry.methods.map((x) => h('button', { type: 'button', class: 'list-row', onclick: () => app.select({ kind: 'operation', route, method: x.method }) }, F.methodBadge(x.method), h('span', null, x.summary || x.operationId || ''), h('small', { class: 'muted' }, x.operationId))) : h('p', { class: 'muted' }, 'Sin operaciones.')) },
      { id: 'params', label: 'Parámetros compartidos', render: () => O.content.paramsList(app, logical.concat(['parameters']), { route }) },
      { id: 'adv', label: 'Avanzado', render: () => h('div', { class: 'stack' }, F.section('Extensiones x-*'), F.extensions(app, logical), F.section('Servidores del path item'), F.nodeYaml(app, logical.concat(['servers']), { rows: 5, label: 'Editar servidores' })) }
    ], app.tabMemory.path || 'general', (id) => { app.tabMemory.path = id; });
    return h('div', { class: 'page' }, header(h('span', { class: 'lead-icon' }, icon('route')), route, entry.error || null, actions), tabs);
  };
  async function renameRoute(app, route) {
    const v = await app.prompt({ title: 'Renombrar ruta', label: 'Nueva ruta', value: route, validate: (x) => (!x.startsWith('/') ? 'Debe empezar por "/"' : x !== route && app.project.getModel().paths.some((p) => p.path === x) ? 'La ruta ya existe' : '') });
    if (v && v !== route) app.op(() => { O.ops.renameRoute(app.project, route, v); app.selectSilently((s) => (s.route === route ? Object.assign({}, s, { route: v }) : s)); }, { rerender: true });
  }
  async function deletePath(app, route) {
    if (await app.confirm({ title: 'Eliminar ruta', message: 'Se eliminará ' + route + ' y todas sus operaciones.', confirmLabel: 'Eliminar', danger: true })) app.op(() => { O.ops.deletePath(app.project, route); app.select({ kind: 'info' }); }, { rerender: false });
  }

  /* ---------- Operación ---------- */
  PAGE.operation = function (app, sel) {
    const P = app.project;
    const { route, method } = sel;
    const logical = ['paths', route, method];
    const op = P.read(logical, true);
    if (!isObj(op)) return h('div', { class: 'page' }, h('p', { class: 'muted' }, 'La operación ya no existe.'));
    const actions = [
      btn('Duplicar', () => duplicateDialog(app, route, method), '', 'copy'),
      btn('Más', (e) => showMenu(e.currentTarget, [
        { label: 'Renombrar ruta...', icon: 'pencil', onClick: () => renameRoute(app, route) },
        { label: 'Cambiar método...', icon: 'arrow-left-right', onClick: () => changeMethod(app, route, method) },
        { label: 'Mover la ruta a fragmento...', icon: 'scissors', onClick: () => moveToFile(app, ['paths', route], 'paths/' + O.util.slug(route) + '.yaml') },
        { separator: true },
        { label: 'Eliminar operación', icon: 'trash-2', danger: true, onClick: async () => { if (await app.confirm({ title: 'Eliminar operación', message: 'Se eliminará ' + method.toUpperCase() + ' ' + route + '.', confirmLabel: 'Eliminar', danger: true })) app.op(() => { O.ops.deleteOperation(P, route, method); app.select({ kind: 'path', route }); }, { rerender: false }); } }
      ]), '', 'list')
    ];
    const paramCount = (Array.isArray(op.parameters) ? op.parameters.length : 0);
    const respCount = isObj(op.responses) ? Object.keys(op.responses).length : 0;
    const dl = 'dl-tags';
    const tagNames = P.getModel().tags.map((t) => t && t.name).filter(Boolean);
    const general = () => {
      const idInput = h('input', { type: 'text', class: 'mono', value: op.operationId || '', 'aria-label': 'operationId' });
      const idHint = h('span', { class: 'field-hint' });
      const check = () => {
        const others = O.ops.operationIds(P); if (op.operationId) others.delete(op.operationId);
        const v = idInput.value.trim();
        idHint.textContent = v && others.has(v) ? 'Este operationId ya lo usa otra operación.' : '';
        idHint.classList.toggle('field-error', !!idHint.textContent);
        return !(v && others.has(v));
      };
      idInput.addEventListener('input', check);
      idInput.addEventListener('change', () => {
        if (!check() && app.settings.opIdUnique === 'error') { app.toast('operationId duplicado: elige otro', 'error'); idInput.value = op.operationId || ''; check(); return; }
        const v = idInput.value.trim();
        app.edit('operationId', (tx) => tx.set(logical.concat(['operationId']), v === '' ? undefined : v), { coalesce: true });
      });
      const gen = btn('Generar', () => { idInput.value = O.ops.uniqueOperationId(P, O.ops.defaultOperationId(method, route), op.operationId); idInput.dispatchEvent(new Event('change')); }, 'small', 'refresh-cw');
      return h('div', { class: 'stack' },
        F.grid(F.text(app, 'Resumen', logical.concat(['summary'])), h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'operationId'), h('div', { class: 'row nowrap' }, idInput, gen), idHint),
          F.text(app, 'Descripción', logical.concat(['description']), { textarea: true, rows: 4, cls: 'span2' })),
        h('datalist', { id: dl }, tagNames.map((t) => h('option', { value: t }))),
        F.chips(app, 'Tags', logical.concat(['tags']), { list: dl, placeholder: 'Añadir tag y Enter' }),
        F.bool(app, 'Obsoleta', logical.concat(['deprecated']), { text: 'Operación obsoleta' }),
        F.section('Documentación externa'), F.grid(F.text(app, 'URL', logical.concat(['externalDocs', 'url'])), F.text(app, 'Descripción', logical.concat(['externalDocs', 'description']))),
        locationChip(app, logical));
    };
    const tabs = F.tabs([
      { id: 'general', label: 'General', render: general },
      { id: 'params', label: 'Parámetros', badge: paramCount || '', render: () => O.content.paramsList(app, logical.concat(['parameters']), { route, parentList: ['paths', route, 'parameters'] }) },
      { id: 'body', label: 'Cuerpo', render: () => O.content.bodyEditor(app, logical) },
      { id: 'responses', label: 'Respuestas', badge: respCount || '', render: () => O.content.responsesEditor(app, logical) },
      { id: 'security', label: 'Seguridad', render: () => O.content.securityEditor(app, logical.concat(['security']), { inherit: true }) },
      { id: 'adv', label: 'Avanzado', render: () => h('div', { class: 'stack' }, F.section('Extensiones x-*'), F.extensions(app, logical), F.section('Servidores de la operación'), F.nodeYaml(app, logical.concat(['servers']), { rows: 5 }), F.section('Callbacks'), F.nodeYaml(app, logical.concat(['callbacks']), { rows: 6, label: 'Editar callbacks' })) }
    ], app.tabMemory.operation || 'general', (id) => { app.tabMemory.operation = id; });
    return h('div', { class: 'page' }, header(F.methodBadge(method), route, op.summary || '', actions), tabs);
  };

  async function changeMethod(app, route, method) {
    const cur = app.project.read(['paths', route], true) || {};
    const free = METHODS.filter((m) => m !== method && !cur[m]);
    const sel = h('select', { 'aria-label': 'Nuevo método' }, free.map((m) => h('option', { value: m }, m.toUpperCase())));
    const r = await modal({ title: 'Cambiar método HTTP', content: h('div', { class: 'stack' }, F.field('Nuevo método', sel)), cancelValue: null, actions: [{ label: 'Cancelar', value: null }, { label: 'Cambiar', kind: 'primary', value: '__ok__' }] }).promise;
    if (r === '__ok__' && sel.value) app.op(() => { O.ops.changeMethod(app.project, route, method, sel.value); app.selectSilently((s) => Object.assign({}, s, { method: sel.value })); }, { rerender: true });
  }
  async function duplicateDialog(app, route, method) {
    const P = app.project;
    const routeIn = h('input', { type: 'text', value: route, 'aria-label': 'Ruta del duplicado' });
    const methodSel = h('select', { 'aria-label': 'Método del duplicado' }, METHODS.map((m) => h('option', { value: m }, m.toUpperCase())));
    methodSel.value = method;
    const orig = P.read(['paths', route, method], true) || {};
    const idIn = h('input', { type: 'text', class: 'mono', value: O.ops.uniqueOperationId(P, orig.operationId || O.ops.defaultOperationId(method, route)), 'aria-label': 'operationId del duplicado' });
    const err = h('div', { class: 'field-error', role: 'alert' });
    const m = modal({ title: 'Duplicar operación', content: h('div', { class: 'stack' }, F.field('Ruta', routeIn), F.field('Método', methodSel), F.field('operationId', idIn), err), cancelValue: null, actions: [{ label: 'Cancelar', value: null }, { label: 'Duplicar', kind: 'primary', value: '__ok__', onClick: () => {
      const r = routeIn.value.trim(); const mm = methodSel.value; const id = idIn.value.trim();
      if (!r.startsWith('/')) { err.textContent = 'La ruta debe empezar por "/"'; return false; }
      if (O.ops.operationIds(P).has(id)) { err.textContent = 'Ese operationId ya existe'; return false; }
      const ex = P.read(['paths', r], true);
      if (ex && ex[mm]) { err.textContent = r + ' ya tiene ' + mm.toUpperCase(); return false; }
      if (r === route && mm === method) { err.textContent = 'Cambia la ruta o el método'; return false; }
      return true;
    } }] });
    const res = await m.promise;
    if (res === '__ok__') app.op(() => { O.ops.duplicateOperation(P, route, method, { toRoute: routeIn.value.trim(), toMethod: methodSel.value, operationId: idIn.value.trim() }); app.select({ kind: 'operation', route: routeIn.value.trim(), method: methodSel.value }); }, { rerender: false, ok: 'Operación duplicada' });
  }

  /* ---------- Componentes ---------- */
  PAGE.component = function (app, sel) {
    const P = app.project;
    const { type, name } = sel;
    const logical = ['components', type, name];
    if (defined(app, logical) === null || P.read(logical, false) === undefined) return h('div', { class: 'page' }, h('p', { class: 'muted' }, 'El componente ya no existe.'));
    const consumers = O.ops.componentConsumers(P, type, name);
    const actions = [
      btn('Renombrar', async () => {
        const v = await app.prompt({ title: 'Renombrar ' + TYPE_LABEL[type].toLowerCase(), label: 'Nuevo nombre', value: name, message: consumers.length ? 'Se actualizarán ' + consumers.length + ' referencia(s).' : '', validate: (x) => (!/^[A-Za-z0-9._-]+$/.test(x) ? 'Solo letras, números, punto, guion y guion bajo' : x !== name && (P.getModel().components[type] || []).some((c) => c.name === x) ? 'Ya existe' : '') });
        if (v && v !== name) app.op(() => { O.ops.renameComponent(P, type, name, v); app.selectSilently((s) => Object.assign({}, s, { name: v })); }, { rerender: true, ok: 'Renombrado; referencias actualizadas' });
      }, '', 'pencil'),
      btn('Duplicar', async () => {
        const v = await app.prompt({ title: 'Duplicar', label: 'Nombre de la copia', value: name + 'Copia', validate: (x) => (!/^[A-Za-z0-9._-]+$/.test(x) ? 'Solo letras, números, punto, guion y guion bajo' : (P.getModel().components[type] || []).some((c) => c.name === x) ? 'Ya existe' : '') });
        if (v) app.op(() => { O.ops.duplicateComponent(P, type, name, v); app.select({ kind: 'component', type, name: v }); }, { rerender: false, ok: 'Duplicado como ' + v });
      }, '', 'copy'),
      btn('Más', (e) => showMenu(e.currentTarget, [{ label: 'Mover a fragmento...', icon: 'scissors', onClick: () => moveToFile(app, logical, type + '/' + name + '.yaml') }, { separator: true }, { label: 'Eliminar...', icon: 'trash-2', danger: true, onClick: () => deleteComponent(app, type, name) }]), '', 'list')
    ];
    let bodyEl;
    const after = () => app.rerender();
    if (type === 'schemas') bodyEl = O.schemaUI.schemaEditor(app, logical, { label: name, isComponentRoot: true, usage: { type, name } });
    else if (type === 'parameters') bodyEl = O.content.paramForm(app, logical, { after });
    else if (type === 'responses') bodyEl = O.content.responseForm(app, logical, after);
    else if (type === 'requestBodies') bodyEl = O.content.bodyForm(app, logical, after);
    else if (type === 'headers') bodyEl = O.content.headerForm(app, logical, after);
    else if (type === 'securitySchemes') bodyEl = securityScheme(app, logical);
    else if (type === 'examples') bodyEl = h('div', { class: 'stack' }, F.grid(F.text(app, 'Resumen', logical.concat(['summary'])), F.text(app, 'URL externa', logical.concat(['externalValue'])), F.text(app, 'Descripción', logical.concat(['description']), { cls: 'span2' })), F.yamlValue(app, 'Valor', logical.concat(['value']), { rows: 8 }));
    else bodyEl = F.nodeYaml(app, logical, { rows: 14 });
    const usage = type === 'schemas' ? null : h('div', { class: 'stack' }, F.section('Referencias (' + consumers.length + ')'), consumers.length ? h('ul', { class: 'usage-list' }, consumers.map((u) => h('li', null, h('button', { type: 'button', class: 'link', onclick: () => app.goLocation(u.file, u.yamlPath, u.logical) }, u.label)))) : h('p', { class: 'muted' }, 'Nada referencia este componente.'));
    return h('div', { class: 'page' }, header(h('span', { class: 'badge kind' }, TYPE_LABEL[type]), name, null, actions), locationChip(app, logical), bodyEl, usage, type === 'schemas' ? null : h('div', { class: 'stack' }, F.section('Extensiones x-*'), F.extensions(app, logical)));
  };
  async function deleteComponent(app, type, name) {
    const consumers = O.ops.componentConsumers(app.project, type, name);
    const ok = await app.confirm({
      title: 'Eliminar ' + TYPE_LABEL[type].toLowerCase(),
      message: consumers.length ? '"' + name + '" está referenciado en ' + consumers.length + ' sitio(s). Si lo eliminas, esas referencias quedarán rotas (podrás deshacerlo).' : 'Se eliminará "' + name + '".',
      details: consumers.map((c) => c.label + '  (' + c.file + ')'), confirmLabel: consumers.length ? 'Eliminar igualmente' : 'Eliminar', danger: true });
    if (ok) app.op(() => { O.ops.deleteComponent(app.project, type, name, { force: true }); app.select({ kind: 'info' }); }, { rerender: false });
  }
  PAGE.deleteComponent = deleteComponent;
  function securityScheme(app, path) {
    const node = app.project.read(path, false) || {};
    const t = node.type;
    return h('div', { class: 'stack' },
      F.grid(F.select(app, 'Tipo', path.concat(['type']), ['apiKey', 'http', 'oauth2', 'openIdConnect'], { empty: false, after: () => app.rerender() }), F.text(app, 'Descripción', path.concat(['description'])),
        t === 'apiKey' ? F.text(app, 'Nombre del parámetro', path.concat(['name'])) : null, t === 'apiKey' ? F.select(app, 'Ubicación', path.concat(['in']), ['header', 'query', 'cookie'], { empty: false }) : null,
        t === 'http' ? F.text(app, 'Esquema (bearer, basic...)', path.concat(['scheme'])) : null, t === 'http' ? F.text(app, 'Formato del bearer', path.concat(['bearerFormat'])) : null,
        t === 'openIdConnect' ? F.text(app, 'URL de OpenID Connect', path.concat(['openIdConnectUrl'])) : null),
      t === 'oauth2' ? F.yamlValue(app, 'Flujos (flows, YAML)', path.concat(['flows']), { rows: 10 }) : null);
  }

  /* ---------- Fichero ---------- */
  PAGE.file = function (app, sel) {
    const P = app.project;
    const f = P.file(sel.path);
    if (!f) return h('div', { class: 'page' }, h('p', { class: 'muted' }, 'El fichero ya no existe.'));
    const incoming = P.refIndex().filter((r) => r.target && r.target.file === sel.path && r.file !== sel.path);
    const outgoing = P.refIndex().filter((r) => r.file === sel.path);
    const actions = sel.path === P.rootFile ? [h('span', { class: 'badge kind' }, 'Raíz')] : [
      btn('Eliminar fichero', async () => {
        if (incoming.length && !(await app.confirm({ title: 'Eliminar fichero', message: 'Otros ficheros lo referencian (' + incoming.length + '); quedarán referencias rotas.', details: incoming.slice(0, 20).map((r) => r.file + ' \u2192 ' + r.ref), confirmLabel: 'Eliminar igualmente', danger: true }))) return;
        if (!incoming.length && !(await app.confirm({ title: 'Eliminar fichero', message: 'Se quitará ' + sel.path + ' del proyecto (no se borra del disco hasta guardar).', confirmLabel: 'Eliminar', danger: true }))) return;
        app.edit('Eliminar fichero', (tx) => tx.removeFile(sel.path), { rerender: false }) && app.select({ kind: 'info' });
      }, 'danger-text', 'trash-2')];
    const yamlBox = h('div', { class: 'yaml-host' });
    return h('div', { class: 'page fill' }, header(h('span', { class: 'lead-icon' }, icon('file-code')), sel.path, incoming.length + ' referencia(s) entrantes · ' + outgoing.length + ' salientes', actions), yamlBox);
  };

  O.pages.helpers = { moveToFile, renameRoute, duplicateDialog };
})();
