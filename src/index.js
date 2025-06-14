/**
 * @author Granite Bagas
 * @description Plugin to log history if model changes
 *
 * This Mongoose plugin automatically tracks and logs changes to specified fields
 * in documents. It monitors create, update, and bulk insert operations, saving
 * detailed audit logs to a 'log_histories' collection.
 *
 * @param {Object} schema - The Mongoose schema to apply the plugin to
 * @param {Object} options - Plugin configuration options
 *
 * OPTIONS:
 *
 * @param {string} [options.modelName] - Model identification (optional, defaults to the model name)
 * @param {string} [options.modelKeyId] - ID key that identifies the model. Will be the ID of the model (optional, defaults to _id)
 *
 * @param {Object} [options.softDelete] - Soft delete config (optional)
 * @param {string} options.softDelete.field - Soft delete field
 * @param {string} options.softDelete.value - Soft delete field value to be considered deleted
 *
 * @param {Array} [options.contextFields] - List of additional fields to inject into the log (array of field paths from the document itself; must be an array at the plugin level)
 *
 * @param {Boolean} [options.singleCollection=false] - Whether to log using a single collection ('log_histories') or per-model collection ('log_histories_{modelName}'). Default is false
 *
 * @param {Boolean} [options.saveWholeDoc=false] - Whether to save the original and the updated document. Default is false
 *
 * @param {Number} [options.maxBatchLog=1000] - Maximum number of documents to process in bulk hooks (insertMany, updateMany, deleteMany). Default is 1000
 * @param {Number} [options.batchSize=100] - Number of documents to process per batch in bulk hooks. Default is 100
 *
 * @param {Object} [options.logger=console] - Custom logger object (must support .error and .warn methods)
 *
 * @param {Array} [options.trackedFields=[]] - Array of field configurations to track
 * @param {string} options.trackedFields[].value - Field path (supports dot notation)
 * @param {string} [options.trackedFields[].arrayType] - Array handling type: 'simple' | 'custom-key'
 * @param {string} [options.trackedFields[].arrayKey] - Identifier/key field for the object inside the array. Used in 'custom-key'
 * @param {string} [options.trackedFields[].valueField] - Key field of the object inside array to track. Used in 'custom-key'
 * @param {Array|Object} [options.trackedFields[].contextFields]
 *   - Additional fields to inject into the log for this field.
 *   - If an array, fields are extracted from the document itself.
 *   - If an object, it can have:
 *     - `doc`: array of field paths from the document itself
 *     - `item`: array of field paths from the array item (for arrays of objects)
 * @param {Array} [options.trackedFields[].trackedFields] - Additional nested fields on the object inside array to track. Used in 'custom-key'
 */

'use strict';

const mongoose = require('mongoose');
const zlib = require('zlib');

// ============================================================================
// MODEL DECLARATION
// ============================================================================

const logSchema = new mongoose.Schema({
  field_name: String,
  from_value: String,
  to_value: String,
  change_type: {
    type: String,
    enum: ['add', 'edit', 'remove'],
    default: 'edit',
  },
  context: mongoose.Schema.Types.Mixed,
});

const logHistorySchema = new mongoose.Schema(
  {
    model: { type: String }, // for single collection support
    model_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    change_type: {
      type: String,
      enum: ['create', 'delete', 'update'],
      default: 'update',
      required: true,
    },
    logs: { type: [logSchema], default: [] },
    created_by: {
      id: mongoose.Schema.Types.ObjectId,
      name: String,
      role: String,
    },
    context: mongoose.Schema.Types.Mixed,
    original_doc: mongoose.Schema.Types.Mixed, // original document
    updated_doc: mongoose.Schema.Types.Mixed, // updated document
    is_deleted: { type: Boolean, default: false },
  },
  {
    timestamps: {
      createdAt: 'created_at',
      updatedAt: false,
    },
  }
);

// ============================================================================
// TYPE CHECKING UTILITIES
// ============================================================================

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

// ============================================================================
// VALUE COMPARISON UTILITIES
// ============================================================================

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

// ============================================================================
// DATA MANIPULATION UTILITIES
// ============================================================================

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

// ============================================================================
// FORMATTING UTILITIES
// ============================================================================

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

// ============================================================================
// LOG CONTEXT EXCTRACTION
// ============================================================================

