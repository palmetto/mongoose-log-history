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
