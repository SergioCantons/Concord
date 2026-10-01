/* Configuración de validación que viaja con el contrato (.concord/): ajustes de las reglas de serie y conjuntos de reglas propios. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./util.js'), require('./vendor.js'), require('./validate.js'));
  else { root.OAT = root.OAT || {}; root.OAT.ruleconfig = factory(root.OAT.util, root.OAT.vendor, root.OAT.validate); }
})(typeof self !== 'undefined' ? self : this, function (U, vendor, V) {
  'use strict';
  const YAML = vendor.YAML;
  const CONFIG_FILE = '.concord/validation.yaml';
  const RULESETS_DIR = '.concord/rulesets/';
  const HEADER = '# Configuración de validación de Concord (se guarda junto al contrato).\n' +
    '# rules: severidad de las reglas de serie (error | warning | info | off).\n' +
    '# rulesets: estado de los conjuntos de .concord/rulesets/ (enabled) y severidad por regla.\n';

  function spectralLib() {
    if (typeof self !== 'undefined' && self.OAT && self.OAT.spectral) return self.OAT.spectral;
    return require('./spectral.js');
  }

  const isRulesetPath = (p) => p.startsWith(RULESETS_DIR) && /\.(ya?ml|json)$/i.test(p);
  const sevOrNull = (v) => (V.SEVERITIES.includes(v) ? v : null);
  function cleanRules(obj) {
    const out = {};
    if (U.isObj(obj)) for (const k of Object.keys(obj)) { const s = sevOrNull(obj[k]); if (s) out[k] = s; }
    return out;
  }

  /** Lee .concord/validation.yaml. `exists` indica si el contrato ya tiene configuración propia. */
  function readConfig(project) {
    const text = project.extras.get(CONFIG_FILE);
    const cfg = { exists: text !== undefined, rules: {}, rulesets: {}, error: null };
    if (text === undefined) return cfg;
    let data;
    try { data = YAML.parse(text); } catch (e) { cfg.error = 'No se pudo leer ' + CONFIG_FILE + ': ' + e.message; return cfg; }
    if (!U.isObj(data)) return cfg;
    cfg.rules = cleanRules(data.rules);
    if (U.isObj(data.rulesets)) {
      for (const file of Object.keys(data.rulesets)) {
        const v = data.rulesets[file];
        cfg.rulesets[file] = { enabled: !(U.isObj(v) && v.enabled === false) && v !== false, rules: cleanRules(U.isObj(v) ? v.rules : null) };
      }
    }
    return cfg;
  }

  /** Escribe la configuración (solo lo que difiere de los valores por defecto). */
  function writeConfig(project, cfg) {
    const data = {};
    const rules = {};
    for (const r of V.BUILTIN_RULES) if (!r.locked && cfg.rules[r.id] && cfg.rules[r.id] !== r.severity) rules[r.id] = cfg.rules[r.id];
    data.rules = rules;
    const sets = {};
    for (const file of Object.keys(cfg.rulesets || {}).sort()) {
      if (!project.extras.has(file)) continue;
      const s = cfg.rulesets[file];
      const entry = { enabled: s.enabled !== false };
      if (s.rules && Object.keys(s.rules).length) entry.rules = s.rules;
      sets[file] = entry;
    }
    data.rulesets = sets;
    project.setExtra(CONFIG_FILE, HEADER + YAML.stringify(data, { lineWidth: 0 }));
  }

  const parseCache = new Map();
  function parseCached(path, text) {
    const key = path + '\u0000' + text;
    if (!parseCache.has(key)) {
      if (parseCache.size > 50) parseCache.clear();
      let rs;
      try { rs = spectralLib().parseRuleset(text, U.basename(path)); } catch (e) { rs = { ok: false, name: U.basename(path), rules: [], errors: [e.message], unsupported: [] }; }
      parseCache.set(key, rs);
    }
    return parseCache.get(key);
  }

  /** Conjuntos de reglas del contrato con su estado. */
  function listRulesets(project, cfg) {
    cfg = cfg || readConfig(project);
    const out = [];
    for (const [path, text] of project.extras) {
      if (!isRulesetPath(path)) continue;
      const st = cfg.rulesets[path] || { enabled: true, rules: {} };
      const ruleset = parseCached(path, text);
      out.push({ id: path, name: ruleset.name || U.basename(path), text, ruleset, enabled: st.enabled !== false, rules: st.rules || {} });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Configuración para validateProject: la del contrato o, si no tiene, los ajustes antiguos del navegador. */
  function validationConfig(project, legacySettings) {
    const cfg = readConfig(project);
    return { rules: cfg.exists ? cfg.rules : V.legacyRules(legacySettings), rulesets: listRulesets(project, cfg) };
  }

  /** Ruta libre dentro de .concord/rulesets/ para un nombre dado. */
  function rulesetPathFor(project, name) {
    const base = RULESETS_DIR + (U.slug(name) || 'reglas');
    let p = base + '.yaml'; let i = 2;
    while (project.extras.has(p)) p = base + '-' + i++ + '.yaml';
    return p;
  }

  return { CONFIG_FILE, RULESETS_DIR, readConfig, writeConfig, listRulesets, validationConfig, rulesetPathFor, isRulesetPath };
});
