'use strict';

/**
 * Check if a value is a Date object.
 * @param {*} val - The value to check.
 * @returns {boolean} True if the value is a Date object, false otherwise.
 */
function isDate(val) {
  return Object.prototype.toString.call(val) === '[object Date]';
}

/**
 * Check if a value is a plain object (not an array, not a Date, not null).
 * @param {*} val - The value to check.
 * @returns {boolean} True if the value is a plain object, false otherwise.
 */
function isObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val) && !isDate(val);
}

/**
 * Check if a string is an ISO date string (e.g., '2020-01-01T00:00:00.000Z').
 * @param {string} val - The string to check.
 * @returns {boolean} True if the string is an ISO date string, false otherwise.
 */
function isIsoDateString(val) {
  return typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(val);
}

/**
 * Check if a value "exists" (not null, not undefined, not empty string).
 * @param {*} val - The value to check.
 * @returns {boolean} True if the value exists, false otherwise.
 */
function exists(val) {
  return val !== null && val !== undefined && val !== '';
}

/**
 * Deep equality check for two values (primitives, arrays, objects, dates).
 * @param {*} a - First value.
 * @param {*} b - Second value.
 * @returns {boolean} True if values are deeply equal, false otherwise.
 */
function isEqual(a, b) {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!isEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (isObject(a) && isObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!isEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

/**
 * Deep equality check for two values, with special handling for null/undefined and type coercion.
 * @param {*} a - First value.
 * @param {*} b - Second value.
 * @returns {boolean} True if values are considered equal, false otherwise.
 */
function areValuesEqual(a, b) {
  if (a === null && b === null) {
    return true;
  }
  if (a === undefined && b === undefined) {
    return true;
  }
  if (a === null || b === null || a === undefined || b === undefined) {
    return false;
  }

  if (isDate(a) && isDate(b)) {
    return a.getTime() === b.getTime();
  }

  if (isDate(a) && typeof b === 'string') {
    return a.toISOString() === b;
  }

  if (typeof a === 'string' && isDate(b)) {
    return a === b.toISOString();
  }

  if (typeof a === 'number' && typeof b === 'string') {
    return false;
  }
  if (typeof a === 'string' && typeof b === 'number') {
    return false;
  }
  if (typeof a === 'boolean' && typeof b === 'string') {
    return false;
  }
  if (typeof a === 'string' && typeof b === 'boolean') {
    return false;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    return isEqual(a, b);
  }

  if (isObject(a) && isObject(b)) {
    return isEqual(a, b);
  }

  return a === b;
}

/**
 * Get a value from an object using dot notation.
 * @param {Object} obj - The object to query.
 * @param {string} path - The dot-notated path (e.g., 'a.b.c').
 * @returns {*} The value at the given path, or undefined if not found.
 */
function getValueByPath(obj, path) {
  if (!obj) {
    return undefined;
  }
  return path.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), obj);
}

/**
 * Convert an array of objects to a map using a key field.
 * @param {Array} arr - The array of objects.
 * @param {string} key - The key field to use for mapping.
 * @returns {Object} A map of key to object.
 */
function arrayToKeyMap(arr, key) {
  const map = {};
  if (!Array.isArray(arr)) {
    return map;
  }

  for (const item of arr) {
    if (item && item[key]) {
      map[item[key]] = item;
    }
  }

  return map;
}

/**
 * Compute the difference between two simple arrays (added and removed items).
 * @param {Array} beforeArr - The array before change.
 * @param {Array} afterArr - The array after change.
 * @returns {Object} An object with 'added' and 'removed' arrays.
 */
function diffSimpleArray(beforeArr, afterArr) {
  const beforeSet = new Set(beforeArr || []);
  const afterSet = new Set(afterArr || []);
  const added = [...afterSet].filter((x) => !beforeSet.has(x));
  const removed = [...beforeSet].filter((x) => !afterSet.has(x));
  return { added, removed };
}

/**
 * Set a value in an object using dot notation, creating intermediate objects as needed.
 * @param {Object} obj - The object to modify.
 * @param {string} path - The dot-notated path (e.g., 'a.b.c').
 * @param {*} value - The value to set.
 */
function setByPath(obj, path, value) {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

/**
 * Convert a value to a string for logging.
 * @param {*} val - The value to convert.
 * @returns {string|null|undefined} The stringified value, or null/undefined if input is null/undefined.
 */
function valueToString(val) {
  if (val === null || val === undefined) {
    return val;
  }

  if (val instanceof Date) {
    return val.toISOString();
  }

  if (isIsoDateString(val)) {
    return val;
  }

  if (typeof val === 'object') {
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  }

  return String(val);
}

module.exports = {
  isDate,
  isObject,
  isIsoDateString,
  exists,
  isEqual,
  areValuesEqual,
  getValueByPath,
  arrayToKeyMap,
  diffSimpleArray,
  setByPath,
  valueToString,
};
