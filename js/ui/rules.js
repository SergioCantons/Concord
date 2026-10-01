/* Reglas de validación: catálogo de serie, conjuntos Spectral del contrato, biblioteca del navegador,
 * asistente para nuevas reglas y editor YAML. Se guarda todo en .concord/ (ver ruleconfig.js). */
(function () {
  'use strict';
  const O = (window.OAT = window.OAT || {});
  const { h, icon, iconBtn, btn, modal, showMenu, toast } = O.dom;
  const F = () => O.forms;
  const YAML = () => O.vendor && O.vendor.YAML;

  const LIB_KEY = 'oat.rulesets.library.v1';
  const SEV_OPTIONS = [['error', 'Error'], ['warning', 'Aviso'], ['info', 'Info'], ['off', 'Desactivada']];
  const SPECTRAL_SEV = [['error', 'Error'], ['warn', 'Aviso'], ['info', 'Info']];

  const PRESETS = [
    { id: 'operations', label: 'Operaciones', given: '$.paths[*][get,put,post,delete,options,head,patch,trace]', fields: ['operationId', 'summary', 'description', 'tags', 'deprecated'] },
    { id: 'parameters', label: 'Parámetros', given: ['$.paths[*][*].parameters[*]', '$.components.parameters[*]'], fields: ['name', 'in', 'description', 'required', 'schema', 'example'] },
    { id: 'properties', label: 'Propiedades de objetos', given: '$..properties[*]', fields: ['type', 'description', 'example', 'format'] },
    { id: 'strings', label: 'Esquemas de texto', given: "$..[?(@ && @.type == 'string')]", fields: ['format', 'pattern', 'maxLength', 'minLength', 'example'] },
    { id: 'numbers', label: 'Esquemas numéricos', given: "$..[?(@ && (@.type == 'integer' || @.type == 'number'))]", fields: ['format', 'minimum', 'maximum', 'example'] },
    { id: 'arrays', label: 'Listas', given: "$..[?(@ && @.type == 'array')]", fields: ['items', 'maxItems', 'minItems', 'uniqueItems'] },
    { id: 'responses', label: 'Respuestas', given: '$.paths[*][*].responses[*]', fields: ['description', 'headers', 'content'] },
    { id: 'bodies', label: 'Cuerpos (content)', given: '$.paths[*][*]..content[*]', fields: ['schema', 'examples', 'example'] },
    { id: 'info', label: 'Info del contrato', given: '$.info', fields: ['title', 'version', 'description', 'contact', 'license', 'termsOfService'] },
    { id: 'custom', label: 'Personalizado (JSONPath)', given: '', fields: [] }
  ];
  const FUNCTIONS = [
    { id: 'defined', label: 'Existe', fn: 'defined' },
    { id: 'undefined', label: 'No existe', fn: 'undefined' },
    { id: 'truthy', label: 'Tiene valor', fn: 'truthy' },
    { id: 'falsy', label: 'Está vacío o es falso', fn: 'falsy' },
    { id: 'pattern-match', label: 'Coincide con patrón', fn: 'pattern' },
    { id: 'pattern-notmatch', label: 'No coincide con patrón', fn: 'pattern' },
    { id: 'enumeration', label: 'Es uno de', fn: 'enumeration' },
    { id: 'length', label: 'Longitud entre', fn: 'length' },
    { id: 'casing', label: 'Convención de nombres', fn: 'casing' },
    { id: 'schema', label: 'Esquema JSON', fn: 'schema' }
  ];
  const CASING_TYPES = [['flat', 'flat (minúsculas seguidas)'], ['camel', 'camelCase'], ['pascal', 'PascalCase'], ['kebab', 'kebab-case'], ['cobol', 'COBOL-CASE'], ['snake', 'snake_case'], ['macro', 'MACRO_CASE']];

  /* ---------- Persistencia de la configuración ---------- */
  function updateConfig(app, mutator) {
    const cfg = O.ruleconfig.readConfig(app.project);
    if (!cfg.exists) cfg.rules = O.validate.legacyRules(app.settings);
    mutator(cfg);
    O.ruleconfig.writeConfig(app.project, cfg);
  }

  /* ---------- Biblioteca (localStorage del navegador) ---------- */
  function libRead() { try { const v = JSON.parse(localStorage.getItem(LIB_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function libWrite(list) { try { localStorage.setItem(LIB_KEY, JSON.stringify(list)); } catch (e) { /* opcional */ } }
  function libUpsert(name, text) {
    const list = libRead();
    const i = list.findIndex((x) => x && x.name === name);
    const entry = { name, text, ts: Date.now() };
    if (i >= 0) list[i] = entry; else list.push(entry);
    list.sort((a, b) => a.name.localeCompare(b.name));
    libWrite(list);
  }
  function libDelete(name) { libWrite(libRead().filter((x) => x && x.name !== name)); }

  /* ---------- Diálogo principal ---------- */
  function open(app, opts) {
    opts = opts || {};
    const state = { tab: opts.tab === 'rulesets' ? 'rulesets' : 'builtin' };
    const defs = [{ id: 'builtin', label: 'De serie' }, { id: 'rulesets', label: 'Conjuntos de reglas' }];
    const tabsBar = h('div', { class: 'tabs small rules-tabs', role: 'tablist', 'aria-label': 'Reglas de validación' });
    const tabBody = h('div', { class: 'rules-body' });

    function activate(id) {
      state.tab = id;
      Array.from(tabsBar.children).forEach((b) => {
        const on = b.dataset.id === id;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
      });
      renderTab();
    }
    defs.forEach((d) => {
      const b = h('button', { type: 'button', role: 'tab', class: 'tab', dataset: { id: d.id }, onclick: () => activate(d.id) }, d.label);
      tabsBar.appendChild(b);
    });
    tabsBar.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const i = defs.findIndex((d) => d.id === state.tab);
      const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + defs.length) % defs.length;
      activate(defs[j].id); tabsBar.children[j].focus(); e.preventDefault();
    });

    function renderTab() {
      const scroll = tabBody.scrollTop;
      const openIds = Array.from(tabBody.querySelectorAll('details[open]')).map((d) => d.dataset.foldId).filter(Boolean);
      tabBody.textContent = '';
      const el = state.tab === 'builtin' ? renderBuiltinTab(app, renderTab) : renderRulesetsTab(app, renderTab, state);
      tabBody.appendChild(el);
      openIds.forEach((id) => { const d = tabBody.querySelector('details[data-fold-id="' + CSS.escape(id) + '"]'); if (d) d.open = true; });
      tabBody.scrollTop = scroll;
    }

    activate(state.tab);
    const foot = h('p', { class: 'muted rules-foot' }, 'Los cambios se guardan con el contrato en la carpeta .concord/ al pulsar Guardar.');
    const content = h('div', { class: 'stack rules-dialog' }, tabsBar, tabBody, foot);
    return modal({ title: 'Reglas de validación', wide: true, content, cancelValue: null, actions: [{ label: 'Cerrar', kind: 'primary', value: null }] }).promise;
  }

  /* ---------- Pestaña «De serie» ---------- */
  function renderBuiltinTab(app, rerender) {
    const wrap = h('div', { class: 'stack rules-builtin' });
    const rules = O.validate.BUILTIN_RULES;
    const cfg = app.validationConfig();
    const overrides = cfg.rules || {};
    const changed = rules.some((r) => !r.locked && overrides[r.id] && overrides[r.id] !== r.severity);
    wrap.appendChild(h('div', { class: 'row wrap rules-top' },
      h('span', { class: 'muted grow' }, rules.length + ' reglas integradas'),
      btn('Restablecer valores por defecto', () => {
        updateConfig(app, (c) => { c.rules = {}; });
        rerender(); toast('Severidades por defecto restablecidas', 'ok');
      }, 'small', 'refresh-cw', { disabled: !changed })
    ));

    const byCat = new Map();
    for (const r of rules) { if (!byCat.has(r.category)) byCat.set(r.category, []); byCat.get(r.category).push(r); }
    for (const [cat, list] of byCat) {
      wrap.appendChild(h('h4', { class: 'rules-cat' }, cat));
      for (const r of list) {
        const eff = O.validate.effectiveSeverity(r, overrides);
        const sel = h('select', { 'aria-label': 'Severidad de ' + r.title, disabled: !!r.locked, class: 'rules-sev' },
          SEV_OPTIONS.map(([v, l]) => h('option', { value: v }, l)));
        sel.value = eff;
        sel.addEventListener('change', () => {
          updateConfig(app, (c) => { c.rules[r.id] = sel.value; });
          rerender();
        });
        const details = r.example ? h('details', { class: 'rules-example', 'data-fold-id': 'builtin:' + r.id },
          h('summary', null, 'Ver ejemplo'),
          h('div', { class: 'rules-example-body' },
            r.example.valid ? h('div', null, h('span', { class: 'muted' }, 'Válido:'), h('pre', { class: 'code-block' }, r.example.valid)) : null,
            r.example.invalid ? h('div', null, h('span', { class: 'muted' }, 'No válido:'), h('pre', { class: 'code-block' }, r.example.invalid)) : null)) : null;
        wrap.appendChild(h('div', { class: 'rule-row' + (r.locked ? ' locked' : '') },
          h('div', { class: 'rule-main' },
            h('div', { class: 'rule-head' },
              h('strong', null, r.title),
              h('code', { class: 'muted rule-id' }, r.id),
              r.locked ? h('span', { class: 'badge', title: 'No se puede desactivar' }, icon('lock'), h('span', null, 'Siempre activa')) : null),
            h('p', { class: 'muted rule-desc' }, r.description),
            details),
          h('div', { class: 'rule-actions' }, sel)));
      }
    }
    return wrap;
  }

  /* ---------- Pestaña «Conjuntos de reglas» ---------- */
  function renderRulesetsTab(app, rerender, state) {
    const wrap = h('div', { class: 'stack rules-rulesets' });
    if (!O.spectral) {
      wrap.appendChild(h('div', { class: 'callout error' }, icon('alert-circle'), h('span', null, 'El motor de reglas no está disponible en esta versión.')));
      return wrap;
    }
    const cfg = O.ruleconfig.readConfig(app.project);
    const rulesets = O.ruleconfig.listRulesets(app.project, cfg);

    const fileInput = h('input', { type: 'file', accept: '.yaml,.yml,.json,.raml,.txt', style: { display: 'none' }, 'aria-hidden': 'true' });
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => { handleImport(app, String(reader.result || ''), f.name, rerender); };
      reader.onerror = () => toast('No se pudo leer el fichero', 'error');
      reader.readAsText(f);
      fileInput.value = '';
    });

    wrap.appendChild(h('div', { class: 'row wrap rules-top' },
      btn('Importar fichero...', () => fileInput.click(), 'small', 'file-up'),
      btn('Nuevo conjunto', () => newRuleset(app, rerender), 'small', 'plus'),
      btn('Desde la biblioteca', (e) => showLibraryMenu(app, e.currentTarget, rerender), 'small', 'archive'),
      fileInput));

    const drop = h('div', { class: 'rules-drop', role: 'button', tabindex: 0, 'aria-label': 'Zona de arrastrar y soltar para importar conjuntos de reglas' },
      icon('upload'), h('span', null, 'Arrastra aquí un conjunto Spectral (.yaml, .yml, .json) o un perfil AMF'));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', async (e) => {
      e.preventDefault(); drop.classList.remove('over');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      try { const text = await f.text(); handleImport(app, text, f.name, rerender); }
      catch (err) { toast('No se pudo leer el fichero: ' + err.message, 'error'); }
    });
    drop.addEventListener('click', () => fileInput.click());
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
    wrap.appendChild(drop);

    if (!rulesets.length) {
      wrap.appendChild(h('div', { class: 'callout' }, icon('info'),
        h('span', null, 'Aún no hay conjuntos de reglas propios. Importa un fichero Spectral o AMF, o crea uno nuevo.')));
      return wrap;
    }
    for (const rs of rulesets) wrap.appendChild(rulesetCard(app, rs, rerender));
    return wrap;
  }

  function rulesetCard(app, rs, rerender) {
    const p = rs.ruleset;
    const errs = (p.errors || []).slice();
    const unsup = (p.unsupported || []).slice();
    const total = (p.rules || []).length;

    const enabled = h('input', { type: 'checkbox', checked: !!rs.enabled, 'aria-label': 'Activar ' + rs.name });
    enabled.addEventListener('change', () => {
      updateConfig(app, (c) => {
        const cur = c.rulesets[rs.id] || { enabled: true, rules: {} };
        cur.enabled = enabled.checked; c.rulesets[rs.id] = cur;
      });
      rerender();
    });

    const head = h('div', { class: 'rs-head' },
      h('div', { class: 'rs-title' },
        h('strong', null, rs.name),
        h('code', { class: 'muted' }, rs.id),
        total ? h('span', { class: 'badge' }, total + ' regla(s)') : null,
        errs.length ? h('span', { class: 'badge err' }, errs.length + ' error(es)') : null,
        unsup.length ? h('span', { class: 'badge warn' }, unsup.length + ' aviso(s)') : null,
        !rs.enabled ? h('span', { class: 'badge' }, 'Desactivado') : null),
      h('label', { class: 'check compact' }, enabled, h('span', null, 'Activo')));

    const actions = h('div', { class: 'row wrap rs-actions' },
      btn('Editar YAML', () => openYamlEditor(app, rs, rerender), 'small', 'file-code'),
      btn('Exportar', () => O.fileio.downloadText(O.util.basename(rs.id), rs.text, 'application/yaml;charset=utf-8'), 'small', 'download'),
      btn('Guardar en biblioteca', async () => {
        const name = await app.prompt({ title: 'Guardar en la biblioteca', label: 'Nombre', value: rs.name });
        if (!name) return;
        libUpsert(name, rs.text); toast('Guardado en la biblioteca del navegador', 'ok');
      }, 'small', 'archive'),
      btn('Nueva regla', () => openRuleWizard(app, rs, rerender), 'small', 'plus'),
      btn('Eliminar', async () => {
        const ok = await app.confirm({ title: 'Eliminar conjunto de reglas', message: 'Se eliminará «' + rs.name + '» (' + rs.id + ') del contrato. Esta acción se puede deshacer con Ctrl+Z tras guardar.', confirmLabel: 'Eliminar', danger: true });
        if (!ok) return;
        app.project.setExtra(rs.id, null);
        updateConfig(app, (c) => { delete c.rulesets[rs.id]; });
        rerender(); toast('Conjunto eliminado', 'ok');
      }, 'small danger-text', 'trash-2'));

    const box = h('div', { class: 'rs-card' + (rs.enabled ? '' : ' off') }, head);
    if (errs.length) box.appendChild(h('details', { class: 'callout error rs-issues', 'data-fold-id': 'rs-err:' + rs.id },
      h('summary', null, icon('alert-circle'), h('span', null, 'Errores del fichero (' + errs.length + ')')),
      h('ul', null, errs.map((e) => h('li', null, String(e))))));
    if (unsup.length) box.appendChild(h('details', { class: 'callout warn rs-issues', 'data-fold-id': 'rs-warn:' + rs.id },
      h('summary', null, icon('alert-triangle'), h('span', null, 'Avisos (' + unsup.length + ')')),
      h('ul', null, unsup.map((e) => h('li', null, String(e))))));
    box.appendChild(actions);
    if (total) box.appendChild(rulesetRules(app, rs, rerender));
    return box;
  }

  function rulesetRules(app, rs, rerender) {
    const p = rs.ruleset;
    const details = h('details', { class: 'rs-rules', 'data-fold-id': 'rs-rules:' + rs.id },
      h('summary', null, 'Reglas del conjunto (' + p.rules.length + ')'));
    const list = h('div', { class: 'stack rs-rules-body' });
    for (const r of p.rules) {
      const override = rs.rules && rs.rules[r.id];
      const eff = override || r.severity;
      const sel = h('select', { 'aria-label': 'Severidad de ' + r.id, class: 'rules-sev', disabled: !r.supported },
        SEV_OPTIONS.map(([v, l]) => h('option', { value: v }, l)));
      sel.value = eff;
      sel.addEventListener('change', () => {
        updateConfig(app, (c) => {
          const cur = c.rulesets[rs.id] || { enabled: rs.enabled, rules: {} };
          if (sel.value === r.severity) delete cur.rules[r.id]; else cur.rules[r.id] = sel.value;
          c.rulesets[rs.id] = cur;
        });
        rerender();
      });
      const givenText = Array.isArray(r.given) ? r.given.join('  |  ') : String(r.given || '');
      list.appendChild(h('div', { class: 'rs-rule' + (r.supported ? '' : ' unsup') },
        h('div', { class: 'rs-rule-main' },
          h('div', { class: 'rs-rule-head' }, h('strong', null, r.id), r.supported ? null : h('span', { class: 'badge warn', title: r.reason || '' }, 'No soportada')),
          h('p', { class: 'muted rs-rule-desc' }, r.description || r.message || ''),
          givenText ? h('code', { class: 'rs-rule-given mono' }, givenText) : null,
          !r.supported && r.reason ? h('p', { class: 'muted rs-rule-reason' }, r.reason) : null),
        h('div', { class: 'rule-actions' }, sel)));
    }
    details.appendChild(list);
    return details;
  }

  /* ---------- Nuevo conjunto ---------- */
  async function newRuleset(app, rerender) {
    const name = await app.prompt({ title: 'Nuevo conjunto de reglas', label: 'Nombre', placeholder: 'Reglas de mi API' });
    if (!name) return;
    const path = O.ruleconfig.rulesetPathFor(app.project, name);
    const yamlText = 'x-concord-name: ' + JSON.stringify(name) + '\ndescription: Reglas propias del contrato.\nrules: {}\n';
    app.project.setExtra(path, yamlText);
    rerender();
    toast('Conjunto «' + name + '» creado', 'ok');
  }

  /* ---------- Biblioteca ---------- */
  function showLibraryMenu(app, anchor, rerender) {
    const items = [];
    const entries = libRead();
    if (!entries.length) items.push({ label: 'La biblioteca está vacía', icon: 'archive', disabled: true });
    else {
      items.push({ header: 'Biblioteca del navegador' });
      for (const e of entries) items.push({
        label: e.name, icon: 'archive',
        hint: new Date(e.ts).toLocaleDateString('es-ES'),
        onClick: () => {
          const path = O.ruleconfig.rulesetPathFor(app.project, e.name);
          app.project.setExtra(path, e.text);
          rerender();
          toast('Importado «' + e.name + '» de la biblioteca', 'ok');
        }
      });
    }
    items.push({ separator: true }, { label: 'Gestionar biblioteca...', icon: 'settings', onClick: () => manageLibrary(rerender) });
    showMenu(anchor, items);
  }
  function manageLibrary(rerender) {
    const body = h('div', { class: 'stack lib-manage' });
    function render() {
      body.textContent = '';
      const entries = libRead();
      if (!entries.length) { body.appendChild(h('p', { class: 'muted' }, 'La biblioteca del navegador está vacía.')); return; }
      for (const e of entries) body.appendChild(h('div', { class: 'lib-row' },
        h('div', { class: 'lib-info' }, h('strong', null, e.name), h('span', { class: 'muted' }, new Date(e.ts).toLocaleString('es-ES'))),
        iconBtn('trash-2', 'Eliminar «' + e.name + '» de la biblioteca', () => { libDelete(e.name); render(); if (rerender) rerender(); }, 'danger-text')));
    }
    render();
    modal({ title: 'Biblioteca del navegador', content: body, cancelValue: null, actions: [{ label: 'Cerrar', kind: 'primary', value: null }] });
  }

  /* ---------- Importación ---------- */
  function handleImport(app, text, filename, rerender) {
    if (!text || !text.trim()) { toast('El fichero está vacío', 'error'); return; }
    const trimmed = text.replace(/^\uFEFF/, '').replace(/^\s+/, '');
    if (trimmed.startsWith('#%Validation Profile')) return importAmf(app, text, filename, rerender);
    return importSpectral(app, text, filename, rerender);
  }

  async function importSpectral(app, text, filename, rerender) {
    if (!O.spectral) { toast('El motor de reglas no está disponible', 'error'); return; }
    const parsed = O.spectral.parseRuleset(text, filename);
    if (parsed.errors && parsed.errors.length) {
      await app.confirm({ title: 'No se puede importar «' + filename + '»', message: 'El fichero tiene errores y no es un ruleset Spectral válido:', details: parsed.errors, confirmLabel: 'Entendido', cancelLabel: 'Cerrar' });
      return;
    }
    if (parsed.unsupported && parsed.unsupported.length) {
      const ok = await app.confirm({ title: 'Importar con advertencias', message: 'El fichero se puede importar pero contiene elementos no soportados en Concord (se ignorarán al validar):', details: parsed.unsupported, confirmLabel: 'Importar de todos modos', danger: false });
      if (!ok) return;
    }
    const name = parsed.name || O.util.basename(filename).replace(/\.(ya?ml|json)$/i, '') || 'reglas';
    const path = O.ruleconfig.rulesetPathFor(app.project, name);
    app.project.setExtra(path, text);
    rerender();
    toast('Importado «' + name + '» con ' + (parsed.rules || []).length + ' regla(s)', 'ok');
  }

  async function importAmf(app, text, filename, rerender) {
    if (!O.amf2spectral || typeof O.amf2spectral.translateProfile !== 'function') {
      toast('La traducción de perfiles AMF no está disponible', 'error');
      return;
    }
    let res;
    try { res = O.amf2spectral.translateProfile(text); } catch (e) { toast('No se pudo traducir el perfil AMF: ' + e.message, 'error'); return; }
    if (!res || !res.ok || !res.spectralText) {
      await app.confirm({ title: 'No se pudo traducir el perfil AMF', message: (res && res.errors && res.errors.length) ? 'Errores del traductor:' : 'El fichero no es un perfil AMF válido.', details: (res && res.errors) || [], confirmLabel: 'Entendido', cancelLabel: 'Cerrar' });
      return;
    }
    const report = res.report || [];
    const counts = report.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
    const rows = report.map((r) => h('tr', null,
      h('td', null, h('code', null, String(r.rule || ''))),
      h('td', null, h('span', { class: 'badge ' + (r.status === 'translated' ? 'ok' : r.status === 'partial' ? 'warn' : 'err') }, r.status === 'translated' ? 'Traducida' : r.status === 'partial' ? 'Parcial' : 'No soportada')),
      h('td', { class: 'muted' }, String(r.reason || ''))));
    const summary = h('div', { class: 'amf-summary row wrap' },
      h('span', { class: 'badge ok' }, (counts.translated || 0) + ' traducidas'),
      h('span', { class: 'badge warn' }, (counts.partial || 0) + ' parciales'),
      h('span', { class: 'badge err' }, (counts.unsupported || 0) + ' no soportadas'));
    const table = report.length ? h('table', { class: 'amf-report' },
      h('thead', null, h('tr', null, h('th', null, 'Regla'), h('th', null, 'Estado'), h('th', null, 'Motivo'))),
      h('tbody', null, rows)) : h('p', { class: 'muted' }, 'Sin detalle por regla.');
    const content = h('div', { class: 'stack amf-dialog' },
      h('p', null, 'El fichero «' + filename + '» es un perfil de validación de MuleSoft (AMF). Se traducirá a Spectral al importarlo.'),
      summary, table);
    const m = modal({ title: 'Traducción de perfil AMF', wide: true, content, cancelValue: null, actions: [{ label: 'Cancelar', value: null }, { label: 'Importar traducción', kind: 'primary', value: '__ok__' }] });
    const r = await m.promise;
    if (r !== '__ok__') return;
    const name = res.name || O.util.basename(filename).replace(/\.(ya?ml|json|raml)$/i, '') || 'perfil-amf';
    const path = O.ruleconfig.rulesetPathFor(app.project, name);
    app.project.setExtra(path, res.spectralText);
    rerender();
    toast('Perfil AMF traducido e importado', 'ok');
  }

  /* ---------- Editor YAML ---------- */
  function openYamlEditor(app, rs, rerender) {
    const ta = h('textarea', { class: 'code rules-yaml-ta', spellcheck: 'false', 'aria-label': 'YAML del conjunto ' + rs.name, rows: 20 });
    ta.value = rs.text;
    const status = h('div', { class: 'rules-yaml-status' });
    const okRef = {};
    let parsed = null;
    const debounce = O.util.debounce ? O.util.debounce(update, 300) : (function () { let t; return function () { const a = arguments; clearTimeout(t); t = setTimeout(() => update.apply(null, a), 300); }; })();
    function update() {
      if (!O.spectral) { status.textContent = 'El motor de reglas no está disponible.'; if (okRef.b) okRef.b.disabled = true; return; }
      parsed = O.spectral.parseRuleset(ta.value, O.util.basename(rs.id));
      status.textContent = '';
      const errs = parsed.errors || []; const uns = parsed.unsupported || [];
      const line = h('div', { class: 'row wrap rules-yaml-line' },
        h('span', { class: 'badge ' + (errs.length ? 'err' : 'ok') }, errs.length ? errs.length + ' error(es)' : 'Válido'),
        h('span', { class: 'badge' }, (parsed.rules || []).length + ' regla(s)'),
        uns.length ? h('span', { class: 'badge warn' }, uns.length + ' aviso(s)') : null);
      status.appendChild(line);
      if (errs.length) status.appendChild(h('ul', { class: 'rules-yaml-errors' }, errs.slice(0, 5).map((e) => h('li', null, String(e)))));
      if (uns.length) status.appendChild(h('ul', { class: 'rules-yaml-warns muted' }, uns.slice(0, 5).map((e) => h('li', null, String(e)))));
      if (okRef.b) okRef.b.disabled = errs.length > 0;
    }
    ta.addEventListener('input', () => debounce());
    const content = h('div', { class: 'stack rules-yaml-dialog' },
      h('p', { class: 'muted' }, 'Fichero: ' + rs.id),
      ta, status);
    const m = modal({ title: 'Editar YAML — ' + rs.name, wide: true, content, cancelValue: null, actions: [
      { label: 'Cancelar', value: null },
      { label: 'Guardar', kind: 'primary', value: '__ok__', ref: (b) => { okRef.b = b; }, onClick: () => {
        if (parsed && (parsed.errors || []).length) return false;
        app.project.setExtra(rs.id, ta.value);
        toast('Conjunto guardado', 'ok');
        rerender();
      } }
    ] });
    update();
    return m.promise;
  }

  /* ---------- Asistente de nueva regla ---------- */
  function openRuleWizard(app, rs, rerender) {
    if (!YAML() || !O.spectral) { toast('El motor de reglas no está disponible', 'error'); return; }
    const existing = new Set((rs.ruleset.rules || []).map((r) => r.id));
    const st = { id: '', description: '', message: '', severity: 'warn', presetId: 'operations', customGiven: '', field: '', functionId: 'defined', values: '', min: '', max: '', casing: 'camel', pattern: '', schema: '' };

    const idInput = h('input', { type: 'text', placeholder: 'mi-regla-en-kebab-case', 'aria-label': 'Identificador' });
    const descInput = h('input', { type: 'text', placeholder: 'Qué comprueba esta regla' });
    const msgInput = h('input', { type: 'text', placeholder: 'Mensaje al usuario ({{property}}, {{value}}, {{path}}, {{error}})' });
    const sevSel = h('select', { 'aria-label': 'Severidad' }, SPECTRAL_SEV.map(([v, l]) => h('option', { value: v }, l)));
    sevSel.value = st.severity;

    const presetSel = h('select', { 'aria-label': 'Se aplica a' }, PRESETS.map((p) => h('option', { value: p.id }, p.label)));
    presetSel.value = st.presetId;
    const customGiven = h('input', { type: 'text', placeholder: '$.paths[*][*]', 'aria-label': 'JSONPath personalizado' });
    const fieldDatalist = h('datalist', { id: 'rules-field-list-' + Date.now() });
    const fieldInput = h('input', { type: 'text', placeholder: 'name, format, maxLength, @key... (opcional)', 'aria-label': 'Campo', list: fieldDatalist.id });

    const fnSel = h('select', { 'aria-label': 'Comprobación' }, FUNCTIONS.map((f) => h('option', { value: f.id }, f.label)));
    fnSel.value = st.functionId;
    const patternInput = h('input', { type: 'text', placeholder: 'Expresión regular (con o sin /barras/)' });
    const valuesInput = h('input', { type: 'text', placeholder: 'valor1, valor2, valor3' });
    const minInput = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'Mín.' });
    const maxInput = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'Máx.' });
    const casingSel = h('select', { 'aria-label': 'Formato' }, CASING_TYPES.map(([v, l]) => h('option', { value: v }, l)));
    casingSel.value = st.casing;
    const schemaInput = h('textarea', { class: 'mono', rows: 4, spellcheck: 'false', placeholder: 'JSON o YAML del esquema' });

    const optsBox = h('div', { class: 'stack rules-wiz-opts' });
    const preview = h('pre', { class: 'code-block' });
    const errBox = h('div', { class: 'field-error' });
    const customGivenField = F().field('JSONPath personalizado', customGiven);

    function bindOn(el, key, ev) {
      el.addEventListener(ev || 'input', () => { st[key] = el.value; update(); });
    }
    bindOn(idInput, 'id'); bindOn(descInput, 'description'); bindOn(msgInput, 'message');
    sevSel.addEventListener('change', () => { st.severity = sevSel.value; update(); });
    presetSel.addEventListener('change', () => { st.presetId = presetSel.value; refreshPreset(); update(); });
    customGiven.addEventListener('input', () => { st.customGiven = customGiven.value; update(); });
    fieldInput.addEventListener('input', () => { st.field = fieldInput.value; update(); });
    fnSel.addEventListener('change', () => { st.functionId = fnSel.value; renderOpts(); update(); });
    patternInput.addEventListener('input', () => { st.pattern = patternInput.value; update(); });
    valuesInput.addEventListener('input', () => { st.values = valuesInput.value; update(); });
    minInput.addEventListener('input', () => { st.min = minInput.value; update(); });
    maxInput.addEventListener('input', () => { st.max = maxInput.value; update(); });
    casingSel.addEventListener('change', () => { st.casing = casingSel.value; update(); });
    schemaInput.addEventListener('input', () => { st.schema = schemaInput.value; update(); });

    function refreshPreset() {
      const p = PRESETS.find((x) => x.id === st.presetId);
      customGivenField.style.display = p.id === 'custom' ? '' : 'none';
      fieldDatalist.textContent = '';
      (p.fields || []).forEach((f) => fieldDatalist.appendChild(h('option', { value: f })));
    }
    function renderOpts() {
      optsBox.textContent = '';
      const f = st.functionId;
      if (f === 'pattern-match' || f === 'pattern-notmatch') optsBox.appendChild(F().field(f === 'pattern-match' ? 'Patrón que debe cumplir' : 'Patrón que no debe cumplir', patternInput, 'Regex JavaScript, p. ej. ^[a-z][a-z0-9-]*$'));
      else if (f === 'enumeration') optsBox.appendChild(F().field('Valores permitidos', valuesInput, 'Separados por coma'));
      else if (f === 'length') optsBox.appendChild(h('div', { class: 'form-grid' }, F().field('Mínimo', minInput), F().field('Máximo', maxInput)));
      else if (f === 'casing') optsBox.appendChild(F().field('Formato', casingSel));
      else if (f === 'schema') optsBox.appendChild(F().field('Esquema JSON', schemaInput, 'Se acepta JSON o YAML'));
    }

    function buildRuleObj() {
      const p = PRESETS.find((x) => x.id === st.presetId);
      const givenRaw = p.id === 'custom' ? st.customGiven.trim() : p.given;
      const given = Array.isArray(givenRaw) ? givenRaw.slice() : (typeof givenRaw === 'string' ? givenRaw : '');
      const then = { function: (FUNCTIONS.find((x) => x.id === st.functionId) || {}).fn };
      const field = st.field && st.field.trim();
      if (field) then.field = field;
      const f = st.functionId;
      if (f === 'pattern-match' || f === 'pattern-notmatch') then.functionOptions = { [f === 'pattern-match' ? 'match' : 'notMatch']: st.pattern };
      else if (f === 'enumeration') then.functionOptions = { values: st.values.split(',').map((s) => s.trim()).filter(Boolean) };
      else if (f === 'length') {
        const o = {};
        if (st.min !== '') o.min = Number(st.min);
        if (st.max !== '') o.max = Number(st.max);
        then.functionOptions = o;
      } else if (f === 'casing') then.functionOptions = { type: st.casing };
      else if (f === 'schema') {
        let sch;
        try { sch = YAML().parse(st.schema); } catch (e) { throw new Error('Esquema no válido: ' + e.message); }
        if (!sch || typeof sch !== 'object') throw new Error('El esquema debe ser un objeto');
        then.functionOptions = { schema: sch };
      }
      const rule = { severity: st.severity };
      if (st.description) rule.description = st.description;
      if (st.message) rule.message = st.message;
      rule.given = given;
      rule.then = then;
      return rule;
    }

    function validateId() {
      const id = (st.id || '').trim();
      if (!id) return 'Introduce un identificador';
      if (!/^[a-z][a-z0-9-]*$/.test(id)) return 'Usa kebab-case (letras minúsculas, dígitos y guiones)';
      if (existing.has(id)) return 'Ya existe una regla con ese identificador en este conjunto';
      return '';
    }

    function update() {
      errBox.textContent = '';
      try {
        const obj = buildRuleObj();
        const id = (st.id || 'mi-regla').trim();
        preview.textContent = YAML().stringify({ [id]: obj }, { lineWidth: 0 });
        const idErr = validateId();
        if (okRef.b) okRef.b.disabled = !!idErr;
        if (idErr && st.id) errBox.textContent = idErr;
      } catch (e) {
        preview.textContent = '';
        errBox.textContent = e.message;
        if (okRef.b) okRef.b.disabled = true;
      }
    }

    renderOpts(); refreshPreset();
    const form = h('div', { class: 'stack rules-wiz' },
      F().grid(F().field('Identificador', idInput, 'Kebab-case, único en el conjunto'), F().field('Severidad', sevSel)),
      F().field('Descripción', descInput),
      F().field('Mensaje', msgInput, 'Puedes usar {{property}}, {{value}}, {{path}} y {{error}}'),
      F().section('Se aplica a'),
      F().grid(F().field('Objetivo', presetSel), F().field('Campo (opcional)', fieldInput, 'Ejemplos: format, maxLength, name, @key')),
      customGivenField,
      F().section('Comprobación'),
      F().field('Función', fnSel),
      optsBox,
      F().section('Vista previa'),
      preview, fieldDatalist, errBox);

    const okRef = {};
    const m = modal({ title: 'Nueva regla en ' + rs.name, wide: true, content: form, cancelValue: null, actions: [
      { label: 'Cancelar', value: null },
      { label: 'Añadir regla', kind: 'primary', value: '__ok__', ref: (b) => { okRef.b = b; b.disabled = true; }, onClick: () => {
        const idErr = validateId();
        if (idErr) { errBox.textContent = idErr; return false; }
        let obj;
        try { obj = buildRuleObj(); } catch (e) { errBox.textContent = e.message; return false; }
        let newText;
        try {
          const doc = YAML().parseDocument(rs.text);
          if (!doc.get('rules')) doc.setIn(['rules'], {});
          doc.setIn(['rules', st.id.trim()], obj);
          newText = String(doc);
        } catch (e) { errBox.textContent = 'No se pudo actualizar el YAML: ' + e.message; return false; }
        const check = O.spectral.parseRuleset(newText, O.util.basename(rs.id));
        if ((check.errors || []).length) { errBox.textContent = 'El fichero resultante no es válido: ' + check.errors[0]; return false; }
        app.project.setExtra(rs.id, newText);
        rerender();
        toast('Regla «' + st.id.trim() + '» añadida', 'ok');
      } }
    ] });
    update();
    return m.promise;
  }

  O.rulesUI = { open };
})();