function extractLogContext(contextFields, originalDoc, updatedDoc, beforeItem = null, afterItem = null) {
  let context = undefined;
  if (contextFields) {
    context = {};

    if (Array.isArray(contextFields)) {
      context.doc = {};
      for (const ctxField of contextFields) {
        const ctxValue = getValueByPath(updatedDoc, ctxField) || getValueByPath(originalDoc, ctxField);
        setByPath(context.doc, ctxField, ctxValue);
      }
    } else if (contextFields.doc) {
      context.doc = {};
      for (const ctxField of contextFields.doc) {
        const ctxValue = getValueByPath(updatedDoc, ctxField) || getValueByPath(originalDoc, ctxField);
        setByPath(context.doc, ctxField, ctxValue);
      }
    }
    if (contextFields.item && Array.isArray(contextFields.item)) {
      context.item = {};
      const item = afterItem || beforeItem;
      for (const ctxField of contextFields.item) {
        const ctxValue = getValueByPath(item, ctxField);
        setByPath(context.item, ctxField, ctxValue);
      }
    }
  }

  return context;
}

// ============================================================================
// CHANGE TRACKING
// ============================================================================

function processGenericFieldChanges(field, beforeValue, afterValue, originalDoc, updatedDoc) {
  const log = [];
  const path = field.value;
  const beforeExists = exists(beforeValue);
  const afterExists = exists(afterValue);

  const beforeStr = valueToString(beforeValue);
  const afterStr = valueToString(afterValue);

  const context = extractLogContext(field.contextFields, originalDoc, updatedDoc);

  if (!beforeExists && !afterExists) {
    return log;
  }
  if (!beforeExists && afterExists) {
    log.push({
      field_name: path,
      from_value: beforeStr,
      to_value: afterStr,
      change_type: 'add',
      ...(context ? { context } : {}),
    });
    return log;
  }
  if (beforeExists && !afterExists) {
    log.push({
      field_name: path,
      from_value: beforeStr,
      to_value: afterStr,
      change_type: 'remove',
      ...(context ? { context } : {}),
    });
    return log;
  }
  if (!areValuesEqual(beforeValue, afterValue)) {
    log.push({
      field_name: path,
      from_value: beforeStr,
      to_value: afterStr,
      change_type: 'edit',
      ...(context ? { context } : {}),
    });
  }
  return log;
}

function processSimpleArrayChanges(field, beforeValue, afterValue, originalDoc, updatedDoc, parentFieldName = null) {
  const log = [];
  const { added, removed } = diffSimpleArray(beforeValue, afterValue);

  const fieldName = parentFieldName || field.value;

  const context = extractLogContext(field.contextFields, originalDoc, updatedDoc);

  for (const item of added) {
    log.push({
      field_name: fieldName,
      from_value: null,
      to_value: valueToString(item),
      change_type: 'add',
      ...(context ? { context } : {}),
    });
  }
  for (const item of removed) {
    log.push({
      field_name: fieldName,
      from_value: valueToString(item),
      to_value: null,
      change_type: 'remove',
      ...(context ? { context } : {}),
    });
  }
  return log;
}

function processCustomKeyArrayChanges(field, beforeValue, afterValue, originalDoc, updatedDoc, parentFieldName = null) {
  const log = [];
  const beforeMap = arrayToKeyMap(beforeValue, field.arrayKey);
  const afterMap = arrayToKeyMap(afterValue, field.arrayKey);
  const allKeys = new Set([...Object.keys(beforeMap), ...Object.keys(afterMap)]);

  const fieldName = parentFieldName || field.value;

  for (const key of allKeys) {
    const beforeItem = beforeMap[key];
    const afterItem = afterMap[key];
    const beforeExists = exists(beforeItem);
    const afterExists = exists(afterItem);

    const fromValue = beforeItem && field.valueField ? valueToString(beforeItem[field.valueField]) : undefined;
    const toValue = afterItem && field.valueField ? valueToString(afterItem[field.valueField]) : undefined;

    const context = extractLogContext(field.contextFields, originalDoc, updatedDoc, beforeItem, afterItem);

    if (!beforeExists && !afterExists) {
      continue;
    }
    if (!beforeExists && afterExists) {
      log.push({
        field_name: fieldName,
        from_value: null,
        to_value: toValue,
        change_type: 'add',
        ...(context ? { context } : {}),
      });
      continue;
    }
    if (beforeExists && !afterExists) {
      log.push({
        field_name: fieldName,
        from_value: fromValue,
        to_value: null,
        change_type: 'remove',
        ...(context ? { context } : {}),
      });
      continue;
    }
    if (beforeExists && afterExists && Array.isArray(field.trackedFields)) {
      log.push(...processSubFieldChanges(field, beforeItem, afterItem, originalDoc, updatedDoc, fieldName));
    }
  }
  return log;
}

