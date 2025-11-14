import { TrackedField, FieldLog, ContextFields, ArrayDiff } from './types';
import {
  getValueByPath,
  areValuesEqual,
  valueToString,
  exists,
  setByPath,
  arrayToKeyMap,
  diffSimpleArray,
} from './utils';

/**
 * Extracts context fields from the document and/or array item for logging.
 *
 * @param contextFields - Context fields configuration (array of paths or object with doc/item fields).
 *   - If an array, fields are extracted from the document itself.
 *   - If an object, it can have:
 *     - `doc`: array of field paths from the document itself
 *     - `item`: array of field paths from the array item (for arrays of
 * @param originalDoc - The original document before changes.
 * @param updatedDoc - The updated document after changes.
 * @param beforeItem - The array item before change (optional, for array contexts).
 * @param afterItem - The array item after change (optional, for array contexts).
 * @returns The extracted context object, or undefined if no context fields configured.
 */
export function extractLogContext(
  contextFields: ContextFields | undefined,
  originalDoc: Record<string, unknown> | null | undefined,
  updatedDoc: Record<string, unknown> | null | undefined,
  beforeItem: Record<string, unknown> | null = null,
  afterItem: Record<string, unknown> | null = null
): Record<string, unknown> | undefined {
  if (!contextFields) {
    return undefined;
  }

  const context: Record<string, unknown> = {};

  if (Array.isArray(contextFields)) {
    context.doc = {};
    for (const ctxField of contextFields) {
      const ctxValue = getValueByPath(updatedDoc, ctxField) || getValueByPath(originalDoc, ctxField);
      setByPath(context.doc as Record<string, unknown>, ctxField, ctxValue);
    }
  } else {
    if (contextFields.doc && Array.isArray(contextFields.doc)) {
      context.doc = {};
      for (const ctxField of contextFields.doc) {
        const ctxValue = getValueByPath(updatedDoc, ctxField) || getValueByPath(originalDoc, ctxField);
        setByPath(context.doc as Record<string, unknown>, ctxField, ctxValue);
      }
    }

    if (contextFields.item && Array.isArray(contextFields.item)) {
      context.item = {};
      const item = afterItem || beforeItem;
      if (item) {
        for (const ctxField of contextFields.item) {
          const ctxValue = getValueByPath(item, ctxField);
          setByPath(context.item as Record<string, unknown>, ctxField, ctxValue);
        }
      }
    }
  }

  return context;
}

/**
 * Process changes for a simple (non-array) field.
 *
 * @param field - The tracked field configuration.
 * @param beforeValue - The value before the change.
 * @param afterValue - The value after the change.
 * @param originalDoc - The original document.
 * @param updatedDoc - The updated document.
 * @param parentFieldName - The parent field name for nested arrays (optional).
 * @param beforeItem - The array item before change (optional, for array sub-fields).
 * @param afterItem - The array item after change (optional, for array sub-fields).
 * @returns Array of change log objects for this field.
 */
