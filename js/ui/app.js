/* Orquestación de la aplicación: estado, barra de herramientas, área principal, validación, apertura y guardado. */
(function () {
  'use strict';
  const O = (window.OAT = window.OAT || {});
  const { h, icon, iconBtn, btn, toast, showMenu, modal } = O.dom;
  const { Project } = O.project;

  const SETTINGS_KEY = 'oat.settings.v1';
  const DEFAULTS = { liveValidation: true, opIdUnique: 'error', opIdRequired: false, singleTag: false, tagsMustExist: true, recovery: false, theme: 'system' };
  function loadSettings() { try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch (e) { return Object.assign({}, DEFAULTS); } }

  const app = (O.app = {
    project: null, sel: { kind: 'info' }, mode: 'edit', view: 'form', tabMemory: {}, folder: null, yamlFile: null,
    settings: loadSettings(), busyCount: 0, panelOpen: window.innerWidth > 900, validation: { result: null, running: false }, cmp: null
  });
  const $ = (id) => document.getElementById(id);
  const isNarrow = () => window.innerWidth < 900;

  app.toast = toast;
  app.confirm = O.dom.confirmDialog;
  app.prompt = O.dom.promptDialog;
  function applyTheme(theme) {
    const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }
  applyTheme(app.settings.theme);
  const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  systemThemeQuery.addEventListener('change', () => { if (app.settings.theme === 'system') applyTheme('system'); });
  app.setSetting = function (k, v) {
    app.settings[k] = v;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(app.settings)); } catch (e) { /* opcional */ }
    if (k === 'theme') applyTheme(v);
    if (k === 'recovery' && !v) O.fileio.clearRecovery();
  };
  app.toggleTheme = function () {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    app.setSetting('theme', next);
    renderToolbar();
  };
  app.validationConfig = () => ({ opIdUnique: app.settings.opIdUnique, opIdRequired: app.settings.opIdRequired, singleTag: app.settings.singleTag, tagsMustExist: app.settings.tagsMustExist });

  /* ---------- Actividad ---------- */
  app.busy = function (on) { app.busyCount = Math.max(0, app.busyCount + (on ? 1 : -1)); document.body.classList.toggle('busy', app.busyCount > 0); };

  /* ---------- Edición ---------- */
  app.edit = function (label, fn, opts) {
    opts = opts || {};
    let ok = true;
    try { app.project.mutate(label, fn, { coalesce: opts.coalesce }); } catch (e) { toast(e.message, 'error'); ok = false; }
    if (opts.after) opts.after();
    if (ok && opts.rerender) app.rerender();
    return ok;
  };
  app.op = function (fn, opts) {
    opts = opts || {};
    let ok = true;
    try { fn(); if (opts.ok) toast(opts.ok, 'ok'); } catch (e) { toast(e.message, 'error'); ok = false; }
    if (opts.after) opts.after();
    if (ok && opts.rerender !== false && !opts.after) app.rerender();
    return ok;
  };
  app.selectSilently = function (fn) { app.sel = fn(app.sel); };

  /* ---------- Localización ---------- */
  app.selectionLocation = function () {
    const P = app.project; const s = app.sel;
    let logical = null;
    if (s.kind === 'file') return { file: s.path, path: [] };
    if (s.kind === 'operation') logical = ['paths', s.route, s.method];
    else if (s.kind === 'path') logical = ['paths', s.route];
    else if (s.kind === 'component') logical = ['components', s.type, s.name];
    else logical = ['info'];
    const p = P.phys(logical, s.kind === 'component' || s.kind === 'path');
    return p.error ? { file: P.rootFile, path: [] } : { file: p.file, path: p.path };
  };
  app.showYamlFor = function (logical) {
    const p = app.project.phys(logical, true);
    if (p.error) return;
    app.view = isNarrow() ? 'yaml' : 'split';
    renderMain();
    const loc = app.project.locate(p.file, p.path);
    app.yaml.show(p.file, loc.line, loc.col);
  };
  app.selectByLogical = function (logical, o) {
    o = o || {};
    let sel = { kind: 'info' };
    if (logical[0] === 'paths' && logical.length >= 2) sel = logical.length >= 3 && O.util.HTTP_METHODS.includes(String(logical[2])) ? { kind: 'operation', route: String(logical[1]), method: String(logical[2]) } : { kind: 'path', route: String(logical[1]) };
    else if (logical[0] === 'components' && logical.length >= 3) sel = { kind: 'component', type: String(logical[1]), name: String(logical[2]) };
    app.select(sel, { keepView: o.keepYaml });
  };
  app.goLocation = function (file, yamlPath, logical) {
    if (logical) app.selectByLogical(logical); else app.select({ kind: 'file', path: file });
  };
  app.gotoDiagnostic = function (d, mode) {
    const P = app.project;
    let logical = d.jsPath && (d.jsPath[0] === 'paths' || d.jsPath[0] === 'components') ? d.jsPath : (d.file ? P.toLogical(d.file, d.path || []) : null);
    if (mode === 'form') {
      app.view = 'form';
      if (logical) app.selectByLogical(logical); else if (d.file) app.select({ kind: 'file', path: d.file }); else app.select({ kind: 'info' });
      return;
    }
    if (logical) app.selectByLogical(logical, { keepYaml: true });
    app.view = isNarrow() ? 'yaml' : 'split';
    renderAll();
    if (d.file && P.file(d.file)) app.yaml.show(d.file, d.line, d.col);
  };

  app.select = function (sel, o) {
    o = o || {};
    if (app.mode !== 'edit') { app.mode = 'edit'; updateMode(); $('compare-slot').style.display = 'none'; }
    if (sel.kind === 'file') { if (app.sel.kind !== 'file') app.viewBeforeFile = app.view; app.view = 'yaml'; }
    else if (app.sel.kind === 'file') app.view = app.viewBeforeFile || 'form';
    app.sel = sel;
    renderAll();
    if (app.view !== 'form') syncYamlToSelection();
  };
  function syncYamlToSelection() {
    const loc = app.selectionLocation();
    const line = app.sel.kind === 'file' ? 0 : app.project.locate(loc.file, loc.path).line;
    app.yaml.show(loc.file, line, 1);
  }
  app.closeSidebarOnMobile = function () { if (isNarrow()) document.body.classList.remove('sidebar-open'); };
  app.togglePanel = function () { app.panelOpen = !app.panelOpen; app.validationPanel.setCollapsed(!app.panelOpen); document.body.classList.toggle('panel-collapsed', !app.panelOpen); };

  /* ---------- Render ---------- */
  function renderAll() { app.explorer.refresh(); renderMain(); renderToolbar(); }
  app.rerender = function () { renderMain(); };

  function renderMain() {
    const main = $('main-body');
    const head = $('main-head');
    if (app.mode === 'compare') { head.textContent = ''; head.style.display = 'none'; return; }
    head.style.display = '';
    const oldScroll = main.querySelector('.form-pane') ? main.querySelector('.form-pane').scrollTop : 0;
    head.textContent = '';
    const views = [['form', 'Formulario', 'panel-left'], ['yaml', 'YAML', 'file-code']].concat(isNarrow() ? [] : [['split', 'Dividida', 'layers']]);
    if (app.sel.kind === 'file') { head.appendChild(h('div', { class: 'crumbs' }, h('span', { class: 'muted' }, 'Fichero'))); }
    else head.appendChild(h('div', { class: 'seg view-seg', role: 'tablist', 'aria-label': 'Vista' }, views.map(([id, label, ic]) => h('button', { type: 'button', role: 'tab', class: app.view === id ? 'on' : '', 'aria-selected': app.view === id ? 'true' : 'false', onclick: () => { app.view = id; renderMain(); if (id !== 'form') syncYamlToSelection(); } }, icon(ic), h('span', null, label)))));
    main.textContent = '';
    main.className = 'main-body view-' + (app.sel.kind === 'file' ? 'yaml' : app.view);
    const wantForm = app.sel.kind !== 'file' && (app.view === 'form' || app.view === 'split');
    const wantYaml = app.sel.kind === 'file' || app.view === 'yaml' || app.view === 'split';
    if (wantForm) {
      const pane = h('div', { class: 'form-pane' });
      try { pane.appendChild(O.pages[app.sel.kind](app, app.sel)); }
      catch (e) { console.error(e); pane.appendChild(h('div', { class: 'callout error' }, icon('alert-circle'), h('span', null, 'No se pudo mostrar este elemento: ' + e.message))); }
      main.appendChild(pane);
      pane.scrollTop = oldScroll;
    }
    if (wantYaml) {
      if (app.sel.kind === 'file') {
        const page = O.pages.file(app, app.sel);
        const host = page.querySelector('.yaml-host');
        if (host) host.appendChild(app.yaml.el); else page.appendChild(app.yaml.el);
        main.appendChild(page);
      } else main.appendChild(h('div', { class: 'yaml-pane' }, app.yaml.el));
    }
    if (!wantYaml && app.yaml.el.parentNode) app.yaml.el.remove();
  }

  /* ---------- Barra de herramientas ---------- */
  function renderToolbar() {
    const P = app.project;
    const bar = $('toolbar');
    bar.textContent = '';
    const dirty = P.isDirty();
    const name = h('button', { type: 'button', class: 'proj-name', title: 'Cambiar el nombre del proyecto', onclick: async () => { const v = await app.prompt({ title: 'Nombre del proyecto', label: 'Nombre', value: P.name }); if (v) { P.name = v; renderToolbar(); } } }, P.name || 'contrato');
    const status = h('span', { class: 'status ' + (dirty ? 'dirty' : 'clean'), role: 'status' }, h('span', { class: 'dot' }), h('span', { class: 'lbl' }, dirty ? 'Cambios sin guardar' : 'Guardado'));
    const res = app.validation.result;
    const errCount = res ? res.stats.errors : 0; const warnCount = res ? res.stats.warnings : 0;
    const val = iconBtn('shield-check', 'Validar contrato' + (res ? ' (' + errCount + ' errores, ' + warnCount + ' avisos)' : ''), () => { app.validate(true); if (!app.panelOpen) app.togglePanel(); }, 'val-btn' + (errCount ? ' has-err' : ''));
    if (res && (errCount || warnCount)) val.appendChild(h('span', { class: 'count-badge ' + (errCount ? 'err' : 'warn') }, String(errCount || warnCount)));
    const dark = document.documentElement.dataset.theme === 'dark';
    const themeToggle = iconBtn(dark ? 'sun' : 'moon', dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro', () => app.toggleTheme(), 'theme-toggle');
    bar.append(
      iconBtn('panel-left', 'Mostrar u ocultar el explorador', () => document.body.classList.toggle('sidebar-open'), 'only-narrow'),
      h('div', { class: 'brand' }, h('img', { src: 'assets/logo.svg', alt: '', width: 26, height: 26 }), h('span', { class: 'brand-name' }, 'OpenAPI')),
      h('div', { class: 'proj' }, name, P.isExample ? h('span', { class: 'badge example', title: 'Contrato de ejemplo ficticio' }, 'Ejemplo') : null, status),
      h('span', { class: 'spacer' }),
      h('div', { class: 'tool-group' },
        iconBtn('file-plus', 'Nuevo contrato', (e) => showMenu(e.currentTarget, [{ label: 'Contrato vacío', icon: 'file-plus', onClick: () => guarded(() => app.loadProject(Project.newEmpty(), {})) }, { separator: true }, { header: 'Ejemplos' }].concat(Object.keys(O.EXAMPLES).map((k) => ({ label: O.EXAMPLES[k].title, icon: 'archive', onClick: () => guarded(() => openExample(k)) }))))),
        iconBtn('folder-open', 'Abrir contrato', (e) => openMenu(e.currentTarget)),
        iconBtn('save', 'Guardar contrato', () => O.saveUI.open(app), 'primary-soft')),
      h('div', { class: 'tool-group' }, iconBtn('undo-2', 'Deshacer', () => doUndo(), '', { disabled: !P.canUndo() }), iconBtn('redo-2', 'Rehacer', () => doRedo(), '', { disabled: !P.canRedo() })),
      h('div', { class: 'tool-group' }, val,
        iconBtn('git-compare', 'Comparar contratos', () => app.setMode(app.mode === 'compare' ? 'edit' : 'compare'), app.mode === 'compare' ? 'active' : ''),
        themeToggle,
        iconBtn('settings', 'Ajustes', () => settingsDialog())));
    document.title = (P.name || 'contrato') + (dirty ? ' \u2022' : '') + ' \u2014 Editor OpenAPI';
  }
  function doUndo() { if (app.yaml) app.yaml.flush(); const l = app.project.undo(); if (l) { toast('Deshecho: ' + l, 'info', 1800); renderAll(); } }
  function doRedo() { const l = app.project.redo(); if (l) { toast('Rehecho: ' + l, 'info', 1800); renderAll(); } }
  app.undo = doUndo; app.redo = doRedo;

  app.setMode = function (m) {
    app.mode = m; updateMode();
    if (m === 'compare') { document.body.classList.remove('sidebar-open'); $('compare-slot').style.display = ''; app.compareView.refresh(); }
    else { $('compare-slot').style.display = 'none'; renderAll(); if (app.view !== 'form') syncYamlToSelection(); }
    renderToolbar();
  };
  function updateMode() { document.body.classList.toggle('mode-compare', app.mode === 'compare'); }

  /* ---------- Cambios en el proyecto ---------- */
  let rafSidebar = 0; let valTimer = null; let recTimer = null;
  function onProjectChanged() {
    if (!rafSidebar) rafSidebar = requestAnimationFrame(() => { rafSidebar = 0; if (app.mode === 'edit') app.explorer.refresh(); renderToolbar(); });
    if (app.yaml && app.mode === 'edit' && app.view !== 'form') app.yaml.sync();
    else if (app.yaml && app.sel.kind === 'file') app.yaml.sync();
    if (app.settings.liveValidation) { clearTimeout(valTimer); valTimer = setTimeout(() => app.validate(), 500); if (app.validationPanel) app.validationPanel.markStale(); }
    else if (app.validationPanel) app.validationPanel.markStale();
    if (app.settings.recovery) { clearTimeout(recTimer); recTimer = setTimeout(() => { if (app.project.isDirty()) O.fileio.saveRecovery(app.project); }, 2500); }
  }

  /* ---------- Validación ---------- */
  app.validate = function (manual) {
    if (app.validation.running && !manual) return;
    const P = app.project; const v = P.version;
    app.validation.running = true; app.validationPanel.update(null, true); app.busy(true);
    setTimeout(() => {
      try {
        if (app.yaml) app.yaml.flush();
        const r = O.validate.validateProject(P, app.validationConfig());
        if (app.project === P) { app.validation.result = r; r.stale = P.version !== v; }
      } catch (e) { console.error(e); toast('Error al validar: ' + e.message, 'error'); }
      app.validation.running = false; app.busy(false);
      app.validationPanel.update(app.validation.result, false);
      renderToolbar();
      if (P.version !== v && app.settings.liveValidation) { clearTimeout(valTimer); valTimer = setTimeout(() => app.validate(), 200); }
    }, 30);
  };

  /* ---------- Apertura de proyectos ---------- */
  app.loadProject = function (project, o) {
    o = o || {};
    if (app.unsubscribe) app.unsubscribe();
    app.project = project;
    if (o.saved) project.markSaved();
    app.folder = o.folder || null;
    project.isExample = !!o.example;
    app.unsubscribe = project.onChange(onProjectChanged);
    app.sel = { kind: 'info' }; app.tabMemory = {}; app.view = 'form'; app.yamlFile = null;
    app.validation.result = null;
    if (app.explorer) { app.explorer.clearSearch(); app.explorer.setTab('ops'); }
    if (app.yaml) app.yaml.show(project.rootFile);
    if (app.mode !== 'edit') app.setMode('edit'); else renderAll();
    app.validate(true);
    if (o.folder && o.folder.handle) O.fileio.addRecent(o.folder.handle, project.rootFile, project.name);
  };
  function openExample(key) {
    const ex = O.EXAMPLES[key];
    app.loadProject(Project.fromFiles(ex.files, ex.root, key === 'fragmentado' ? 'API de Tienda (ejemplo)' : ex.title.replace(/^Ejemplo: /, '')), { example: true });
  }
  app.chooseRoot = async function (files) {
    let cands = O.fileio.detectRoots(files);
    if (cands.length === 1) return cands[0];
    const all = Array.from(files.keys()).sort();
    if (!cands.length) cands = all;
    if (!cands.length) return null;
    const radios = cands.map((p, i) => h('label', { class: 'radio-row' }, h('input', { type: 'radio', name: 'root', value: p, checked: i === 0 }), h('span', null, p)));
    const m = modal({ title: 'Elige el fichero raíz', content: h('div', { class: 'stack' }, h('p', null, cands.length > 1 ? 'Se han encontrado varios ficheros que parecen contratos raíz. Las referencias relativas se resolverán desde su carpeta y solo dentro de la carpeta abierta.' : 'No se detectó ningún fichero con "openapi:"; elige el fichero raíz.'), h('div', { class: 'radio-list' }, radios)), cancelValue: null, actions: [{ label: 'Cancelar', value: null }, { label: 'Abrir', kind: 'primary', value: '__ok__' }] });
    const r = await m.promise;
    if (r !== '__ok__') return null;
    const c = radios.map((l) => l.querySelector('input')).find((i) => i.checked);
    return c ? c.value : null;
  };
  async function openFromResult(r) {
    if (!r) return;
    if (!r.files.size) { toast('No se encontraron ficheros .yaml, .yml o .json', 'error'); return; }
    const root = await app.chooseRoot(r.files);
    if (!root) return;
    const proj = Project.fromFiles(r.files, root, r.folderName || O.util.basename(root).replace(/\.(ya?ml|json)$/i, ''));
    const folder = r.handle ? { handle: r.handle, name: r.folderName } : null;
    app.loadProject(proj, { folder, saved: true });
    if (r.skipped && r.skipped.length) toast('Se omitieron ' + r.skipped.length + ' fichero(s) demasiado grandes', 'info');
    if (!folder) toast('Este navegador no permite escribir en carpetas: al guardar se descargará un ZIP.', 'info', 5000);
  }
  async function openFolderFlow() {
    app.busy(true);
    try { await openFromResult(await O.fileio.openFolder()); } catch (e) { toast('No se pudo abrir la carpeta: ' + e.message, 'error'); } finally { app.busy(false); }
  }
  async function openFilesFlow() {
    app.busy(true);
    try { await openFromResult(await O.fileio.openLooseFiles()); } catch (e) { toast('No se pudieron abrir los ficheros: ' + e.message, 'error'); } finally { app.busy(false); }
  }
  async function openMenu(anchor) {
    const items = [
      { label: O.fileio.hasFsAccess ? 'Abrir carpeta del contrato...' : 'Abrir carpeta (solo lectura)...', icon: 'folder-open', onClick: () => guarded(openFolderFlow) },
      { label: 'Abrir fichero(s) YAML...', icon: 'file-up', onClick: () => guarded(openFilesFlow) }
    ];
    const recents = O.fileio.hasFsAccess ? await O.fileio.listRecents() : [];
    if (recents.length) {
      items.push({ separator: true }, { header: 'Recientes' });
      for (const rec of recents) {
        const perm = await O.fileio.recentPermission(rec);
        items.push({ label: rec.name, icon: 'history', hint: perm === 'granted' ? '' : 'pide permiso', onClick: () => guarded(async () => { app.busy(true); try { const r = await O.fileio.openRecent(rec); await openFromResult(Object.assign(r, { folderName: rec.handle.name })); } catch (e) { toast(e.message, 'error'); } finally { app.busy(false); } }) });
      }
    }
    items.push({ separator: true }, { header: 'Ejemplos' });
    Object.keys(O.EXAMPLES).forEach((k) => items.push({ label: O.EXAMPLES[k].title, icon: 'archive', onClick: () => guarded(() => openExample(k)) }));
    showMenu(anchor, items);
  }
  /** Ejecuta la acción tras confirmar qué hacer con los cambios sin guardar. */
  async function guarded(action) {
    if (app.yaml) app.yaml.flush();
    if (!app.project.isDirty()) return action();
    const m = modal({ title: 'Cambios sin guardar', content: h('p', null, 'El contrato "' + app.project.name + '" tiene cambios sin guardar. Si continúas, se perderán (esta operación no se puede deshacer).'), cancelValue: 'cancel', actions: [{ label: 'Cancelar', value: 'cancel' }, { label: 'Guardar...', value: 'save' }, { label: 'Descartar cambios', kind: 'danger', value: 'discard' }] });
    const r = await m.promise;
    if (r === 'discard') return action();
    if (r === 'save') { await O.saveUI.open(app); if (!app.project.isDirty()) return action(); }
    return undefined;
  }
  app.guarded = guarded;

  /* ---------- Ajustes ---------- */
  function settingsDialog() {
    const S = app.settings;
    const chk = (key, label) => { const i = h('input', { type: 'checkbox', checked: !!S[key] }); i.addEventListener('change', () => { app.setSetting(key, i.checked); if (key === 'liveValidation') app.validationPanel.update(app.validation.result, false); else app.validate(true); }); return h('label', { class: 'check' }, i, h('span', null, label)); };
    const sel = (key, label, opts) => { const s = h('select', { 'aria-label': label }, opts.map(([v, l]) => h('option', { value: v }, l))); s.value = S[key]; s.addEventListener('change', () => { app.setSetting(key, s.value); app.validate(true); }); return O.forms.field(label, s); };
    const rec = h('input', { type: 'checkbox', checked: !!S.recovery });
    rec.addEventListener('change', () => { app.setSetting('recovery', rec.checked); if (rec.checked && app.project.isDirty()) O.fileio.saveRecovery(app.project); });
    modal({ title: 'Ajustes', content: h('div', { class: 'stack' },
      O.forms.section('Validación'), chk('liveValidation', 'Validar automáticamente al editar (desactívalo en contratos muy grandes)'),
      sel('opIdUnique', 'operationId duplicado', [['error', 'Error'], ['warning', 'Aviso'], ['off', 'No comprobar']]), chk('opIdRequired', 'operationId obligatorio en todas las operaciones'), chk('singleTag', 'Exigir exactamente un tag por operación'), chk('tagsMustExist', 'Avisar de tags no declarados'),
      O.forms.section('Recuperación local'), h('label', { class: 'check' }, rec, h('span', null, 'Guardar una copia de recuperación del contrato con cambios en este navegador (almacenamiento local, solo si lo activas)')),
      btn('Borrar copia de recuperación', () => { O.fileio.clearRecovery(); toast('Copia de recuperación borrada', 'ok'); }, 'small', 'trash-2'),
      O.forms.section('Apariencia'), sel('theme', 'Tema', [['system', 'Sistema'], ['light', 'Claro'], ['dark', 'Oscuro']]),
      O.forms.section('Entorno'), h('p', { class: 'muted' }, 'Idioma: español. Referencias remotas (http/https): siempre deshabilitadas; la herramienta no realiza llamadas de red.'),
      h('p', { class: 'muted' }, O.fileio.hasFsAccess ? 'Escritura en carpetas: disponible (File System Access).' : 'Escritura en carpetas: no disponible en este navegador; se descarga un ZIP.')),
    cancelValue: null, actions: [{ label: 'Cerrar', kind: 'primary', value: null }] });
  }

  /* ---------- Atajos y protección ---------- */
  document.addEventListener('keydown', (e) => {
    const t = e.target; const inText = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (app.mode === 'edit') O.saveUI.open(app); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (app.mode === 'edit') { document.body.classList.add('sidebar-open'); app.explorer.focusSearch(); } }
    else if ((e.ctrlKey || e.metaKey) && !inText && e.key.toLowerCase() === 'z' && !e.shiftKey && app.mode === 'edit') { e.preventDefault(); doUndo(); }
    else if ((e.ctrlKey || e.metaKey) && !inText && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) && app.mode === 'edit') { e.preventDefault(); doRedo(); }
  });
  window.addEventListener('beforeunload', (e) => { if (app.project && (app.project.isDirty())) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('resize', () => { if (app.mode === 'edit' && isNarrow() && app.view === 'split') { app.view = 'form'; renderMain(); } });

  /* ---------- Arranque ---------- */
  app.start = function () {
    app.explorer = O.explorer.create(app);
    app.yaml = O.yamlEditor.create(app);
    app.validationPanel = O.validationPanel.create(app);
    app.compareView = O.compareView.create(app);
    $('sidebar-slot').appendChild(app.explorer.el);
    $('validation-slot').appendChild(app.validationPanel.el);
    $('compare-slot').appendChild(app.compareView.el);
    $('compare-slot').style.display = 'none';
    $('scrim').addEventListener('click', () => document.body.classList.remove('sidebar-open'));
    app.validationPanel.setCollapsed(!app.panelOpen); document.body.classList.toggle('panel-collapsed', !app.panelOpen);
    app.loadProject(Project.fromFiles(O.EXAMPLES.fragmentado.files, 'openapi.yaml', 'API de Tienda (ejemplo)'), { example: true });
    const rec = app.settings.recovery ? O.fileio.loadRecovery() : null;
    if (rec && rec.files) {
      app.confirm({ title: 'Recuperar sesión anterior', message: 'Hay una copia de recuperación de "' + rec.name + '" guardada el ' + new Date(rec.ts).toLocaleString('es-ES') + '. ¿Quieres recuperarla?', confirmLabel: 'Recuperar', cancelLabel: 'Ignorar' }).then((ok) => { if (ok) { const p = Project.fromFiles(rec.files, rec.root, rec.name); app.loadProject(p, {}); } });
    }
  };
})();