function processSubFieldChanges(field, beforeItem, afterItem, originalDoc, updatedDoc, parentFieldName = null) {
  const log = [];
  for (const subField of field.trackedFields) {
    const subPath = subField.value;
    const beforeVal = getValueByPath(beforeItem, subPath);
    const afterVal = getValueByPath(afterItem, subPath);

    const fieldName = `${parentFieldName || field.value}.${subPath}`;

    if (subField.arrayType === 'simple') {
      log.push(...processSimpleArrayChanges(subField, beforeVal, afterVal, beforeItem, afterItem, fieldName));
    } else if (subField.arrayType === 'custom-key' && subField.arrayKey) {
      log.push(...processCustomKeyArrayChanges(subField, beforeVal, afterVal, beforeItem, afterItem, fieldName));
    } else {
      const beforeSubExists = exists(beforeVal);
      const afterSubExists = exists(afterVal);

      const beforeStr = valueToString(beforeVal);
      const afterStr = valueToString(afterVal);

      const context = extractLogContext(field.contextFields, originalDoc, updatedDoc, beforeItem, afterItem);

      if (!beforeSubExists && !afterSubExists) {
        continue;
      }
      if (!beforeSubExists && afterSubExists) {
        log.push({
          field_name: fieldName,
          from_value: beforeStr,
          to_value: afterStr,
          change_type: 'add',
          ...(context ? { context } : {}),
        });
        continue;
      }
      if (beforeSubExists && !afterSubExists) {
        log.push({
          field_name: fieldName,
          from_value: beforeStr,
          to_value: afterStr,
          change_type: 'remove',
          ...(context ? { context } : {}),
        });
        continue;
      }
      if (!areValuesEqual(beforeVal, afterVal)) {
        log.push({
          field_name: fieldName,
          from_value: beforeStr,
          to_value: afterStr,
          change_type: 'edit',
          ...(context ? { context } : {}),
        });
      }
    }
  }
  return log;
}

// ============================================================================
// MAIN CHANGE TRACKING FUNCTION
// ============================================================================

function getTrackedChanges(original, updated, trackedFields) {
  const log = [];
  for (const field of trackedFields) {
    const path = field.value;
    const beforeValue = getValueByPath(original, path);
    const afterValue = getValueByPath(updated, path);

    let fieldChanges = [];
    if (field.arrayType === 'simple') {
      fieldChanges = processSimpleArrayChanges(field, beforeValue, afterValue, original, updated);
    } else if (field.arrayType === 'custom-key' && field.arrayKey) {
      fieldChanges = processCustomKeyArrayChanges(field, beforeValue, afterValue, original, updated);
    } else {
      fieldChanges = processGenericFieldChanges(field, beforeValue, afterValue, original, updated);
    }
    log.push(...fieldChanges);
  }
  return log;
}

function buildLogEntry(
  model_id,
  model_name,
  change_type,
  logs,
  created_by,
  original_doc = null,
  updated_doc = null,
  context = null,
  saveWholeDoc = false,
  compressDocs = false
) {
  return {
    model: model_name,
    model_id,
    change_type,
    logs,
    created_by,
    ...(context ? { context } : {}),
    ...(saveWholeDoc
      ? {
          original_doc:
            compressDocs && original_doc
              ? compressObject(original_doc)
              : original_doc
                ? JSON.parse(JSON.stringify(original_doc))
                : null,
          updated_doc:
            compressDocs && updated_doc
              ? compressObject(updated_doc)
              : updated_doc
                ? JSON.parse(JSON.stringify(updated_doc))
                : null,
        }
      : {}),
    is_deleted: false,
  };
}

function getLogHistoryModel(modelName, singleCollection = false) {
  const collectionName = singleCollection ? 'log_histories' : `log_histories_${modelName}`;
  const modelKey = singleCollection ? 'LogHistory' : `LogHistory_${modelName}`;
  if (mongoose.models[modelKey]) {
    return mongoose.models[modelKey];
  }
  return mongoose.model(modelKey, logHistorySchema, collectionName);
}

// ============================================================================
// PRUNE LOG HISTORY FUNCTION
// ============================================================================

/**
 * Prune log history entries.
 * @param {Object} options
 * @param {string} [options.modelName] - Model name (for per-model collections)
 * @param {boolean} [options.singleCollection] - Use single collection or per-model
 * @param {Date|string|number} [options.before] - Delete logs created before this date or time string (e.g., '2h', '1d')
 * @param {number} [options.keepLast] - Keep only the last N logs per model_id
 * @param {string|ObjectId} [options.modelId] - Only delete logs for this document
 * @returns {Promise<number>} - Number of deleted logs
 */
