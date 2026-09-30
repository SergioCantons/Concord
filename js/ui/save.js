/* Diálogo de guardado: mantener estructura, documento único o raíz + fragments, con previsualización y verificación. */
(function () {
  'use strict';
  const O = (window.OAT = window.OAT || {});
  const { h, icon, btn, modal } = O.dom;
  const F = O.forms;

  function open(app) {
    const P = app.project;
    if (app.yaml) app.yaml.flush();
    const folder = app.folder;
    const st = { mode: 'inplace', rootName: O.util.basename(P.rootFile), outDir: '', target: 4, strategy: 'tags', naming: 'kebab', customRules: '', groupNames: {}, backup: true };
    let plan = null; let timer = null; let seq = 0;

    const preview = h('div', { class: 'save-preview' });
    const optsBox = h('div', { class: 'stack' });
    const spinner = h('span', { class: 'spinner', style: { display: 'none' } }, icon('loader'));

    const radio = (value, label, hint) => h('label', { class: 'radio-card' }, h('input', { type: 'radio', name: 'save-mode', value, checked: st.mode === value, onchange: () => { st.mode = value; renderOpts(); refresh(); } }), h('span', null, h('strong', null, label), h('small', null, hint)));
    const modes = h('div', { class: 'radio-cards', role: 'radiogroup', 'aria-label': 'Formato de guardado' },
      radio('inplace', 'Mantener la estructura', 'Escribe cada fichero tal como está en el proyecto.'),
      radio('single', 'Documento único', 'Empaqueta todo en un solo YAML sin referencias externas.'),
      radio('fragments', 'Raíz y fragments', 'Reparte el contrato en varios ficheros con $ref relativos.'));

    const input = (label, key, o) => {
      o = o || {};
      const el = o.select ? h('select', { 'aria-label': label }, o.select.map((x) => h('option', { value: x[0] }, x[1]))) : o.textarea ? h('textarea', { rows: 4, class: 'mono', spellcheck: false, 'aria-label': label, placeholder: o.placeholder || '' }) : h('input', { type: o.number ? 'number' : 'text', min: o.number ? 0 : null, 'aria-label': label, placeholder: o.placeholder || '' });
      el.value = st[key];
      el.addEventListener('change', () => { st[key] = o.number ? Math.max(0, parseInt(el.value, 10) || 0) : el.value; if (key !== 'target' && key !== 'customRules') st.groupNames = st.groupNames; refresh(); });
      return F.field(label, el, o.hint);
    };
    function renderOpts() {
      optsBox.textContent = '';
      if (st.mode === 'inplace') return;
      optsBox.appendChild(F.grid(input('Fichero raíz de salida', 'rootName'), input('Carpeta de salida (relativa)', 'outDir', { placeholder: '(carpeta del proyecto)' })));
      if (st.mode === 'fragments') {
        optsBox.appendChild(F.grid(
          input('Número objetivo de fragments', 'target', { number: true, hint: 'Es un objetivo: se ajusta a las dependencias y a la estrategia.' }),
          input('Estrategia de agrupación', 'strategy', { select: [['tags', 'Por tags o dominio (paths) y por tipo de componente'], ['paths', 'Un fichero por ruta'], ['components', 'Por tipo de componente'], ['schemas', 'Un fichero por schema (paths en el raíz)'], ['custom', 'Reglas personalizadas']] }),
          input('Convención de nombres', 'naming', { select: [['kebab', 'kebab-case'], ['snake', 'snake_case'], ['original', 'Nombre original']] })));
        if (st.strategy === 'custom') optsBox.appendChild(input('Reglas (una por línea: selector => fichero)', 'customRules', { textarea: true, placeholder: 'paths:/productos* => api/productos\nschemas:* => modelos/schemas\ntag:pedidos => api/pedidos', hint: 'Selectores: paths:, schemas:, responses:, parameters:..., tag:, o *. Admite comodín *.' }));
      }
    }

    const okBtnRef = {};
    function refresh() {
      clearTimeout(timer);
      spinner.style.display = '';
      const my = ++seq;
      timer = setTimeout(() => {
        try { plan = st.mode === 'inplace' ? planInPlace() : O.exporter.planExport(P, { mode: st.mode, rootName: st.rootName, outDir: st.outDir, target: st.target, strategy: st.strategy, naming: st.naming, customRules: st.customRules, groupNames: st.groupNames }); plan.error = null; }
        catch (e) { plan = { error: e.message, files: new Map(), preview: { created: [], modified: [], unchanged: [], unused: [] }, groups: [], notes: [], verification: { ok: false, errors: [] } }; }
        if (my !== seq) return;
        spinner.style.display = 'none';
        renderPreview();
      }, 40);
    }
    function planInPlace() {
      const files = P.texts();
      const orig = P.original;
      const pv = { created: [], modified: [], unchanged: [], unused: [] };
      for (const [p, t] of files) { if (!orig.has(p)) pv.created.push(p); else if (orig.get(p) !== t) pv.modified.push(p); else pv.unchanged.push(p); }
      for (const p of orig.keys()) if (!files.has(p)) pv.unused.push(p);
      const val = O.validate.validateProject(P, app.validationConfig());
      const errs = val.diagnostics.filter((d) => d.severity === 'error');
      return { files, rootPath: P.rootFile, preview: pv, groups: [], notes: P.hasDraft() ? ['Hay un borrador YAML sin aplicar: se guarda el último estado válido de ese fichero.'] : [], verification: { ok: true, inPlace: true, outputErrors: errs.length, errors: errs.slice(0, 5).map((d) => (d.file ? d.file + ': ' : '') + d.message) } };
    }
    function list(title, items, cls) {
      if (!items.length) return null;
      return h('div', { class: 'pv-group ' + cls }, h('h4', null, title + ' (' + items.length + ')'), h('ul', null, items.slice(0, 60).map((x) => h('li', null, h('code', null, x))), items.length > 60 ? h('li', null, '... y ' + (items.length - 60) + ' más') : null));
    }
    function renderPreview() {
      preview.textContent = '';
      if (plan.error) { preview.appendChild(h('div', { class: 'callout error' }, icon('alert-circle'), h('span', null, plan.error))); setOk(false); return; }
      const v = plan.verification;
      if (!v.inPlace) {
        preview.appendChild(h('div', { class: 'callout ' + (v.ok ? 'ok' : 'error') }, icon(v.ok ? 'check' : 'alert-circle'), h('span', null, v.ok ? 'Verificado: el resultado se recargó, se validó y es semánticamente idéntico al contrato actual (' + v.fileCount + ' fichero(s)).' : 'El resultado propuesto no supera la verificación. ' + (v.errors || []).slice(0, 3).join(' | '))));
      } else if (v.outputErrors) preview.appendChild(h('div', { class: 'callout warn' }, icon('alert-triangle'), h('span', null, 'El contrato tiene ' + v.outputErrors + ' error(es) de validación; puedes guardar igualmente el trabajo en curso. ' + v.errors.slice(0, 2).join(' | '))));
      (plan.notes || []).forEach((n) => preview.appendChild(h('div', { class: 'callout warn' }, icon('info'), h('span', null, n))));
      const pv = plan.preview;
      const dest = folder ? 'Se escribirá en la carpeta «' + folder.name + '».' : 'Se descargará como ' + (plan.files.size > 1 ? 'ZIP' : 'fichero') + ' (el navegador no concede acceso de escritura a carpetas).';
      preview.appendChild(h('p', { class: 'muted' }, dest));
      preview.appendChild(h('div', { class: 'pv-cols' }, list('Nuevos', pv.created, 'created'), list('Modificados', pv.modified, 'modified'), list('Sin cambios', pv.unchanged, 'unchanged'), list('Sin uso (no se eliminan)', pv.unused, 'unused')));
      if (plan.groups && plan.groups.length) {
        const rows = plan.groups.map((g) => {
          const rel = st.outDir ? g.file.slice(O.util.normalizePath(st.outDir).length + 1) : g.file;
          const inp = h('input', { type: 'text', value: rel, 'aria-label': 'Fichero del grupo ' + g.key });
          inp.addEventListener('change', () => { st.groupNames[g.key] = inp.value.trim(); refresh(); });
          return h('div', { class: 'grp-row' }, inp, h('span', { class: 'muted' }, g.count + ' elemento(s): ' + g.units.slice(0, 4).join(', ') + (g.units.length > 4 ? '…' : '')));
        });
        preview.appendChild(h('div', { class: 'stack' }, F.section('Distribución propuesta (' + plan.groups.length + ' fragments)'), h('div', { class: 'grp-table' }, rows)));
      }
      setOk(v.ok || v.inPlace);
    }
    function setOk(ok) { if (okBtnRef.b) okBtnRef.b.disabled = !ok || (plan && plan.files.size === 0); }

    const backup = h('input', { type: 'checkbox', checked: true, 'aria-label': 'Copia de seguridad' });
    const foot = folder ? h('label', { class: 'check' }, backup, h('span', null, 'Copia de seguridad previa en .oat-backup')) : null;
    const content = h('div', { class: 'stack save-dialog' }, modes, optsBox, h('div', { class: 'row' }, h('strong', null, 'Previsualización'), spinner), preview, foot);
    renderOpts();
    const m = modal({ title: 'Guardar contrato', wide: true, content, cancelValue: null, actions: [
      { label: 'Cancelar', value: null },
      { label: folder ? 'Guardar' : 'Descargar', kind: 'primary', value: '__ok__', ref: (b) => { okBtnRef.b = b; b.disabled = true; }, onClick: async (api) => { const ok = await commit(plan, st, folder, backup.checked, app); return ok; } }
    ] });
    refresh();
    return m.promise;
  }

  async function commit(plan, st, folder, backup, app) {
    const P = app.project;
    const structural = st.mode !== 'inplace';
    try {
      if (folder) {
        const io = O.fileio.dirIo(folder.handle);
        const res = await O.writer.applyPlan(plan.files, io, {
          backup,
          confirmOverwrite: (list) => app.confirm({ title: 'Sobrescribir ficheros existentes', message: 'Se van a sobrescribir ' + list.length + ' fichero(s) de la carpeta «' + folder.name + '».' + (backup ? ' Antes se guardará una copia de todos ellos en .oat-backup/.' : ' No se creará copia de seguridad.'), details: list, confirmLabel: 'Sobrescribir', danger: true })
        });
        if (res.cancelled) { app.toast('Guardado cancelado: no se ha escrito nada', 'info'); return false; }
        if (!res.ok) { await app.confirm({ title: 'No se pudo guardar', message: res.error + (res.rolledBack ? ' Los cambios ya escritos se han revertido.' : res.restoreErrors && res.restoreErrors.length ? ' Atención: no se pudieron revertir: ' + res.restoreErrors.join(', ') + '. Restaura desde ' + (res.backupDir || '.oat-backup') + '.' : ''), confirmLabel: 'Entendido', cancelLabel: 'Cerrar' }); return false; }
        if (structural) app.loadProject(O.project.Project.fromFiles(plan.files, plan.rootPath, P.name), { folder, saved: true, keepName: true });
        else P.markSaved();
        O.fileio.clearRecovery();
        app.toast('Guardado: ' + res.written.length + ' fichero(s)' + (res.backups.length ? ' · copia en ' + res.backupDir : ''), 'ok');
        return true;
      }
      if (plan.files.size === 1) O.fileio.downloadText(O.util.basename(Array.from(plan.files.keys())[0]), Array.from(plan.files.values())[0], 'application/yaml;charset=utf-8');
      else O.fileio.downloadZip((P.name || 'contrato') + '.zip', plan.files);
      if (!structural) P.markSaved();
      app.toast('Descarga iniciada', 'ok');
      return true;
    } catch (e) {
      app.toast('Error al guardar: ' + e.message, 'error');
      return false;
    }
  }

  O.saveUI = { open };
})();
