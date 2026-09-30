/* Explorador lateral: operaciones, schemas, componentes y ficheros con búsqueda global. */
(function () {
  'use strict';
  const O = (window.OAT = window.OAT || {});
  const { h, icon, iconBtn, btn, showMenu, modal } = O.dom;
  const F = O.forms;
  const METHOD_ORDER = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];
  const COMP_TYPES = ['responses', 'parameters', 'requestBodies', 'headers', 'securitySchemes', 'examples', 'links', 'callbacks'];
  const CHUNK = 250;

  function create(app) {
    const el = h('aside', { class: 'sidebar', id: 'sidebar', 'aria-label': 'Explorador del contrato' });
    const state = { q: '', tab: 'ops', group: 'tag', collapsed: new Set(), limit: {}, };
    const search = h('input', { type: 'search', class: 'search', placeholder: 'Buscar ruta, operationId, tag, schema...', 'aria-label': 'Buscar en el contrato', id: 'global-search' });
    const tabsBar = h('div', { class: 'side-tabs', role: 'tablist' });
    const actionsBar = h('div', { class: 'side-actions' });
    const list = h('div', { class: 'side-list', role: 'tree', tabindex: -1 });
    el.append(h('div', { class: 'search-wrap' }, icon('search'), search), tabsBar, actionsBar, list);
    let t = null;
    search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { state.q = search.value.trim().toLowerCase(); state.limit = {}; render(); }, 120); });

    function match(...fields) {
      if (!state.q) return true;
      return fields.some((f) => f && String(f).toLowerCase().includes(state.q));
    }
    const isSel = (s) => { const c = app.sel; if (!c || c.kind !== s.kind) return false; return Object.keys(s).every((k) => c[k] === s[k]); };

    function item(sel, children, opts) {
      opts = opts || {};
      const b = h('div', { class: 'tree-item' + (isSel(sel) ? ' selected' : '') + (opts.cls ? ' ' + opts.cls : ''), role: 'treeitem', tabindex: 0, 'aria-selected': isSel(sel) ? 'true' : 'false', title: opts.title || '' }, children);
      b.addEventListener('click', () => { app.select(sel); app.closeSidebarOnMobile(); });
      b.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); app.select(sel); app.closeSidebarOnMobile(); }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const all = Array.from(list.querySelectorAll('.tree-item, .group-head')); const i = all.indexOf(b); const n = all[i + (e.key === 'ArrowDown' ? 1 : -1)]; if (n) n.focus(); }
      });
      if (opts.menu) b.addEventListener('contextmenu', (e) => { e.preventDefault(); showMenu({ x: e.clientX, y: e.clientY }, opts.menu()); });
      return b;
    }
    function groupHead(key, label, count, onSelect) {
      const open = !state.collapsed.has(key);
      const hd = h('div', { class: 'group-head', role: 'treeitem', tabindex: 0, 'aria-expanded': open ? 'true' : 'false' }, h('span', { class: 'chev' + (open ? ' open' : '') }, icon('chevron-right')), h('span', { class: 'group-name' }, label), h('span', { class: 'count' }, String(count)));
      const toggle = () => { if (open) state.collapsed.add(key); else state.collapsed.delete(key); render(); };
      hd.addEventListener('click', toggle);
      hd.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const all = Array.from(list.querySelectorAll('.tree-item, .group-head')); const n = all[all.indexOf(hd) + (e.key === 'ArrowDown' ? 1 : -1)]; if (n) n.focus(); } });
      return { head: hd, open };
    }
    function more(key, total, shown) {
      if (total <= shown) return null;
      return h('button', { type: 'button', class: 'more-btn', onclick: () => { state.limit[key] = (state.limit[key] || CHUNK) + CHUNK; render(); } }, 'Mostrar más (' + (total - shown) + ')');
    }

    /* ----- acciones contextuales ----- */
    const H = () => O.pages.helpers;
    function opMenu(route, method) {
      return () => [
        { label: 'Duplicar...', icon: 'copy', onClick: () => H().duplicateDialog(app, route, method) },
        { label: 'Renombrar ruta...', icon: 'pencil', onClick: () => H().renameRoute(app, route) },
        { separator: true },
        { label: 'Eliminar operación', icon: 'trash-2', danger: true, onClick: async () => { if (await app.confirm({ title: 'Eliminar operación', message: 'Se eliminará ' + method.toUpperCase() + ' ' + route + '.', confirmLabel: 'Eliminar', danger: true })) app.op(() => { O.ops.deleteOperation(app.project, route, method); if (app.sel.route === route) app.select({ kind: 'path', route }); }, { rerender: false }); } }
      ];
    }
    function compMenu(type, name) {
      return () => [
        { label: 'Abrir', icon: 'external-link', onClick: () => app.select({ kind: 'component', type, name }) },
        { label: 'Eliminar...', icon: 'trash-2', danger: true, onClick: () => O.pages.deleteComponent(app, type, name) }
      ];
    }

    /* ----- pestañas ----- */
    function renderTabs(counts) {
      tabsBar.textContent = '';
      [['ops', 'Operaciones', 'route'], ['schemas', 'Schemas', 'braces'], ['comps', 'Componentes', 'box'], ['files', 'Archivos', 'files']].forEach(([id, label, ic]) => {
        tabsBar.appendChild(h('button', { type: 'button', role: 'tab', class: 'side-tab' + (state.tab === id ? ' active' : ''), 'aria-selected': state.tab === id ? 'true' : 'false', title: label, 'aria-label': label, onclick: () => { state.tab = id; render(); } }, icon(ic), h('span', { class: 'lbl' }, label), h('span', { class: 'count' }, String(counts[id]))));
      });
    }
    function renderActions() {
      actionsBar.textContent = '';
      if (state.tab === 'ops') {
        actionsBar.append(btn('Nueva operación', () => newOperation(app), 'small primary', 'plus'),
          h('div', { class: 'seg', role: 'group', 'aria-label': 'Agrupar' }, ['tag', 'ruta'].map((g) => h('button', { type: 'button', class: state.group === g ? 'on' : '', onclick: () => { state.group = g; render(); } }, g === 'tag' ? 'Por tag' : 'Por ruta'))));
      } else if (state.tab === 'schemas') actionsBar.appendChild(btn('Nuevo schema', () => newSchema(app), 'small primary', 'plus'));
      else if (state.tab === 'comps') actionsBar.appendChild(btn('Nuevo componente', () => newComponent(app), 'small primary', 'plus'));
      else actionsBar.appendChild(btn('Nuevo fichero', () => newFile(app), 'small primary', 'plus'));
    }

    /* ----- listas ----- */
    function opsList(model) {
      const frag = document.createDocumentFragment();
      const rows = [];
      model.paths.forEach((p) => p.methods.forEach((m) => { if (match(p.path, m.operationId, m.summary, m.method, m.description, m.tags.join(' '), p.summary)) rows.push({ p, m }); }));
      if (state.group === 'ruta') {
        const paths = model.paths.filter((p) => rows.some((r) => r.p === p) || (!p.methods.length && match(p.path, p.summary)));
        let shown = 0; const max = state.limit.ops || CHUNK;
        for (const p of paths) {
          if (shown >= max) break;
          const g = groupHead('r:' + p.path, p.path, p.methods.length, null);
          const hd = g.head;
          hd.classList.add('route-head');
          hd.addEventListener('dblclick', () => app.select({ kind: 'path', route: p.path }));
          hd.appendChild(iconBtn('pencil', 'Abrir ruta ' + p.path, (e) => { e.stopPropagation(); app.select({ kind: 'path', route: p.path }); }, 'tiny'));
          frag.appendChild(hd); shown++;
          if (g.open) rows.filter((r) => r.p === p).forEach((r) => { frag.appendChild(opItem(r)); shown++; });
        }
        const mb = more('ops', paths.length, Math.min(paths.length, max)); if (mb) frag.appendChild(mb);
      } else {
        const declared = model.tags.map((t) => t && t.name).filter(Boolean);
        const byTag = new Map(declared.map((t) => [t, []])); const untagged = [];
        rows.forEach((r) => { if (!r.m.tags.length) untagged.push(r); else r.m.tags.forEach((t) => { if (!byTag.has(t)) byTag.set(t, []); byTag.get(t).push(r); }); });
        if (untagged.length) byTag.set('(sin tag)', untagged);
        let shown = 0; const max = state.limit.ops || CHUNK; let total = 0;
        for (const [tag, rs] of byTag) {
          if (!rs.length) continue;
          total += rs.length;
          if (shown >= max) continue;
          const g = groupHead('t:' + tag, tag, rs.length, null);
          frag.appendChild(g.head); shown++;
          if (g.open) rs.sort((a, b) => a.p.path.localeCompare(b.p.path) || METHOD_ORDER.indexOf(a.m.method) - METHOD_ORDER.indexOf(b.m.method)).forEach((r) => { if (shown < max) { frag.appendChild(opItem(r, tag)); shown++; } });
        }
        const mb = more('ops', total, Math.min(total, max)); if (mb) frag.appendChild(mb);
      }
      if (!frag.childNodes.length) frag.appendChild(h('p', { class: 'muted pad' }, state.q ? 'Sin resultados.' : 'Sin operaciones. Crea la primera con "Nueva operación".'));
      return frag;
    }
    function opItem(r) {
      const sel = { kind: 'operation', route: r.p.path, method: r.m.method };
      return item(sel, [F.methodBadge(r.m.method), h('span', { class: 'ti-main' }, h('span', { class: 'ti-route' + (r.m.deprecated ? ' deprecated' : '') }, r.p.path), r.m.summary ? h('span', { class: 'ti-sub' }, r.m.summary) : null)], { menu: opMenu(r.p.path, r.m.method), title: r.m.operationId || '' });
    }
    function compItems(model, type, key) {
      const items = (model.components[type] || []).filter((c) => match(c.name, c.description, c.type));
      const max = state.limit[key] || CHUNK;
      const frag = document.createDocumentFragment();
      items.slice(0, max).forEach((c) => frag.appendChild(item({ kind: 'component', type, name: c.name }, [h('span', { class: 'kind-dot k-' + type }), h('span', { class: 'ti-main' }, h('span', { class: 'ti-route' }, c.name), c.type || c.description ? h('span', { class: 'ti-sub' }, c.ref ? '\u2192 ' + c.ref : (c.type || '') + (c.description ? ' · ' + c.description : '')) : null)], { menu: compMenu(type, c.name) })));
      const mb = more(key, items.length, Math.min(max, items.length)); if (mb) frag.appendChild(mb);
      return { frag, count: items.length };
    }
    function schemasList(model) {
      const { frag, count } = compItems(model, 'schemas', 'schemas');
      if (!count) frag.appendChild(h('p', { class: 'muted pad' }, state.q ? 'Sin resultados.' : 'Sin schemas.'));
      return frag;
    }
    function compsList(model) {
      const frag = document.createDocumentFragment();
      let any = false;
      COMP_TYPES.forEach((type) => {
        const total = (model.components[type] || []).length;
        if (!total) return;
        const { frag: f, count } = compItems(model, type, 'c:' + type);
        if (!count) return;
        any = true;
        const g = groupHead('c:' + type, O.pages.TYPE_LABEL[type], count, null);
        frag.appendChild(g.head);
        if (g.open) frag.appendChild(f);
      });
      if (!any) frag.appendChild(h('p', { class: 'muted pad' }, state.q ? 'Sin resultados.' : 'Sin componentes adicionales.'));
      return frag;
    }
    function filesList(model) {
      const frag = document.createDocumentFragment();
      model.files.filter((f) => match(f.path)).forEach((f) => frag.appendChild(item({ kind: 'file', path: f.path }, [icon('file-code'), h('span', { class: 'ti-main' }, h('span', { class: 'ti-route' }, f.path)), f.isRoot ? h('span', { class: 'badge kind' }, 'raíz') : null, f.errors || f.draft ? h('span', { class: 'dot-err', title: 'Errores de sintaxis' }) : null])));
      return frag;
    }

    function render() {
      const model = app.project.getModel();
      const scroll = list.scrollTop;
      const counts = {
        ops: model.paths.reduce((n, p) => n + p.methods.filter((m) => match(p.path, m.operationId, m.summary, m.method, m.description, m.tags.join(' '), p.summary)).length, 0),
        schemas: (model.components.schemas || []).filter((c) => match(c.name, c.description, c.type)).length,
        comps: COMP_TYPES.reduce((n, t) => n + (model.components[t] || []).filter((c) => match(c.name)).length, 0),
        files: model.files.filter((f) => match(f.path)).length
      };
      renderTabs(counts);
      renderActions();
      list.textContent = '';
      list.appendChild(item({ kind: 'info' }, [icon('info'), h('span', { class: 'ti-main' }, h('span', { class: 'ti-route' }, 'Información del contrato'), h('span', { class: 'ti-sub' }, (model.info.title || '') + (model.info.version ? ' · v' + model.info.version : '')))], { cls: 'pinned' }));
      list.appendChild(state.tab === 'ops' ? opsList(model) : state.tab === 'schemas' ? schemasList(model) : state.tab === 'comps' ? compsList(model) : filesList(model));
      list.scrollTop = scroll;
    }

    return { el, refresh: render, focusSearch: () => { search.focus(); search.select(); }, setTab(tab) { state.tab = tab; render(); }, clearSearch() { search.value = ''; state.q = ''; } };
  }

  /* ---------- Diálogos de creación ---------- */
  function newOperation(app) {
    const P = app.project;
    const route = h('input', { type: 'text', placeholder: '/recursos/{id}', 'aria-label': 'Ruta', autofocus: true });
    const method = h('select', { 'aria-label': 'Método' }, METHOD_ORDER.map((m) => h('option', { value: m }, m.toUpperCase())));
    const tags = P.getModel().tags.map((t) => t && t.name).filter(Boolean);
    const tag = h('select', { 'aria-label': 'Tag' }, h('option', { value: '' }, '(sin tag)'), tags.map((t) => h('option', { value: t }, t)));
    if (app.sel && app.sel.kind === 'operation') { const cur = P.getModel().paths.find((p) => p.path === app.sel.route); const mm = cur && cur.methods.find((x) => x.method === app.sel.method); if (mm && mm.tags[0]) tag.value = mm.tags[0]; }
    const summary = h('input', { type: 'text', placeholder: 'Resumen', 'aria-label': 'Resumen' });
    const err = h('div', { class: 'field-error', role: 'alert' });
    const m = modal({ title: 'Nueva operación', content: h('div', { class: 'stack' }, F.grid(F.field('Ruta', route, 'Los {parámetros} se declaran automáticamente como obligatorios.'), F.field('Método', method), F.field('Tag', tag), F.field('Resumen', summary)), err), cancelValue: null, actions: [{ label: 'Cancelar', value: null }, { label: 'Crear', kind: 'primary', value: '__ok__', onClick: () => {
      let r = route.value.trim();
      if (r && !r.startsWith('/')) r = '/' + r;
      if (!r) { err.textContent = 'Indica la ruta'; return false; }
      const ex = P.read(['paths', r], true);
      if (ex && ex[method.value]) { err.textContent = r + ' ya tiene ' + method.value.toUpperCase(); return false; }
      route.value = r; return true;
    } }] });
    m.promise.then((v) => {
      if (v !== '__ok__') return;
      app.op(() => { O.ops.addOperation(P, route.value, method.value, { tags: tag.value ? [tag.value] : [], summary: summary.value.trim() || undefined }); app.select({ kind: 'operation', route: route.value, method: method.value }); }, { rerender: false, ok: 'Operación creada' });
    });
  }
  function newSchema(app) {
    const name = h('input', { type: 'text', placeholder: 'NombreDelSchema', 'aria-label': 'Nombre', autofocus: true });
    const kind = h('select', { 'aria-label': 'Tipo' }, h('option', { value: 'object' }, 'Objeto'), h('option', { value: 'array' }, 'Lista'), h('option', { value: 'string' }, 'Texto'), h('option', { value: 'enum' }, 'Enumeración'));
    const err = h('div', { class: 'field-error', role: 'alert' });
    const m = modal({ title: 'Nuevo schema', content: h('div', { class: 'stack' }, F.field('Nombre', name), F.field('Tipo', kind), err), cancelValue: null, actions: [{ label: 'Cancelar', value: null }, { label: 'Crear', kind: 'primary', value: '__ok__', onClick: () => {
      const v = name.value.trim();
      if (!/^[A-Za-z0-9._-]+$/.test(v)) { err.textContent = 'Solo letras, números, punto, guion y guion bajo'; return false; }
      if (app.project.getModel().components.schemas.some((c) => c.name === v)) { err.textContent = 'Ya existe un schema con ese nombre'; return false; }
      return true;
    } }] });
    m.promise.then((v) => { if (v === '__ok__') app.op(() => { O.ops.addSchema(app.project, name.value.trim(), kind.value); app.select({ kind: 'component', type: 'schemas', name: name.value.trim() }); }, { rerender: false, ok: 'Schema creado' }); });
  }
  function newComponent(app) {
    const type = h('select', { 'aria-label': 'Tipo de componente' }, COMP_TYPES.map((t) => h('option', { value: t }, O.pages.TYPE_LABEL[t])));
    const name = h('input', { type: 'text', placeholder: 'NombreDelComponente', 'aria-label': 'Nombre', autofocus: true });
    const err = h('div', { class: 'field-error', role: 'alert' });
    const defaults = { responses: { description: 'Descripción' }, parameters: { name: 'parámetro', in: 'query', schema: { type: 'string' } }, requestBodies: { content: { 'application/json': { schema: { type: 'object' } } } }, headers: { schema: { type: 'string' } }, securitySchemes: { type: 'apiKey', name: 'X-Api-Key', in: 'header' }, examples: { value: {} }, links: {}, callbacks: {} };
    const m = modal({ title: 'Nuevo componente', content: h('div', { class: 'stack' }, F.field('Tipo', type), F.field('Nombre', name), err), cancelValue: null, actions: [{ label: 'Cancelar', value: null }, { label: 'Crear', kind: 'primary', value: '__ok__', onClick: () => {
      const v = name.value.trim();
      if (!/^[A-Za-z0-9._-]+$/.test(v)) { err.textContent = 'Solo letras, números, punto, guion y guion bajo'; return false; }
      if ((app.project.getModel().components[type.value] || []).some((c) => c.name === v)) { err.textContent = 'Ya existe'; return false; }
      return true;
    } }] });
    m.promise.then((v) => { if (v === '__ok__') app.op(() => { O.ops.addComponent(app.project, type.value, name.value.trim(), defaults[type.value]); app.select({ kind: 'component', type: type.value, name: name.value.trim() }); }, { rerender: false, ok: 'Componente creado' }); });
  }
  async function newFile(app) {
    const v = await app.prompt({ title: 'Nuevo fichero', label: 'Ruta del fichero (relativa al proyecto)', placeholder: 'schemas/nuevo.yaml', validate: (x) => { if (!/\.(ya?ml|json)$/i.test(x)) return 'Usa la extensión .yaml o .yml'; try { O.fileio.safePath(x); } catch (e) { return e.message; } return app.project.files.has(x.replace(/\\/g, '/')) ? 'Ya existe ese fichero' : ''; } });
    if (v) { const p = O.util.normalizePath(v); if (app.edit('Nuevo fichero', (tx) => tx.addFile(p, '# Fragmento nuevo\n{}\n'), { rerender: false })) app.select({ kind: 'file', path: p }); }
  }

  O.explorer = { create };
})();