async function pruneLogHistory({ modelName, singleCollection = false, before, keepLast, modelId }) {
  const LogHistory = getLogHistoryModel(modelName, singleCollection);

  const query = {};
  if (before) {
    const beforeDate = parseHumanTime(before);
    if (beforeDate) query.created_at = { $lt: beforeDate };
  }
  if (modelId) {
    query.model_id = modelId;
  }

  if (keepLast) {
    const ids = modelId ? [modelId] : await LogHistory.distinct('model_id', query);
    let totalDeleted = 0;
    for (const id of ids) {
      const docs = await LogHistory.find({ ...query, model_id: id })
        .sort({ created_at: -1 })
        .skip(keepLast)
        .select('_id');
      if (docs.length) {
        const res = await LogHistory.deleteMany({
          _id: { $in: docs.map((d) => d._id) },
        });
        totalDeleted += res.deletedCount || 0;
      }
    }
    return totalDeleted;
  } else {
    const res = await LogHistory.deleteMany(query);
    return res.deletedCount || 0;
  }
}

class ChangeLogPlugin {
  constructor(options) {
    this.modelName = options.modelName;
    this.modelKeyId = options.modelKeyId || '_id';
    this.trackedFields = options.trackedFields || [];
    this.contextFields = options.contextFields || [];
    this.softDelete = options.softDelete || null;
    this.singleCollection = options.singleCollection === true;
    this.saveWholeDoc = options.saveWholeDoc === true;
    this.maxBatchLog = options.maxBatchLog || 1000;
    this.batchSize = options.batchSize || 100;
    this.logger = options.logger || console;
    this.userField = options.userField || 'created_by';
    this.compressDocs = options.compressDocs === true;
  }

  static ensureIndex() {
    const index = { model: 1, model_id: 1, is_deleted: 1, created_at: -1 };
    logHistorySchema.index(index);
  }

  ensureModelName(model) {
    if (!this.modelName) {
      this.modelName = model.modelName || model.constructor.modelName;
    }
  }

  getLogHistoryModelPlugin() {
    return getLogHistoryModel(this.modelName, this.singleCollection);
  }

  // ============================================================================
  // USER FIELD EXTRACTION
  // ============================================================================

  extractUser({ doc, context, userField }) {
    if (context && userField) {
      const userFromContext = getValueByPath(context, userField);
      if (userFromContext !== undefined && userFromContext !== null) {
        return userFromContext;
      }
    }

    if (doc && userField) {
      const userFromDoc = getValueByPath(doc, userField);
      if (userFromDoc !== undefined && userFromDoc !== null) {
        return userFromDoc;
      }
    }

    if (doc && doc.created_by) return doc.created_by;
    if (doc && doc.updated_by) return doc.updated_by;
    if (doc && doc.modified_by) return doc.modified_by;
    return null;
  }

  // ============================================================================
  // UPDATE FIELD EXTRACTION
  // ============================================================================

