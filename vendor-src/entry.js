// Punto de entrada de las dependencias empaquetadas (ver scripts/build-vendor.js).
const YAML = require('yaml');
const Ajv8 = require('ajv');
const Ajv04 = require('ajv-draft-04');
const addFormats = require('ajv-formats');
const schemas = require('@apidevtools/openapi-schemas');
const fflate = require('fflate');
const { JSONPath } = require('jsonpath-plus');

module.exports = {
  YAML,
  Ajv8: Ajv8.default || Ajv8,
  Ajv: Ajv04.default || Ajv04,
  addFormats: addFormats.default || addFormats,
  JSONPath,
  fflate,
  oas30Schema: schemas.openapi.v3
};
