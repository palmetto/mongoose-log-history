'use strict';

const {
  getValueByPath,
  areValuesEqual,
  valueToString,
  exists,
  setByPath,
  arrayToKeyMap,
  diffSimpleArray,
} = require('./utils');

/**
 * Extracts context fields from the document and/or array item for logging.
 * @param {Array|Object} contextFields - Context fields config.
 *   - If an array, fields are extracted from the document itself.
 *   - If an object, it can have:
 *     - `doc`: array of field paths from the document itself
 *     - `item`: array of field paths from the array item (for arrays of objects)
 * @param {Object} originalDoc - The original document.
 * @param {Object} updatedDoc - The updated document.
 * @param {Object} [beforeItem] - The array item before change (optional).
 * @param {Object} [afterItem] - The array item after change (optional).
 * @returns {Object|undefined} The extracted context object, or undefined if none.
 */
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

/**
 * Process changes for a simple (non-array) field.
 * @param {Object} field - The tracked field config.
 * @param {*} beforeValue - The value before the change.
 * @param {*} afterValue - The value after the change.
 * @param {Object} originalDoc - The original document.
 * @param {Object} updatedDoc - The updated document.
 * @returns {Array} Array of change log objects for this field.
 */
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

/**
 * Process changes for a simple array field (array of primitives).
 * @param {Object} field - The tracked field config.
 * @param {Array} beforeValue - The array before the change.
 * @param {Array} afterValue - The array after the change.
 * @param {Object} originalDoc - The original document.
 * @param {Object} updatedDoc - The updated document.
 * @param {string} [parentFieldName] - The parent field name for nested arrays (optional).
 * @returns {Array} Array of change log objects for this field.
 */
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

/**
 * Process changes for a custom-key array field (array of objects with a key).
 * @param {Object} field - The tracked field config.
 * @param {Array} beforeValue - The array before the change.
 * @param {Array} afterValue - The array after the change.
 * @param {Object} originalDoc - The original document.
 * @param {Object} updatedDoc - The updated document.
 * @param {string} [parentFieldName] - The parent field name for nested arrays (optional).
 * @returns {Array} Array of change log objects for this field.
 */
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

/**
 * Process changes for nested tracked fields inside an array of objects.
 * @param {Object} field - The tracked field config.
 * @param {Object} beforeItem - The array item before the change.
 * @param {Object} afterItem - The array item after the change.
 * @param {Object} originalDoc - The original document.
 * @param {Object} updatedDoc - The updated document.
 * @param {string} [parentFieldName] - The parent field name for nested arrays (optional).
 * @returns {Array} Array of change log objects for nested fields.
 */
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

/**
 * Get the list of tracked changes between two documents.
 * @param {Object} original - The original document.
 * @param {Object} updated - The updated document.
 * @param {Array} trackedFields - Array of tracked field configs.
 * @returns {Array} Array of change log objects.
 */
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

module.exports = {
  extractLogContext,
  processGenericFieldChanges,
  processSimpleArrayChanges,
  processCustomKeyArrayChanges,
  processSubFieldChanges,
  getTrackedChanges,
};