  simulateAddToSet(originalArr, addArr, arrayKey) {
    if (!Array.isArray(originalArr)) {
      originalArr = [];
    }
    if (!Array.isArray(addArr)) {
      addArr = [addArr];
    }

    const result = [...originalArr];
    if (arrayKey) {
      const map = arrayToKeyMap(originalArr, arrayKey);
      for (const item of addArr) {
        if (!map[item[arrayKey]]) {
          result.push(item);
          map[item[arrayKey]] = item;
        }
      }
    } else {
      for (const item of addArr) {
        if (!result.some((x) => isEqual(x, item))) {
          result.push(item);
        }
      }
    }
    return result;
  }
  simulatePull(originalArr, pullQuery) {
    if (!Array.isArray(originalArr)) {
      return [];
    }

    if (typeof pullQuery !== 'object' || Array.isArray(pullQuery)) {
      return originalArr.filter((item) => !isEqual(item, pullQuery));
    }

    const keys = Object.keys(pullQuery);

    return originalArr.filter((item) => {
      for (const key of keys) {
        if (!isEqual(item[key], pullQuery[key])) {
          return true;
        }
      }
      return false;
    });
  }
  simulatePullAll(originalArr, pullAllArr) {
    if (!Array.isArray(originalArr)) {
      return [];
    }
    if (!Array.isArray(pullAllArr)) {
      pullAllArr = [pullAllArr];
    }
    return originalArr.filter((item) => !pullAllArr.some((val) => isEqual(item, val)));
  }
  extractUpdateFields(update, originalDoc) {
    const fields = {};

    if (!update) {
      return fields;
    }

    Object.keys(update).forEach((key) => {
      if (!key.startsWith('$')) {
        fields[key] = update[key];
      }
    });

    if (update.$set) {
      Object.assign(fields, update.$set);
    }
    if (update.$setOnInsert) {
      Object.assign(fields, update.$setOnInsert);
    }
    if (update.$unset) {
      Object.keys(update.$unset).forEach((key) => {
        fields[key] = undefined;
      });
    }

    for (const field of this.trackedFields) {
      const fieldName = field.value;
      const arrayKey = field.arrayKey;

      if (update.$addToSet && update.$addToSet[fieldName]) {
        const originalArr = getValueByPath(originalDoc, fieldName) || [];
        const addArr = update.$addToSet[fieldName].$each
          ? update.$addToSet[fieldName].$each
          : [update.$addToSet[fieldName]];
        fields[fieldName] = this.simulateAddToSet(originalArr, addArr, arrayKey);
      }

      if (update.$push && update.$push[fieldName]) {
        const originalArr = getValueByPath(originalDoc, fieldName) || [];
        const pushVal = update.$push[fieldName].$each ? update.$push[fieldName].$each : [update.$push[fieldName]];
        fields[fieldName] = originalArr.concat(pushVal);
      }

      if (update.$pull && update.$pull[fieldName]) {
        const originalArr = getValueByPath(originalDoc, fieldName) || [];
        const pullQuery = update.$pull[fieldName];
        fields[fieldName] = this.simulatePull(originalArr, pullQuery);
      }

      if (update.$pullAll && update.$pullAll[fieldName]) {
        const originalArr = getValueByPath(originalDoc, fieldName) || [];
        const pullAllArr = update.$pullAll[fieldName];
        fields[fieldName] = this.simulatePullAll(originalArr, pullAllArr);
      }

      if (update.$pop && update.$pop[fieldName] !== undefined) {
        const originalArr = getValueByPath(originalDoc, fieldName) || [];
        const popVal = update.$pop[fieldName];
        if (popVal === 1) {
          fields[fieldName] = originalArr.slice(0, -1);
        } else if (popVal === -1) {
          fields[fieldName] = originalArr.slice(1);
        } else {
          fields[fieldName] = originalArr;
        }
      }

      if (update.$inc && update.$inc[fieldName] !== undefined) {
        const orig = getValueByPath(originalDoc, fieldName) || 0;
        fields[fieldName] = orig + update.$inc[fieldName];
      }

      if (update.$mul && update.$mul[fieldName] !== undefined) {
        const orig = getValueByPath(originalDoc, fieldName) || 0;
        fields[fieldName] = orig * update.$mul[fieldName];
      }

      if (update.$min && update.$min[fieldName] !== undefined) {
        const orig = getValueByPath(originalDoc, fieldName);
        const minVal = update.$min[fieldName];
        fields[fieldName] = orig === undefined ? minVal : Math.min(orig, minVal);
      }

      if (update.$max && update.$max[fieldName] !== undefined) {
        const orig = getValueByPath(originalDoc, fieldName);
        const maxVal = update.$max[fieldName];
        fields[fieldName] = orig === undefined ? maxVal : Math.max(orig, maxVal);
      }
    }

    return fields;
  }

  // ============================================================================
  // LOG HISTORY MANAGEMENT
  // ============================================================================

  async saveLogHistory({ modelId, originalData, updatedData, changeType = 'update', user = null }) {
    let changes = [];
    let context = undefined;
    if (changeType === 'update') {
      changes = getTrackedChanges(originalData, updatedData, this.trackedFields);

      if (changes.length == 0) {
        return;
      }
    } else {
      context = extractLogContext(this.contextFields, originalData, updatedData);
    }

    try {
      const LogHistory = this.getLogHistoryModelPlugin();
      await LogHistory.create(
        buildLogEntry(
          modelId,
          this.modelName,
          changeType,
          changes,
          user,
          originalData,
          updatedData,
          context,
          this.saveWholeDoc,
          this.compressDocs
        )
      );
    } catch (err) {
      this.logger.error(
        err,
        `[pluginLogHistory: saveLogHistory] Failed to write log history. Model: ${this.modelName}. ID: ${modelId}.`
      );
    }
  }

  async saveLogHistoryBatch(logEntriesData) {
    const logEntries = logEntriesData
      .map((params) => {
        let changes = [];
        let context = undefined;
        if (params.changeType === 'update') {
          changes = getTrackedChanges(params.originalData, params.updatedData, this.trackedFields);
          if (!changes.length) {
            return null;
          }
        } else {
          context = extractLogContext(this.contextFields, params.originalData, params.updatedData);
        }

        return {
          insertOne: {
            document: buildLogEntry(
              params.modelId,
              this.modelName,
              params.changeType,
              changes,
              params.user,
              params.originalData,
              params.updatedData,
              context,
              this.saveWholeDoc,
              this.compressDocs
            ),
          },
        };
      })
      .filter(Boolean);

    if (!logEntries.length) {
      return;
    }

    try {
      const LogHistory = this.getLogHistoryModelPlugin();
      await LogHistory.bulkWrite(logEntries, { ordered: false });
    } catch (err) {
      this.logger.error(
        err,
        `[pluginLogHistory: saveLogHistoryBatch] Failed to write log history. Model: ${this.modelName}.`
      );
    }
  }

