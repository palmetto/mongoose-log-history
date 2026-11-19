import { TrackedField, FieldLog, ContextFields, ArrayDiff, MaskedFields } from './types';
import {
  getValueByPath,
  areValuesEqual,
  maskedValueToString,
  exists,
  setByPath,
  arrayToKeyMap,
  diffSimpleArray,
  deepClone,
  mergeMaskedFields,
} from './utils';

type Doc = Record<string, unknown> | null | undefined;

interface ArrayItem {
  arrayPath: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

interface ChangeScope {
  originalDoc: Doc;
  updatedDoc: Doc;
  maskedFields: MaskedFields | undefined;
  item?: ArrayItem;
}

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
 * @param maskedFields - Masks keyed by full dotted path, applied to the extracted values (optional).
 * @param itemPath - The full dotted path of the array that holds the item, used to mask item values (optional).
 * @returns The extracted context object, or undefined if no context fields configured.
 */
export function extractLogContext(
  contextFields: ContextFields | undefined,
  originalDoc: Doc,
  updatedDoc: Doc,
  beforeItem: Record<string, unknown> | null = null,
  afterItem: Record<string, unknown> | null = null,
  maskedFields?: MaskedFields,
  itemPath?: string
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

  if (maskedFields) {
    if (context.doc) {
      context.doc = deepClone(context.doc, maskedFields);
    }
    if (context.item) {
      context.item = deepClone(context.item, maskedFields, itemPath);
    }
  }

  return context;
}

function extractScopedContext(field: TrackedField, scope: ChangeScope): Record<string, unknown> | undefined {
  return extractLogContext(
    field.contextFields,
    scope.originalDoc,
    scope.updatedDoc,
    scope.item?.before ?? null,
    scope.item?.after ?? null,
    scope.maskedFields,
    scope.item?.arrayPath
  );
}

/**
 * Process changes for a simple (non-array) field.
 *
 * @param field - The tracked field configuration.
 * @param beforeValue - The value before the change.
 * @param afterValue - The value after the change.
 * @returns Array of change log objects for this field.
 */
function processGenericFieldChanges(
  field: TrackedField,
  fieldName: string,
  beforeValue: unknown,
  afterValue: unknown,
  scope: ChangeScope
): FieldLog[] {
  const log: FieldLog[] = [];
  const beforeExists = exists(beforeValue);
  const afterExists = exists(afterValue);

  const rawBefore = maskedValueToString(beforeValue, fieldName, scope.maskedFields);
  const rawAfter = maskedValueToString(afterValue, fieldName, scope.maskedFields);

  const beforeStr: string | null | undefined = rawBefore;
  const afterStr: string | null | undefined = rawAfter;

  const context = extractScopedContext(field, scope);

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
 * @returns Array of change log objects for this field.
 */
function processSimpleArrayChanges(
  field: TrackedField,
  fieldName: string,
  beforeValue: unknown,
  afterValue: unknown,
  scope: ChangeScope
): FieldLog[] {
  const log: FieldLog[] = [];

  const beforeArray = Array.isArray(beforeValue) ? beforeValue : [];
  const afterArray = Array.isArray(afterValue) ? afterValue : [];

  const { added, removed }: ArrayDiff = diffSimpleArray(beforeArray, afterArray);

  const context = extractScopedContext(field, scope);

  for (const item of added) {
    const v = maskedValueToString(item, fieldName, scope.maskedFields);
    log.push({
      field_name: fieldName,
      from_value: null,
      to_value: v === null || v === undefined ? null : v,
      change_type: 'add',
      ...(context ? { context } : {}),
    });
  }

  for (const item of removed) {
    const v = maskedValueToString(item, fieldName, scope.maskedFields);
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
 * @returns Array of change log objects for this field.
 */
function processCustomKeyArrayChanges(
  field: TrackedField,
  fieldName: string,
  beforeValue: unknown,
  afterValue: unknown,
  scope: ChangeScope
): FieldLog[] {
  const log: FieldLog[] = [];

  if (!field.arrayKey) return log;

  const beforeArray = Array.isArray(beforeValue) ? (beforeValue as Record<string, unknown>[]) : [];
  const afterArray = Array.isArray(afterValue) ? (afterValue as Record<string, unknown>[]) : [];

  const beforeMap = arrayToKeyMap(beforeArray, field.arrayKey);
  const afterMap = arrayToKeyMap(afterArray, field.arrayKey);
  const allKeys = new Set([...Object.keys(beforeMap), ...Object.keys(afterMap)]);

  const valuePath = `${fieldName}.${field.valueField}`;

  for (const key of allKeys) {
    const beforeItem = beforeMap[key];
    const afterItem = afterMap[key];
    const beforeExists = exists(beforeItem);
    const afterExists = exists(afterItem);

    const fvRaw =
      beforeItem && field.valueField
        ? maskedValueToString(beforeItem[field.valueField], valuePath, scope.maskedFields)
        : undefined;
    const tvRaw =
      afterItem && field.valueField
        ? maskedValueToString(afterItem[field.valueField], valuePath, scope.maskedFields)
        : undefined;
    const fromValue: string | null = fvRaw === null || fvRaw === undefined ? null : fvRaw;
    const toValue: string | null = tvRaw === null || tvRaw === undefined ? null : tvRaw;

    const itemScope: ChangeScope = {
      ...scope,
      item: { arrayPath: fieldName, before: beforeItem ?? null, after: afterItem ?? null },
    };
    const context = extractScopedContext(field, itemScope);

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
      log.push(...processSubFieldChanges(field, fieldName, beforeItem, afterItem, itemScope, context));
    }
  }

  return log;
}

/**
 * Process changes for nested tracked fields inside an array of objects.
 * @param field - The tracked field configuration.
 * @param beforeItem - The array item before the change.
 * @param afterItem - The array item after the change.
 * @param parentContext - The context from the parent field.
 * @returns Array of change log objects for nested fields.
 */
function processSubFieldChanges(
  field: TrackedField,
  arrayPath: string,
  beforeItem: Record<string, unknown>,
  afterItem: Record<string, unknown>,
  scope: ChangeScope,
  parentContext: Record<string, unknown> | undefined
): FieldLog[] {
  const log: FieldLog[] = [];

  if (!field.trackedFields || !Array.isArray(field.trackedFields)) {
    return log;
  }

  for (const subField of field.trackedFields) {
    const subPath = subField.value;
    const beforeVal = getValueByPath(beforeItem, subPath);
    const afterVal = getValueByPath(afterItem, subPath);

    const fieldName = `${arrayPath}.${subPath}`;

    let subLogs: FieldLog[];
    if (subField.arrayType === 'simple') {
      subLogs = processSimpleArrayChanges(subField, fieldName, beforeVal, afterVal, scope);
    } else if (subField.arrayType === 'custom-key' && subField.arrayKey) {
      subLogs = processCustomKeyArrayChanges(subField, fieldName, beforeVal, afterVal, scope);
    } else {
      subLogs = processGenericFieldChanges(subField, fieldName, beforeVal, afterVal, scope);
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
 * @param maskedFields - Masks keyed by full dotted path, merged with the masks of the tracked fields.
 *   On the same path, these win.
 * @returns Array of field-level change log objects.
 */
export function getTrackedChanges(
  originalDoc: Doc,
  updatedDoc: Doc,
  trackedFields: TrackedField[],
  maskedFields?: MaskedFields
): FieldLog[] {
  const allLogs: FieldLog[] = [];

  if (!trackedFields || trackedFields.length === 0) return allLogs;
  const scope: ChangeScope = {
    originalDoc,
    updatedDoc,
    maskedFields: mergeMaskedFields(trackedFields, maskedFields),
  };
  for (const field of trackedFields) {
    if (!field.value) continue;
    const beforeValue = getValueByPath(originalDoc, field.value);
    const afterValue = getValueByPath(updatedDoc, field.value);
    let fieldLogs: FieldLog[];
    if (field.arrayType === 'simple') {
      fieldLogs = processSimpleArrayChanges(field, field.value, beforeValue, afterValue, scope);
    } else if (field.arrayType === 'custom-key') {
      fieldLogs = processCustomKeyArrayChanges(field, field.value, beforeValue, afterValue, scope);
    } else {
      fieldLogs = processGenericFieldChanges(field, field.value, beforeValue, afterValue, scope);
    }
    allLogs.push(...fieldLogs);
  }
  return allLogs;
}