function processGenericFieldChanges(
  field: TrackedField,
  beforeValue: unknown,
  afterValue: unknown,
  originalDoc: Record<string, unknown> | null | undefined,
  updatedDoc: Record<string, unknown> | null | undefined,
  parentFieldName: string | null = null,
  beforeItem: Record<string, unknown> | null = null,
  afterItem: Record<string, unknown> | null = null
): FieldLog[] {
  const log: FieldLog[] = [];
  const fieldName = parentFieldName ?? field.value;
  const beforeExists = exists(beforeValue);
  const afterExists = exists(afterValue);

  const rawBefore = valueToString(beforeValue, field.mask);
  const rawAfter = valueToString(afterValue, field.mask);

  const beforeStr: string | null | undefined = rawBefore;
  const afterStr: string | null | undefined = rawAfter;

  const context = extractLogContext(field.contextFields, originalDoc, updatedDoc, beforeItem, afterItem);

  if (!beforeExists && !afterExists) {
    return log;
  }

  if (!beforeExists && afterExists) {
    log.push({
      field_name: fieldName,
      from_value: beforeStr,
      to_value: afterStr,
      change_type: 'add',
      ...(context ? { context } : {}),
    });
    return log;
  }

  if (beforeExists && !afterExists) {
    log.push({
      field_name: fieldName,
      from_value: beforeStr,
      to_value: afterStr,
      change_type: 'remove',
      ...(context ? { context } : {}),
    });
    return log;
  }

  if (!areValuesEqual(beforeValue, afterValue)) {
    log.push({
      field_name: fieldName,
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
 *
 * @param field - The tracked field configuration.
 * @param beforeValue - The array before the change.
 * @param afterValue - The array after the change.
 * @param originalDoc - The original document.
 * @param updatedDoc - The updated document.
 * @param parentFieldName - The parent field name for nested arrays (optional).
 * @param beforeItem - The array item before change (optional, for array sub-fields).
 * @param afterItem - The array item after change (optional, for array sub-fields).
 * @returns Array of change log objects for this field.
 */
function processSimpleArrayChanges(
  field: TrackedField,
  beforeValue: unknown,
  afterValue: unknown,
  originalDoc: Record<string, unknown> | null | undefined,
  updatedDoc: Record<string, unknown> | null | undefined,
  parentFieldName: string | null = null,
  beforeItem: Record<string, unknown> | null = null,
  afterItem: Record<string, unknown> | null = null
): FieldLog[] {
  const log: FieldLog[] = [];

  const beforeArray = Array.isArray(beforeValue) ? beforeValue : [];
  const afterArray = Array.isArray(afterValue) ? afterValue : [];

  const { added, removed }: ArrayDiff = diffSimpleArray(beforeArray, afterArray);

  const fieldName = parentFieldName ?? field.value;
  const context = extractLogContext(field.contextFields, originalDoc, updatedDoc, beforeItem, afterItem);

  for (const item of added) {
    const v = valueToString(item, field.mask);
    log.push({
      field_name: fieldName,
      from_value: null,
      to_value: v === null || v === undefined ? null : v,
      change_type: 'add',
      ...(context ? { context } : {}),
    });
  }

  for (const item of removed) {
    const v = valueToString(item, field.mask);
    log.push({
      field_name: fieldName,
      from_value: v === null || v === undefined ? null : v,
      to_value: null,
      change_type: 'remove',
      ...(context ? { context } : {}),
    });
  }

  return log;
}

/**
 * Process changes for a custom-key array field (array of objects with a unique key).
 * This handles complex arrays where objects are identified by a specific key field.
 *
 * @param field - The tracked field configuration.
 * @param beforeValue - The array before the change.
 * @param afterValue - The array after the change.
 * @param originalDoc - The original document.
 * @param updatedDoc - The updated document.
 * @param parentFieldName - The parent field name for nested arrays (optional).
 * @param beforeItem - The array item before change (optional, for array sub-fields).
 * @param afterItem - The array item after change (optional, for array sub-fields).
 * @returns Array of change log objects for this field.
 */
function processCustomKeyArrayChanges(
  field: TrackedField,
  beforeValue: unknown,
  afterValue: unknown,
  originalDoc: Record<string, unknown> | null | undefined,
  updatedDoc: Record<string, unknown> | null | undefined,
  parentFieldName: string | null = null
): FieldLog[] {
  const log: FieldLog[] = [];

  if (!field.arrayKey) return log;

  const beforeArray = Array.isArray(beforeValue) ? (beforeValue as Record<string, unknown>[]) : [];
  const afterArray = Array.isArray(afterValue) ? (afterValue as Record<string, unknown>[]) : [];

  const beforeMap = arrayToKeyMap(beforeArray, field.arrayKey);
  const afterMap = arrayToKeyMap(afterArray, field.arrayKey);
  const allKeys = new Set([...Object.keys(beforeMap), ...Object.keys(afterMap)]);

  const fieldName = parentFieldName ?? field.value;

  for (const key of allKeys) {
    const beforeItem = beforeMap[key];
    const afterItem = afterMap[key];
    const beforeExists = exists(beforeItem);
    const afterExists = exists(afterItem);

    const fvRaw = beforeItem && field.valueField ? valueToString(beforeItem[field.valueField], field.mask) : undefined;
    const tvRaw = afterItem && field.valueField ? valueToString(afterItem[field.valueField], field.mask) : undefined;
    const fromValue: string | null = fvRaw === null || fvRaw === undefined ? null : fvRaw;
    const toValue: string | null = tvRaw === null || tvRaw === undefined ? null : tvRaw;

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
      log.push(...processSubFieldChanges(field, beforeItem, afterItem, originalDoc, updatedDoc, fieldName, context));
    }
  }

  return log;
}

/**
 * Process changes for nested tracked fields inside an array of objects.
 * @param field - The tracked field configuration.
 * @param beforeItem - The array item before the change.
 * @param afterItem - The array item after the change.
 * @param originalDoc - The original document.
 * @param updatedDoc - The updated document.
 * @param parentFieldName - The parent field name for nested arrays (optional).
 * @param parentContext - The context from the parent field (optional).
 * @returns Array of change log objects for nested fields.
 */
function processSubFieldChanges(
  field: TrackedField,
  beforeItem: Record<string, unknown>,
  afterItem: Record<string, unknown>,
  originalDoc: Record<string, unknown> | null | undefined,
  updatedDoc: Record<string, unknown> | null | undefined,
  parentFieldName: string | null = null,
  parentContext: Record<string, unknown> | undefined = undefined
): FieldLog[] {
  const log: FieldLog[] = [];

  if (!field.trackedFields || !Array.isArray(field.trackedFields)) {
    return log;
  }

  for (const subField of field.trackedFields) {
    const subPath = subField.value;
    const beforeVal = getValueByPath(beforeItem, subPath);
    const afterVal = getValueByPath(afterItem, subPath);

    const fieldName = `${parentFieldName ?? field.value}.${subPath}`;

    let subLogs: FieldLog[] = [];
    if (subField.arrayType === 'simple') {
      subLogs = processSimpleArrayChanges(
        subField,
        beforeVal,
        afterVal,
        originalDoc,
        updatedDoc,
        fieldName,
        beforeItem,
        afterItem
      );
    } else if (subField.arrayType === 'custom-key' && subField.arrayKey) {
      subLogs = processCustomKeyArrayChanges(subField, beforeVal, afterVal, originalDoc, updatedDoc, fieldName);
    } else {
      subLogs = processGenericFieldChanges(
        subField,
        beforeVal,
        afterVal,
        originalDoc,
        updatedDoc,
        fieldName,
        beforeItem,
        afterItem
      );
    }

    if (parentContext) {
      subLogs = subLogs.map((subLog) => {
        if (!subLog.context) {
          return { ...subLog, context: parentContext };
        }

        const mergedContext: Record<string, unknown> = { ...parentContext };
        for (const [key, value] of Object.entries(subLog.context)) {
          if (mergedContext[key] && typeof mergedContext[key] === 'object' && typeof value === 'object') {
            mergedContext[key] = {
              ...(mergedContext[key] as Record<string, unknown>),
              ...(value as Record<string, unknown>),
            };
          } else {
            mergedContext[key] = value;
          }
        }

        return { ...subLog, context: mergedContext };
      });
    }

    log.push(...subLogs);
  }

  return log;
}

/**
 * Get tracked changes between two documents based on the configured tracked fields.
 * This is the main entry point for change detection and processes all configured fields.
 *
 * @param originalDoc - The original document before changes.
 * @param updatedDoc - The updated document after changes.
 * @param trackedFields - Array of field configurations to track.
 * @returns Array of field-level change log objects.
 */
export function getTrackedChanges(
  originalDoc: Record<string, unknown> | null | undefined,
  updatedDoc: Record<string, unknown> | null | undefined,
  trackedFields: TrackedField[]
): FieldLog[] {
  const allLogs: FieldLog[] = [];

  if (!trackedFields || trackedFields.length === 0) return allLogs;
  for (const field of trackedFields) {
    if (!field.value) continue;
    const beforeValue = getValueByPath(originalDoc, field.value);
    const afterValue = getValueByPath(updatedDoc, field.value);
    let fieldLogs: FieldLog[] = [];
    if (field.arrayType === 'simple') {
      fieldLogs = processSimpleArrayChanges(field, beforeValue, afterValue, originalDoc, updatedDoc);
    } else if (field.arrayType === 'custom-key') {
      fieldLogs = processCustomKeyArrayChanges(field, beforeValue, afterValue, originalDoc, updatedDoc);
    } else {
      fieldLogs = processGenericFieldChanges(field, beforeValue, afterValue, originalDoc, updatedDoc);
    }
    allLogs.push(...fieldLogs);
  }
  return allLogs;
}