  // ============================================================================
  // BATCH PROCESS FUNCTION
  // ============================================================================

  async batchLogHistory(docs, processFn, operationName = 'batch', user = null) {
    const maxBatchLog = this.maxBatchLog || 1000;
    let processed = 0;
    let skipped = 0;
    let batch = [];

    for (const doc of docs) {
      if (processed >= maxBatchLog) {
        skipped++;
        continue;
      }
      batch.push(doc);
      processed++;
      if (batch.length >= this.batchSize) {
        await processFn(batch, user);
        batch = [];
      }
    }
    if (batch.length) {
      await processFn(batch, user);
    }
    if (skipped > 0) {
      this.logger.warn(
        `[ChangeLogPlugin:${operationName}] Skipped logging for ${skipped} documents (limit: ${maxBatchLog}) in model: ${this.modelName}`
      );
    }
  }

  // ============================================================================
  // MONGOOSE HOOKS
  // ============================================================================

  createPreUpdateHook() {
    const self = this;
    return async function preUpdateHook(next) {
      let modelId;
      try {
        self.ensureModelName(this.model || this.constructor);

        const query = this;
        const model = query.model;
        const filter = query.getFilter();
        const update = query.getUpdate();
        const options = query.getOptions() || {};
        const context = options.context || {};

        const trackedPaths = [...new Set(self.trackedFields.map((f) => f.value.split('.')[0]))];

        const originalDoc = await model.findOne(filter).select(trackedPaths.join(' ')).lean();

        const updateFields = self.extractUpdateFields(update, originalDoc);

        let isSoftDelete = false;
        const softDeleteConfig = self.softDelete || null;
        if (softDeleteConfig && updateFields) {
          const softDeleteFieldValue = getValueByPath(updateFields, softDeleteConfig.field);
          if (softDeleteFieldValue === softDeleteConfig.value) {
            isSoftDelete = true;
          }
        }

        const updatedData = { ...originalDoc, ...updateFields };

        modelId = getValueByPath(updatedData, self.modelKeyId);

        const user = self.extractUser({
          doc: updatedData,
          context,
          userField: self.userField,
        });

        if (!originalDoc && options.upsert) {
          await self.saveLogHistory({
            modelId,
            changeType: 'create',
            user,
            updatedData,
          });
          return next();
        }

        if (originalDoc) {
          await self.saveLogHistory({
            modelId,
            originalData: originalDoc,
            updatedData,
            changeType: 'update',
            user,
          });
        }

        if (isSoftDelete) {
          await self.saveLogHistory({
            modelId,
            originalData: originalDoc,
            updatedData,
            changeType: 'delete',
            user,
          });
          return next();
        }
      } catch (err) {
        self.logger.error(
          err,
          `[pluginLogHistory: preUpdateHook] Failed to write log history. Model: ${self.modelName}. ID: ${modelId}.`
        );
      } finally {
        next();
      }
    };
  }

  createPreSaveHook() {
    const self = this;
    return async function preSaveHook(next) {
      let modelId;
      try {
        self.ensureModelName(this.model || this.constructor);

        const doc = this;
        const isNew = doc.isNew;
        const user = self.extractUser({ doc, userField: self.userField });

        const trackedPaths = [...new Set(self.trackedFields.map((f) => f.value.split('.')[0]))];
        modelId = getValueByPath(doc, self.modelKeyId);

        if (isNew) {
          await self.saveLogHistory({
            modelId,
            changeType: 'create',
            user,
            updatedData: doc.toObject(),
          });
        } else {
          const originalDoc = await doc.constructor.findById(doc._id).select(trackedPaths.join(' ')).lean();

          if (!originalDoc) {
            return next();
          }

          await self.saveLogHistory({
            modelId,
            originalData: originalDoc,
            updatedData: doc.toObject(),
            changeType: 'update',
            user,
          });
        }
      } catch (err) {
        self.logger.error(
          err,
          `[pluginLogHistory: preSaveHook] Failed to write log history. Model: ${self.modelName}. ID: ${modelId}.`
        );
      } finally {
        next();
      }
    };
  }

