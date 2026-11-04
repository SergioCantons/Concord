/* Guardar y exportar.
 * - Guardar: sobrescribe el contrato abierto en su sitio y con la misma distribución de ficheros. Si no hay permiso
 *   de escritura lo pide al navegador; si no se sabe dónde está (ejemplo, contrato nuevo, ficheros soltados sin
 *   acceso) pregunta la ubicación una vez y la recuerda.
 * - Exportar: documento único, raíz + fragments o copia con la misma estructura, a otra carpeta o como descarga,
 *   con previsualización y verificación. No cambia el contrato abierto (salvo que se pida abrir el resultado). */
(function () {
  'use strict';
  const O = (window.OAT = window.OAT || {});
  const { h, icon, modal } = O.dom;
  const F = O.forms;
  const norm = (t) => String(t).replace(/\r\n/g, '\n');

  /* ---------- Ubicación del contrato abierto ---------- */
  /** Ubicación de guardado a partir de lo leído al abrir: carpeta, ficheros sueltos o ninguna. */
  function targetFromResult(r) {
    if (!r) return null;
    if (r.handle) return { kind: 'folder', handle: r.handle, name: r.folderName || r.handle.name };
    if (r.fileHandles && r.fileHandles.length) {
      const handles = new Map();
      r.fileHandles.forEach((fh) => { if (r.files.has(fh.name) && !handles.has(fh.name)) handles.set(fh.name, fh); });
      if (handles.size) return { kind: 'files', handles };
    }
    return null;
  }
  function describeTarget(t) {
    if (!t) return null;
    if (t.kind === 'folder') return 'la carpeta «' + t.name + '»';
    const names = Array.from(t.handles.values()).map((x) => x.name);
    return names.length === 1 ? '«' + names[0] + '»' : names.length + ' ficheros (' + names.slice(0, 3).join(', ') + (names.length > 3 ? '…' : '') + ')';
  }
  function setTarget(app, t) {
    app.target = t || null;
    app.folder = t && t.kind === 'folder' ? { handle: t.handle, name: t.name } : null;
  }
  function recentOf(t) {
    if (!t) return null;
    return t.kind === 'folder' ? { kind: 'folder', handle: t.handle } : { kind: 'files', handles: Array.from(t.handles.values()) };
  }

  /* ---------- Plan de guardado en el sitio ---------- */
  function inPlacePlan(P) {
    const files = P.texts();
    const orig = new Map(P.original);
    P.extras.forEach((t, p) => files.set(p, t));
    P.extrasOriginal.forEach((t, p) => orig.set(p, t));
    const changed = []; const created = [];
    for (const [p, t] of files) { if (!orig.has(p)) created.push(p); else if (orig.get(p) !== t) changed.push(p); }
    // Los ficheros de configuración eliminados en la aplicación se borran también; los del contrato nunca.
    const removed = Array.from(orig.keys()).filter((p) => !files.has(p) && O.project.isExtraPath(p));
    return { files, orig, changed, created, removed, all: Array.from(files.keys()) };
  }
  const pick = (files, paths) => new Map(paths.map((p) => [p, files.get(p)]));

  /* ---------- Permisos ---------- */
  /**
   * Consigue permiso de escritura para los identificadores; si el navegador no lo concede pregunta al usuario
   * (reintentar con un nuevo gesto, elegir otra ubicación o descargar). Devuelve 'granted' | 'pick' | 'download' | null.
   */
  async function obtainWrite(app, handles, label) {
    for (;;) {
      // Primero se consulta sin pedir nada; solo se piden (con el gesto del usuario aún vigente) los que faltan.
      const pending = [];
      for (const hd of handles) if ((await O.fileio.writePermission(hd, false)) !== 'granted') pending.push(hd);
      let state = 'granted';
      for (const hd of pending) { const st = await O.fileio.writePermission(hd, true); if (st !== 'granted') { state = st; break; } }
      if (state === 'granted') return 'granted';
      const blocked = state === 'denied';
      const m = modal({ title: 'Permiso de escritura necesario', content: h('div', { class: 'stack' },
        h('p', null, 'El navegador no ha concedido permiso para escribir en ' + label + '.'),
        h('p', { class: 'muted' }, blocked
          ? 'Parece que el permiso está bloqueado para esta página: permite «Editar archivos» en la configuración del sitio (icono junto a la dirección) y pulsa «Conceder permiso», o guarda en otra ubicación.'
          : 'Pulsa «Conceder permiso» y acepta el aviso del navegador («Guardar cambios» / «Permitir»).')),
      cancelValue: null, actions: [
        { label: 'Cancelar', value: null },
        { label: 'Descargar', value: 'download' },
        { label: 'Elegir otra ubicación...', value: 'pick', disabled: !O.fileio.hasFsAccess },
        { label: 'Conceder permiso', kind: 'primary', value: 'retry' }] });
      const r = await m.promise;
      if (r !== 'retry') return r;
    }
  }

  /* ---------- Guardar ---------- */
  async function save(app) {
    const P = app.project;
    if (!P) return false;
    // Un segundo Ctrl+S mientras se espera un permiso o un selector no debe lanzar otro guardado.
    if (app.saving) return false;
    app.saving = true;
    try { return await saveNow(app); } finally { app.saving = false; }
  }
  async function saveNow(app) {
    const P = app.project;
    if (app.yaml) app.yaml.flush();
    if (P.hasDraft()) app.toast('Hay un borrador YAML con errores sin aplicar: se guarda el último estado válido de ese fichero.', 'info', 5000);
    const plan = inPlacePlan(P);
    const t = app.target;
    if (t && !plan.changed.length && !plan.created.length && !plan.removed.length) { app.toast('No hay cambios que guardar', 'info', 1800); return true; }
    try {
      if (t && t.kind === 'folder') return await saveToFolder(app, t, plan);
      if (t && t.kind === 'files') return await saveToFiles(app, t, plan);
      return await saveAs(app, plan, null);
    } catch (e) {
      app.toast('Error al guardar: ' + e.message, 'error', 6000);
      return false;
    }
  }

  async function saveToFolder(app, t, plan) {
    const perm = await obtainWrite(app, [t.handle], describeTarget(t));
    if (perm === 'pick') return saveAs(app, plan, t.handle);
    if (perm === 'download') return downloadAll(app, plan);
    if (perm !== 'granted') return false;
    return writeFolder(app, t, plan, false);
  }

  async function saveToFiles(app, t, plan) {
    const touched = plan.changed.concat(plan.created);
    const missing = touched.filter((p) => !t.handles.has(p)).concat(plan.removed);
    if (missing.length) {
      // Hay ficheros que no estaban entre los abiertos: hace falta la carpeta del contrato para crearlos.
      const ok = await app.confirm({ title: 'Elige la carpeta del contrato', message: 'Para guardar ' + missing.length + ' fichero(s) nuevo(s) hace falta acceso a la carpeta donde están los ficheros abiertos. Elige esa carpeta en el siguiente paso.', details: missing, confirmLabel: 'Elegir carpeta...' });
      if (!ok) return false;
      const first = t.handles.get(app.project.rootFile) || t.handles.values().next().value;
      const dir = await O.fileio.pickWritableFolder(first);
      if (!dir) return false;
      for (const [p, fh] of t.handles) {
        const rel = await O.fileio.relativeIn(dir, fh);
        if (rel !== p) {
          await app.confirm({ title: 'Carpeta incorrecta', message: 'La carpeta «' + dir.name + '» no es la que contiene «' + fh.name + '». Elige la carpeta donde están los ficheros abiertos, o usa «Exportar» para guardar una copia en otro sitio.', confirmLabel: 'Entendido', cancelLabel: 'Cerrar' });
          return false;
        }
      }
      return writeFolder(app, { kind: 'folder', handle: dir, name: dir.name }, plan, false);
    }
    const handles = touched.map((p) => t.handles.get(p));
    const perm = await obtainWrite(app, handles, describeTarget({ kind: 'files', handles: new Map(touched.map((p) => [p, t.handles.get(p)])) }));
    if (perm === 'pick') return saveAs(app, plan, handles[0]);
    if (perm === 'download') return downloadAll(app, plan);
    if (perm !== 'granted') return false;
    return writeWith(app, t, O.fileio.filesIo(t.handles), plan, touched, false);
  }

  /** Escribe en una carpeta: los cambios (guardar) o todo el contrato (fresh: primera vez en esa ubicación). */
  function writeFolder(app, t, plan, fresh) {
    return writeWith(app, t, O.fileio.dirIo(t.handle), plan, fresh ? plan.all : plan.changed.concat(plan.created), fresh);
  }

  async function writeWith(app, t, io, plan, paths, fresh) {
    const P = app.project;
    // Ficheros modificados fuera de la aplicación desde que se abrieron o guardaron, o ficheros nuevos que ya
    // existen en disco con otro contenido: se avisa y se guarda copia.
    const external = [];
    if (!fresh) for (const p of paths) {
      if (!(await io.exists(p))) continue;
      const disk = norm(await io.read(p));
      if (disk === norm(plan.files.get(p))) continue;
      if (!plan.orig.has(p) || disk !== norm(plan.orig.get(p))) external.push(p);
    }
    if (external.length && !(await app.confirm({ title: 'Ficheros modificados fuera de la aplicación', message: 'Estos ficheros han cambiado en disco desde que se abrieron. Si guardas, se sobrescribirán (antes se copiarán en .oat-backup/' + (t.kind === 'folder' ? '' : ' si es posible') + ').', details: external, confirmLabel: 'Sobrescribir', danger: true }))) return false;
    const res = await O.writer.applyPlan(pick(plan.files, paths), io, {
      backup: t.kind === 'folder' && (fresh || external.length > 0),
      // En una carpeta nueva se confirma pisar lo que haya; el selector de "Guardar como" ya preguntó por su fichero.
      confirmOverwrite: fresh && t.kind === 'folder'
        ? (list) => app.confirm({ title: 'Sobrescribir ficheros existentes', message: 'En «' + t.name + '» ya existen ' + list.length + ' fichero(s) con otro contenido. Se guardará antes una copia en .oat-backup/.', details: list, confirmLabel: 'Sobrescribir', danger: true })
        : async () => true
    });
    if (res.cancelled) { app.toast('Guardado cancelado: no se ha escrito nada', 'info'); return false; }
    if (!res.ok) {
      await app.confirm({ title: 'No se pudo guardar', message: res.error + (res.rolledBack ? ' Los cambios ya escritos se han revertido.' : res.restoreErrors && res.restoreErrors.length ? ' Atención: no se pudieron revertir: ' + res.restoreErrors.join(', ') + '. Restaura desde ' + (res.backupDir || '.oat-backup') + '.' : ''), confirmLabel: 'Entendido', cancelLabel: 'Cerrar' });
      return false;
    }
    if (t.kind === 'folder' && !fresh) for (const p of plan.removed) { try { if (await io.exists(p)) await io.remove(p); } catch (e) { app.toast('No se pudo eliminar ' + p + ': ' + e.message, 'error'); } }
    setTarget(app, t);
    P.isExample = false;
    // Se marca como guardado lo que se escribió (no lo que se haya editado mientras se esperaba).
    P.markSaved(pick(plan.files, fresh ? plan.all : paths));
    if (fresh) { P.original = new Map(Array.from(plan.files).filter(([p]) => !O.project.isExtraPath(p))); P.extrasOriginal = new Map(Array.from(plan.files).filter(([p]) => O.project.isExtraPath(p))); }
    for (const p of plan.removed) P.extrasOriginal.delete(p);
    O.fileio.clearRecovery();
    const rec = recentOf(t);
    if (rec) O.fileio.addRecent(Object.assign({ rootFile: P.rootFile, name: P.name }, rec));
    app.toast('Guardado en ' + describeTarget(t) + ': ' + res.written.length + ' fichero(s)' + (res.backups.length ? ' · copia en ' + res.backupDir : ''), 'ok');
    return true;
  }

  /** Primera vez (o ubicación nueva): pide dónde guardar el contrato con su misma distribución. */
  async function saveAs(app, plan, startIn) {
    const P = app.project;
    if (!O.fileio.hasFsAccess) return downloadAll(app, plan);
    const single = plan.all.length === 1;
    if (single && O.fileio.hasSaveFilePicker) {
      const fh = await O.fileio.pickSaveFile(O.util.basename(P.rootFile), startIn);
      if (!fh) return false;
      // El fichero pasa a llamarse como se haya elegido (un contrato de un solo fichero no tiene $ref a sí mismo).
      if (fh.name !== P.rootFile) { P.renamePath(P.rootFile, fh.name); plan = inPlacePlan(P); }
      const t = { kind: 'files', handles: new Map([[P.rootFile, fh]]) };
      return writeWith(app, t, O.fileio.filesIo(t.handles), plan, plan.all, true);
    }
    const ok = await app.confirm({ title: 'Guardar contrato', message: 'Elige la carpeta donde guardar el contrato (' + plan.all.length + ' fichero(s)). Los próximos guardados se harán en ella.', confirmLabel: 'Elegir carpeta...' });
    if (!ok) return false;
    const dir = await O.fileio.pickWritableFolder(startIn);
    if (!dir) return false;
    return writeFolder(app, { kind: 'folder', handle: dir, name: dir.name }, plan, true);
  }

  function downloadAll(app, plan) {
    const P = app.project;
    if (plan.files.size === 1) O.fileio.downloadText(O.util.basename(plan.all[0]), plan.files.get(plan.all[0]), 'application/yaml;charset=utf-8');
    else O.fileio.downloadZip((P.name || 'contrato') + '.zip', plan.files);
    // Con ubicación conocida, descargar no actualiza los ficheros abiertos: siguen pendientes de guardar.
    if (!app.target) { P.markSaved(); O.fileio.clearRecovery(); }
    app.toast(O.fileio.hasFsAccess ? 'Descarga iniciada' : 'Descarga iniciada (este navegador no permite escribir ficheros directamente)', 'ok', 4000);
    return true;
  }

  /* ---------- Exportar ---------- */
  function openExport(app) {
    const P = app.project;
    if (app.yaml) app.yaml.flush();
    const projectFolder = app.target && app.target.kind === 'folder' ? app.target : null;
    const st = { mode: 'single', rootName: O.util.basename(P.rootFile), outDir: '', target: 4, strategy: 'tags', naming: 'kebab', customRules: '', groupNames: {}, backup: true, dest: O.fileio.hasFsAccess ? 'folder' : 'download', openAfter: false };
    let plan = null; let timer = null; let seq = 0;

    const preview = h('div', { class: 'save-preview' });
    const optsBox = h('div', { class: 'stack' });
    const destBox = h('div', { class: 'stack' });
    const spinner = h('span', { class: 'spinner', style: { display: 'none' } }, icon('loader'));

    const radio = (name, value, label, hint, key) => h('label', { class: 'radio-card' }, h('input', { type: 'radio', name, value, checked: st[key] === value, onchange: () => { st[key] = value; renderOpts(); refresh(); } }), h('span', null, h('strong', null, label), h('small', null, hint)));
    const modes = h('div', { class: 'radio-cards', role: 'radiogroup', 'aria-label': 'Formato de exportación' },
      radio('export-mode', 'single', 'Documento único', 'Empaqueta todo en un solo YAML sin referencias externas.', 'mode'),
      radio('export-mode', 'fragments', 'Raíz y fragments', 'Reparte el contrato en varios ficheros con $ref relativos.', 'mode'),
      radio('export-mode', 'copy', 'Misma estructura', 'Copia los ficheros tal como están en el proyecto.', 'mode'));

    const input = (label, key, o) => {
      o = o || {};
      const el = o.select ? h('select', { 'aria-label': label }, o.select.map((x) => h('option', { value: x[0] }, x[1]))) : o.textarea ? h('textarea', { rows: 4, class: 'mono', spellcheck: false, 'aria-label': label, placeholder: o.placeholder || '' }) : h('input', { type: o.number ? 'number' : 'text', min: o.number ? 0 : null, 'aria-label': label, placeholder: o.placeholder || '' });
      el.value = st[key];
      el.addEventListener('change', () => { st[key] = o.number ? Math.max(0, parseInt(el.value, 10) || 0) : el.value; refresh(); });
      return F.field(label, el, o.hint);
    };
    function renderOpts() {
      optsBox.textContent = '';
      if (st.mode !== 'copy') optsBox.appendChild(F.grid(input('Fichero raíz de salida', 'rootName'), input('Subcarpeta de salida (relativa)', 'outDir', { placeholder: '(ninguna)' })));
      else optsBox.appendChild(input('Subcarpeta de salida (relativa)', 'outDir', { placeholder: '(ninguna)' }));
      if (st.mode === 'fragments') {
        optsBox.appendChild(F.grid(
          input('Número objetivo de fragments', 'target', { number: true, hint: 'Es un objetivo: se ajusta a las dependencias y a la estrategia.' }),
          input('Estrategia de agrupación', 'strategy', { select: [['tags', 'Por tags o dominio (paths) y por tipo de componente'], ['paths', 'Un fichero por ruta'], ['components', 'Por tipo de componente'], ['schemas', 'Un fichero por schema (paths en el raíz)'], ['custom', 'Reglas personalizadas']] }),
          input('Convención de nombres', 'naming', { select: [['kebab', 'kebab-case'], ['snake', 'snake_case'], ['original', 'Nombre original']] })));
        if (st.strategy === 'custom') optsBox.appendChild(input('Reglas (una por línea: selector => fichero)', 'customRules', { textarea: true, placeholder: 'paths:/productos* => api/productos\nschemas:* => modelos/schemas\ntag:pedidos => api/pedidos', hint: 'Selectores: paths:, schemas:, responses:, parameters:..., tag:, o *. Admite comodín *.' }));
      }
      destBox.textContent = '';
      const dests = h('div', { class: 'radio-cards', role: 'radiogroup', 'aria-label': 'Destino' },
        O.fileio.hasFsAccess ? radio('export-dest', 'folder', 'Elegir carpeta', 'Se pedirá la carpeta de destino al exportar.', 'dest') : null,
        projectFolder ? radio('export-dest', 'project', 'Carpeta del proyecto', 'Escribe en «' + projectFolder.name + '» (usa una subcarpeta para no pisar el contrato).', 'dest') : null,
        radio('export-dest', 'download', 'Descargar', 'Un fichero o un ZIP.', 'dest'));
      destBox.append(h('strong', null, 'Destino'), dests);
      if (st.dest !== 'download') {
        const bk = h('input', { type: 'checkbox', checked: st.backup, onchange: () => { st.backup = bk.checked; } });
        const op = h('input', { type: 'checkbox', checked: st.openAfter, onchange: () => { st.openAfter = op.checked; } });
        destBox.append(h('label', { class: 'check' }, bk, h('span', null, 'Copia de seguridad en .oat-backup de los ficheros que se sobrescriban')),
          h('label', { class: 'check' }, op, h('span', null, 'Después, trabajar sobre el contrato exportado (se abre en el editor y se guarda allí)')));
      }
    }

    const okBtnRef = {};
    function refresh() {
      clearTimeout(timer);
      spinner.style.display = '';
      const my = ++seq;
      timer = setTimeout(() => {
        try { plan = st.mode === 'copy' ? planCopy() : withExtras(O.exporter.planExport(P, { mode: st.mode, rootName: st.rootName, outDir: st.outDir, target: st.target, strategy: st.strategy, naming: st.naming, customRules: st.customRules, groupNames: st.groupNames })); plan.error = null; }
        catch (e) { plan = { error: e.message, files: new Map(), preview: { created: [], modified: [], unchanged: [], unused: [] }, groups: [], notes: [], verification: { ok: false, errors: [] } }; }
        if (my !== seq) return;
        spinner.style.display = 'none';
        renderPreview();
      }, 40);
    }
    /** La configuración de validación (.concord/) acompaña al contrato exportado. */
    function withExtras(pl) {
      if (!P.extras.size) return pl;
      const dir = O.util.normalizePath(st.outDir || '');
      P.extras.forEach((t, p) => { const out = dir ? dir + '/' + p : p; pl.files.set(out, t); if (!pl.preview.created.includes(out) && !pl.preview.modified.includes(out)) pl.preview.created.push(out); });
      return pl;
    }
    function planCopy() {
      const dir = O.util.normalizePath(st.outDir || '');
      if (st.outDir && !dir) throw new Error('Subcarpeta no válida');
      const files = new Map();
      inPlacePlan(P).files.forEach((t, p) => files.set(dir ? dir + '/' + p : p, t));
      return { files, rootPath: dir ? dir + '/' + P.rootFile : P.rootFile, preview: { created: Array.from(files.keys()), modified: [], unchanged: [], unused: [] }, groups: [], notes: P.hasDraft() ? ['Hay un borrador YAML sin aplicar: se exporta el último estado válido de ese fichero.'] : [], verification: { ok: true, inPlace: true } };
    }
    function list(title, items, cls) {
      if (!items.length) return null;
      return h('div', { class: 'pv-group ' + cls }, h('h4', null, title + ' (' + items.length + ')'), h('ul', null, items.slice(0, 60).map((x) => h('li', null, h('code', null, x))), items.length > 60 ? h('li', null, '... y ' + (items.length - 60) + ' más') : null));
    }
    function renderPreview() {
      preview.textContent = '';
      if (plan.error) { preview.appendChild(h('div', { class: 'callout error' }, icon('alert-circle'), h('span', null, plan.error))); setOk(false); return; }
      const v = plan.verification;
      if (!v.inPlace) preview.appendChild(h('div', { class: 'callout ' + (v.ok ? 'ok' : 'error') }, icon(v.ok ? 'check' : 'alert-circle'), h('span', null, v.ok ? 'Verificado: el resultado se recargó, se validó y es semánticamente idéntico al contrato actual (' + v.fileCount + ' fichero(s)).' : 'El resultado propuesto no supera la verificación. ' + (v.errors || []).slice(0, 3).join(' | '))));
      (plan.notes || []).forEach((n) => preview.appendChild(h('div', { class: 'callout warn' }, icon('info'), h('span', null, n))));
      const files = Array.from(plan.files.keys());
      preview.appendChild(h('div', { class: 'pv-cols' }, list('Ficheros que se exportan', files, 'created')));
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

    const content = h('div', { class: 'stack save-dialog' }, modes, optsBox, destBox, h('div', { class: 'row' }, h('strong', null, 'Previsualización'), spinner), preview);
    renderOpts();
    const m = modal({ title: 'Exportar contrato', wide: true, content, cancelValue: null, actions: [
      { label: 'Cancelar', value: null },
      { label: 'Exportar', kind: 'primary', value: '__ok__', ref: (b) => { okBtnRef.b = b; b.disabled = true; }, onClick: () => runExport(app, plan, st, projectFolder) }
    ] });
    refresh();
    return m.promise;
  }

  async function runExport(app, plan, st, projectFolder) {
    if (st.running) return false;
    st.running = true;
    try { return await exportNow(app, plan, st, projectFolder); } finally { st.running = false; }
  }
  async function exportNow(app, plan, st, projectFolder) {
    const P = app.project;
    try {
      let dest = st.dest;
      let perm = null;
      if (dest === 'project') {
        perm = await obtainWrite(app, [projectFolder.handle], describeTarget(projectFolder));
        if (perm === 'download') dest = 'download';
        else if (perm === 'pick') dest = 'folder';
        else if (perm !== 'granted') return false;
      }
      if (dest === 'download') {
        if (plan.files.size === 1) O.fileio.downloadText(O.util.basename(Array.from(plan.files.keys())[0]), Array.from(plan.files.values())[0], 'application/yaml;charset=utf-8');
        else O.fileio.downloadZip((P.name || 'contrato') + '-exportado.zip', plan.files);
        app.toast('Descarga iniciada', 'ok');
        return true;
      }
      let t;
      if (dest === 'project') t = projectFolder;
      else {
        const dir = await O.fileio.pickWritableFolder(projectFolder ? projectFolder.handle : undefined);
        if (!dir) return false;
        t = { kind: 'folder', handle: dir, name: dir.name };
      }
      const res = await O.writer.applyPlan(plan.files, O.fileio.dirIo(t.handle), {
        backup: st.backup,
        confirmOverwrite: (list) => app.confirm({ title: 'Sobrescribir ficheros existentes', message: 'Se van a sobrescribir ' + list.length + ' fichero(s) de la carpeta «' + t.name + '».' + (st.backup ? ' Antes se guardará una copia de todos ellos en .oat-backup/.' : ' No se creará copia de seguridad.'), details: list, confirmLabel: 'Sobrescribir', danger: true })
      });
      if (res.cancelled) { app.toast('Exportación cancelada: no se ha escrito nada', 'info'); return false; }
      if (!res.ok) { await app.confirm({ title: 'No se pudo exportar', message: res.error + (res.rolledBack ? ' Los cambios ya escritos se han revertido.' : ''), confirmLabel: 'Entendido', cancelLabel: 'Cerrar' }); return false; }
      app.toast('Exportado en «' + t.name + '»: ' + res.written.length + ' fichero(s)' + (res.unchanged ? ' (sin cambios)' : '') + (res.backups.length ? ' · copia en ' + res.backupDir : ''), 'ok');
      if (st.openAfter) {
        const go = () => {
          const np = O.project.Project.fromFiles(plan.files, plan.rootPath, P.name);
          app.loadProject(np, { target: t, saved: true, recent: recentOf(t) });
        };
        // El contrato actual puede tener cambios sin guardar: se pregunta antes de cambiar de contrato.
        setTimeout(() => app.guarded(go), 0);
      }
      return true;
    } catch (e) {
      app.toast('Error al exportar: ' + e.message, 'error', 6000);
      return false;
    }
  }

  O.saveUI = { save, openExport, targetFromResult, describeTarget, setTarget };
})();
