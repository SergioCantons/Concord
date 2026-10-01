/* Panel de validación: diagnósticos con fichero, línea, ruta YAML y acción sugerida. */
(function () {
  'use strict';
  const O = (window.OAT = window.OAT || {});
  const { h, icon, iconBtn, btn } = O.dom;

  function create(app) {
    const el = h('section', { class: 'validation', id: 'validation', 'aria-label': 'Validación' });
    const state = { filters: { error: true, warning: true, info: true }, q: '', limit: 200 };
    let last = null;
    let running = false;

    const title = h('h3', null, icon('shield-check'), 'Validación');
    const chips = h('div', { class: 'chips-bar' });
    const spinner = h('span', { class: 'spinner', role: 'status', 'aria-label': 'Validando', style: { display: 'none' } }, icon('loader'));
    const filter = h('input', { type: 'search', placeholder: 'Filtrar...', 'aria-label': 'Filtrar diagnósticos', class: 'mini-search' });
    filter.addEventListener('input', () => { state.q = filter.value.trim().toLowerCase(); state.limit = 200; renderList(); });
    const live = h('input', { type: 'checkbox', checked: app.settings.liveValidation, 'aria-label': 'Validar al editar' });
    live.addEventListener('change', () => { app.setSetting('liveValidation', live.checked); if (live.checked) app.validate(); });
    const toggle = iconBtn('chevron-down', 'Mostrar u ocultar el panel', () => app.togglePanel(), 'panel-toggle');
    const head = h('div', { class: 'panel-head' }, title, chips, spinner, h('span', { class: 'spacer' }), filter,
      h('label', { class: 'check compact' }, live, h('span', null, 'Al editar')),
      btn('Reglas', () => app.openRules(), 'small', 'list'),
      btn('Validar', () => app.validate(true), 'small', 'refresh-cw'), toggle);
    const list = h('div', { class: 'diag-list', role: 'list' });
    el.append(head, list);

    function renderChips() {
      chips.textContent = '';
      const s = last ? last.stats : { errors: 0, warnings: 0, infos: 0 };
      [['error', s.errors, 'alert-circle', 'errores'], ['warning', s.warnings, 'alert-triangle', 'avisos'], ['info', s.infos, 'info', 'info']].forEach(([k, n, ic, label]) => {
        chips.appendChild(h('button', { type: 'button', class: 'sev-chip sev-' + k + (state.filters[k] ? ' on' : ''), 'aria-pressed': state.filters[k] ? 'true' : 'false', title: 'Mostrar/ocultar ' + label, onclick: () => { state.filters[k] = !state.filters[k]; renderChips(); renderList(); } }, icon(ic), h('span', null, n + ' ' + label)));
      });
      if (last && last.stale) chips.appendChild(h('span', { class: 'badge warn' }, 'Desactualizada'));
    }
    function renderList() {
      list.textContent = '';
      if (!last) { list.appendChild(h('p', { class: 'muted pad' }, running ? 'Validando...' : 'Sin resultados de validación todavía.')); return; }
      const rows = last.diagnostics.filter((d) => state.filters[d.severity] && (!state.q || (d.message + ' ' + (d.file || '') + ' ' + d.category + ' ' + (d.code || '')).toLowerCase().includes(state.q)));
      if (!rows.length) { list.appendChild(h('p', { class: 'ok-msg pad' }, icon('check'), last.diagnostics.length ? 'Ningún diagnóstico con estos filtros.' : 'Sin problemas detectados.')); return; }
      rows.slice(0, state.limit).forEach((d) => {
        const fix = d.fix && d.fix.type === 'add-path-param' && d.jsPath ? btn('Corregir', (e) => { e.stopPropagation(); app.edit('Añadir parámetro de ruta ' + d.fix.name, (tx) => tx.push(d.jsPath.concat(['parameters']), { name: d.fix.name, in: 'path', required: true, schema: { type: 'string' } }), { rerender: true }); }, 'small', 'check') : null;
        const row = h('div', { class: 'diag sev-' + d.severity, role: 'listitem', tabindex: 0 },
          h('span', { class: 'diag-ic' }, icon(d.severity === 'error' ? 'alert-circle' : d.severity === 'warning' ? 'alert-triangle' : 'info')),
          h('div', { class: 'diag-main' },
            h('div', { class: 'diag-msg' }, d.message),
            h('div', { class: 'diag-loc' }, h('span', { class: 'badge kind' }, d.category), d.ruleset && d.code ? h('span', { class: 'badge ref', title: 'Regla de conjunto propio' }, d.code) : null, d.file ? h('code', null, d.file + (d.line ? ':' + d.line + ':' + d.col : '')) : null, d.path && d.path.length ? h('code', { class: 'muted' }, O.util.fmtPath(d.path)) : null),
            d.suggestion ? h('div', { class: 'diag-sug' }, d.suggestion) : null),
          h('div', { class: 'diag-actions' }, fix, iconBtn('file-code', 'Ver en el YAML', (e) => { e.stopPropagation(); app.gotoDiagnostic(d, 'yaml'); }), iconBtn('crosshair', 'Ir al elemento en el formulario', (e) => { e.stopPropagation(); app.gotoDiagnostic(d, 'form'); })));
        row.addEventListener('click', () => app.gotoDiagnostic(d, 'yaml'));
        row.addEventListener('keydown', (e) => { if (e.key === 'Enter') app.gotoDiagnostic(d, 'yaml'); });
        list.appendChild(row);
      });
      if (rows.length > state.limit) list.appendChild(h('button', { type: 'button', class: 'more-btn', onclick: () => { state.limit += 200; renderList(); } }, 'Mostrar más (' + (rows.length - state.limit) + ')'));
    }

    return {
      el,
      update(result, isRunning) {
        last = result || last; running = !!isRunning;
        spinner.style.display = running ? '' : 'none';
        live.checked = app.settings.liveValidation;
        renderChips(); renderList();
      },
      markStale() { if (last && !last.stale) { last.stale = true; renderChips(); } },
      setCollapsed(c) { el.classList.toggle('collapsed', c); toggle.classList.toggle('flip', c); },
      last: () => last
    };
  }

  O.validationPanel = { create };
})();