  createPreInsertManyHook() {
    const self = this;
    return async function preInsertManyHook(next, docs) {
      try {
        self.ensureModelName(this.model || this.constructor);

        await self.batchLogHistory(
          docs,
          async (batch, user) => {
            const logEntryParams = [];
            for (const doc of batch) {
              const modelId = getValueByPath(doc, self.modelKeyId);
              const userData = self.extractUser({
                doc,
                userField: self.userField,
              });
              logEntryParams.push({
                modelId,
                changeType: 'create',
                updatedData: doc.toObject ? doc.toObject() : doc,
                user: userData,
              });
            }
            await self.saveLogHistoryBatch(logEntryParams);
          },
          'insertMany'
        );
      } catch (err) {
        self.logger.error(
          err,
          `[pluginLogHistory: preInsertManyHook] Failed to write log history. Model: ${self.modelName}.`
        );
      } finally {
        next();
      }
    };
  }

  createPreDeleteHook() {
    const self = this;
    return async function preDeleteHook(next) {
      try {
        self.ensureModelName(this.model || this.constructor);

        const query = this;
        const model = query.model;
        const filter = query.getFilter();
        const options = query.getOptions() || {};
        const context = options.context || {};

        const docs = await model.find(filter).lean();

        await self.batchLogHistory(
          docs,
          async (batch, user) => {
            const logEntryParamsArray = [];
            for (const doc of batch) {
              const modelId = getValueByPath(doc, self.modelKeyId);
              const userData = self.extractUser({
                doc,
                context,
                userField: self.userField,
              });
              logEntryParamsArray.push({
                modelId,
                originalData: doc,
                updatedData: null,
                changeType: 'delete',
                user: userData,
              });
            }
            await self.saveLogHistoryBatch(logEntryParamsArray);
          },
          'deleteMany'
        );
      } catch (err) {
        self.logger.error(
          err,
          `[pluginLogHistory: preDeleteHook] Failed to write log history. Model: ${self.modelName}.`
        );
      } finally {
        next();
      }
    };
  }

  createPreUpdateManyHook() {
    const self = this;
    return async function preUpdateManyHook(next) {
      try {
        self.ensureModelName(this.model || this.constructor);

        const query = this;
        const model = query.model;
        const filter = query.getFilter();
        const update = query.getUpdate();
        const options = query.getOptions() || {};
        const context = options.context || {};

        const trackedPaths = [...new Set(self.trackedFields.map((f) => f.value.split('.')[0]))];
        const docs = await model.find(filter).select(trackedPaths.join(' ')).lean();

        await self.batchLogHistory(
          docs,
          async (batch, user) => {
            const logEntryParams = [];
            for (const originalDoc of batch) {
              const updateFields = self.extractUpdateFields(update, originalDoc);
              const updatedData = { ...originalDoc, ...updateFields };
              const modelId = getValueByPath(updatedData, self.modelKeyId);

              const userData = self.extractUser({
                doc: updatedData,
                context,
                userField: self.userField,
              });

              logEntryParams.push({
                modelId,
                changeType: 'update',
                originalData: originalDoc,
                updatedData,
                user: userData,
              });
            }
            await self.saveLogHistoryBatch(logEntryParams);
          },
          'updateMany'
        );
      } catch (err) {
        self.logger.error(
          err,
          `[pluginLogHistory: preUpdateManyHook] Failed to write log history. Model: ${self.modelName}.`
        );
      } finally {
        next();
      }
    };
  }
}

// ============================================================================
// VALIDATION FUNCTION
// ============================================================================

function validateTrackedField(field, path = 'trackedFields') {
  if (!field || typeof field !== 'object') {
    throw new Error(`[mongoose-log-history] Each entry in ${path} must be an object.`);
  }
  if (!field.value || typeof field.value !== 'string') {
    throw new Error(`[mongoose-log-history] Each entry in ${path} must have a "value" string.`);
  }
  if (field.arrayType !== undefined && field.arrayType !== 'simple' && field.arrayType !== 'custom-key') {
    throw new Error(
      `[mongoose-log-history] "arrayType" in ${path}.${field.value} must be 'simple' or 'custom-key' if specified.`
    );
  }
  if (field.arrayType === 'custom-key' && (!field.arrayKey || typeof field.arrayKey !== 'string')) {
    throw new Error(
      `[mongoose-log-history] "arrayKey" is required and must be a string when "arrayType" is 'custom-key' in ${path}.${field.value}.`
    );
  }
  if (field.valueField !== undefined && typeof field.valueField !== 'string') {
    throw new Error(`[mongoose-log-history] "valueField" in ${path}.${field.value} must be a string if specified.`);
  }
  if (field.contextFields !== undefined) {
    if (
      !Array.isArray(field.contextFields) &&
      (typeof field.contextFields !== 'object' ||
        (field.contextFields.doc !== undefined && !Array.isArray(field.contextFields.doc)) ||
        (field.contextFields.item !== undefined && !Array.isArray(field.contextFields.item)))
    ) {
      throw new Error(
        `[mongoose-log-history] "contextFields" in ${path}.${field.value} must be an array or an object with optional "doc" and "item" arrays.`
      );
    }
  }
  if (field.trackedFields !== undefined) {
    if (!Array.isArray(field.trackedFields)) {
      throw new Error(
        `[mongoose-log-history] "trackedFields" in ${path}.${field.value} must be an array if specified.`
      );
    }
    // Recursively validate nested trackedFields
    field.trackedFields.forEach((subField, idx) =>
      validateTrackedField(subField, `${path}.${field.value}.trackedFields[${idx}]`)
    );
  }
}

