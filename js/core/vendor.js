/* Acceso a las dependencias empaquetadas: navegador (OATVendor) o Node (vendor-src/entry.js). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../../vendor-src/entry.js'));
  else { root.OAT = root.OAT || {}; root.OAT.vendor = factory(root.OATVendor); }
})(typeof self !== 'undefined' ? self : this, function (v) { return v; });
