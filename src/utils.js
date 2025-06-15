'use strict';

function isDate(val) {
  return Object.prototype.toString.call(val) === '[object Date]';
}

function isObject(val) {
  return val && typeof val === 'object' && !Array.isArray(val) && !isDate(val);
}

function isIsoDateString(val) {
  return typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(val);
}

function exists(val) {
  return val !== null && val !== undefined && val !== '';
}

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
    for (let key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!isEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

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

function getValueByPath(obj, path) {
  if (!obj) {
    return undefined;
  }
  return path.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), obj);
}

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

function diffSimpleArray(beforeArr, afterArr) {
  const beforeSet = new Set(beforeArr || []);
  const afterSet = new Set(afterArr || []);
  const added = [...afterSet].filter((x) => !beforeSet.has(x));
  const removed = [...beforeSet].filter((x) => !afterSet.has(x));
  return { added, removed };
}

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