function validateOptions(options) {
  if (!options.trackedFields || !Array.isArray(options.trackedFields)) {
    throw new Error('[mongoose-log-history] "trackedFields" option must be an array.');
  }
  options.trackedFields.forEach((field, idx) => validateTrackedField(field, `trackedFields[${idx}]`));
  if (options.batchSize !== undefined && (!Number.isInteger(options.batchSize) || options.batchSize <= 0)) {
    throw new Error('[mongoose-log-history] "batchSize" must be a positive integer.');
  }
  if (options.maxBatchLog !== undefined && (!Number.isInteger(options.maxBatchLog) || options.maxBatchLog <= 0)) {
    throw new Error('[mongoose-log-history] "maxBatchLog" must be a positive integer.');
  }
  if (options.logger) {
    if (typeof options.logger.error !== 'function' || typeof options.logger.warn !== 'function') {
      throw new Error('[mongoose-log-history] "logger" must have .error and .warn methods.');
    }
  }
  if (options.softDelete) {
    if (
      typeof options.softDelete !== 'object' ||
      typeof options.softDelete.field !== 'string' ||
      options.softDelete.value === undefined
    ) {
      throw new Error('[mongoose-log-history] "softDelete" must be an object with "field" (string) and "value".');
    }
  }
  if (options.contextFields !== undefined && !Array.isArray(options.contextFields)) {
    throw new Error('[mongoose-log-history] "contextFields" (plugin-level) must be an array.');
  }
  if (options.singleCollection !== undefined && typeof options.singleCollection !== 'boolean') {
    throw new Error('[mongoose-log-history] "singleCollection" must be a boolean.');
  }
  if (options.saveWholeDoc !== undefined && typeof options.saveWholeDoc !== 'boolean') {
    throw new Error('[mongoose-log-history] "saveWholeDoc" must be a boolean.');
  }
  if (options.modelKeyId !== undefined && typeof options.modelKeyId !== 'string') {
    throw new Error('[mongoose-log-history] "modelKeyId" must be a string.');
  }
}

// ============================================================================
// MAIN PLUGIN FUNCTION
// ============================================================================

function changeLoggingPlugin(schema, options = {}) {
  validateOptions(options);

  const ctx = new ChangeLogPlugin(options);

  ChangeLogPlugin.ensureIndex();

  schema.statics.getHistoriesById = async function (modelId, fields, options) {
    const LogHistory = ctx.getLogHistoryModelPlugin();
    const query = { model_id: modelId, is_deleted: false };
    if (ctx.singleCollection) {
      query['model'] = ctx.modelName;
    }
    const logs = await LogHistory.find(query, fields, options).lean();

    // Decompress docs if needed
    if (ctx.compressDocs) {
      for (const log of logs) {
        if (log.original_doc) log.original_doc = decompressObject(log.original_doc);
        if (log.updated_doc) log.updated_doc = decompressObject(log.updated_doc);
      }
    }
    return logs;
  };

  const preUpdateHook = ctx.createPreUpdateHook();
  const preSaveHook = ctx.createPreSaveHook();
  const preInsertManyHook = ctx.createPreInsertManyHook();
  const preDeleteHook = ctx.createPreDeleteHook();
  const preUpdateManyHook = ctx.createPreUpdateManyHook();

  schema.pre('updateOne', preUpdateHook);
  schema.pre('findOneAndUpdate', preUpdateHook);
  schema.pre('save', preSaveHook);
  schema.pre('insertMany', preInsertManyHook);
  schema.pre('findOneAndDelete', preDeleteHook);
  schema.pre('findByIdAndDelete', preDeleteHook);
  schema.pre('deleteOne', preDeleteHook);
  schema.pre('deleteMany', preDeleteHook);
  schema.pre('findOneAndReplace', preUpdateHook);
  schema.pre('replaceOne', preUpdateHook);
  schema.pre('updateMany', preUpdateManyHook);
  schema.pre('remove', preDeleteHook);
  schema.pre('delete', preDeleteHook);
  schema.pre('update', preUpdateHook);
}

module.exports = {
  changeLoggingPlugin,
  getTrackedChanges,
  buildLogEntry,
  getLogHistoryModel,
  pruneLogHistory,
  decompressObject,
};
