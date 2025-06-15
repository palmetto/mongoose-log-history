'use strict';

const zlib = require('zlib');

/**
 * Decompress a gzip-compressed Buffer and return the original JavaScript object.
 * Used for decompressing `original_doc` and `updated_doc` when `compressDocs` is enabled.
 * @param {Buffer|any} buffer - The compressed data (Buffer). If not a Buffer, returns as-is.
 * @returns {Object|null} The decompressed JavaScript object, or null if input is falsy.
 */
function decompressObject(buffer) {
  if (!buffer) return null;
  if (Buffer.isBuffer(buffer)) {
    const json = zlib.gunzipSync(buffer).toString();
    return JSON.parse(json);
  }
  return buffer;
}

/**
 * Compress a JavaScript object using gzip.
 * @param {Object} obj - The object to compress.
 * @returns {Buffer|null} The compressed Buffer, or null if input is falsy.
 */
function compressObject(obj) {
  if (!obj) return null;
  const json = JSON.stringify(obj);
  return zlib.gzipSync(json);
}

/**
 * Parse a human time string (e.g., '2h', '1d', '1M', '1y') to a Date.
 * @param {string|Date|number} str
 * @returns {Date|null}
 */
function parseHumanTime(str) {
  if (str instanceof Date) return str;
  if (typeof str === 'number') return new Date(str);
  if (typeof str !== 'string') return null;
  const match = str.match(/^(\d+)([smhdwMy])$/);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  const unit = match[2];
  const now = Date.now();
  let ms = 0;
  switch (unit) {
    case 's':
      ms = num * 1000;
      break;
    case 'm':
      ms = num * 60 * 1000;
      break;
    case 'h':
      ms = num * 60 * 60 * 1000;
      break;
    case 'd':
      ms = num * 24 * 60 * 60 * 1000;
      break;
    case 'w':
      ms = num * 7 * 24 * 60 * 60 * 1000;
      break;
    case 'M':
      ms = num * 30 * 24 * 60 * 60 * 1000;
      break;
    case 'y':
      ms = num * 365 * 24 * 60 * 60 * 1000;
      break;
    default:
      return null;
  }
  return new Date(now - ms);
}

module.exports = { compressObject, decompressObject, parseHumanTime };
