'use strict';

const mongoose = require('mongoose');

const { getLogHistoryModel, logHistorySchema } = require('./schema');
const { getTrackedChanges, extractLogContext } = require('./change-tracking');
const { compressObject, decompressObject } = require('./compression');
const { getValueByPath, arrayToKeyMap, isEqual } = require('./utils');

/**
 * Build a log entry object compatible with the plugin's log schema.
 * @param {string|ObjectId} model_id - The document's ID.
 * @param {string} model_name - The model name.
 * @param {string} change_type - The type of change ('create', 'update', 'delete').
 * @param {Array} logs - Array of field-level change objects.
 * @param {*} created_by - User info (object, string, or any type).
 * @param {Object} [original_doc] - The original document.
 * @param {Object} [updated_doc] - The updated document.
 * @param {Object} [context] - Additional context fields.
 * @param {boolean} [saveWholeDoc=false] - Save full doc snapshots.
 * @param {boolean} [compressDocs=false] - Compress doc snapshots.
 * @returns {Object} Log entry object.
 */
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

  /**
   * Get the log history model for the current plugin instance.
   * @returns {mongoose.Model} The log history model.
   */
  getLogHistoryModelPlugin() {
    return getLogHistoryModel(this.modelName, this.singleCollection);
  }

  /**
   * Extract user info from context or document, with fallbacks.
   * @param {Object} params
   * @param {Object} params.doc - The document (plain object)
   * @param {Object} params.context - The context object (from query options)
   * @param {string} params.userField - The user field path (dot notation)
   * @returns {*} The extracted user info.
   */
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

  /**
   * Simulate $addToSet update operator for arrays.
   * @param {Array} originalArr - The original array.
   * @param {Array|*} addArr - The value(s) to add.
   * @param {string} [arrayKey] - The key for custom-key arrays.
   * @returns {Array} The updated array.
   */
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

  /**
   * Simulate $pull update operator for arrays.
   * @param {Array} originalArr - The original array.
   * @param {*} pullQuery - The value or query to pull.
   * @returns {Array} The updated array.
   */
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

  /**
   * Simulate $pullAll update operator for arrays.
   * @param {Array} originalArr - The original array.
   * @param {Array|*} pullAllArr - The values to pull.
   * @returns {Array} The updated array.
   */
  simulatePullAll(originalArr, pullAllArr) {
    if (!Array.isArray(originalArr)) {
      return [];
    }
    if (!Array.isArray(pullAllArr)) {
      pullAllArr = [pullAllArr];
    }
    return originalArr.filter((item) => !pullAllArr.some((val) => isEqual(item, val)));
  }

  /**
   * Extract the updated fields from a MongoDB update object and the original document.
   * @param {Object} update - The MongoDB update object.
   * @param {Object} originalDoc - The original document.
   * @returns {Object} The simulated updated fields.
   */
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

  /**
   * Save a single log history entry.
   * @param {Object} params
   * @param {string|ObjectId} params.modelId - The document's ID.
   * @param {Object} [params.originalData] - The original document.
   * @param {Object} [params.updatedData] - The updated document.
   * @param {string} [params.changeType='update'] - The type of change.
   * @param {*} [params.user=null] - User info.
   * @returns {Promise<void>}
   */
  async saveLogHistory({ modelId, originalData, updatedData, changeType = 'update', user = null }) {
    let changes = [];
    let context = undefined;
    if (changeType === 'update') {
      changes = getTrackedChanges(originalData, updatedData, this.trackedFields);

      if (changes.length === 0) {
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

  /**
   * Save multiple log history entries in a batch.
   * @param {Array} logEntriesData - Array of log entry parameter objects.
   * @returns {Promise<void>}
   */
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

  /**
   * Process documents in batches for bulk operations, respecting maxBatchLog and batchSize.
   * @param {Array} docs - The documents to process.
   * @param {Function} processFn - The function to process each batch.
   * @param {string} [operationName='batch'] - The operation name for logging.
   * @param {*} [user=null] - User info.
   * @returns {Promise<void>}
   */
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

  createPreUpdateHook() {
    const self = this;
    return async function preUpdateHook(next) {
      let modelId;
      try {
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
          const wasDeleted = getValueByPath(originalDoc, softDeleteConfig.field) === softDeleteConfig.value;
          const isDeleted =
            getValueByPath({ ...originalDoc, ...updateFields }, softDeleteConfig.field) === softDeleteConfig.value;
          if (!wasDeleted && isDeleted) {
            isSoftDelete = true;
          }
        }

        const updatedData = { ...originalDoc, ...updateFields };

        modelId = getValueByPath(updatedData, self.modelKeyId);
        if (!modelId) {
          modelId = getValueByPath(filter, self.modelKeyId);
        }

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

        if (isSoftDelete && originalDoc) {
          await self.saveLogHistory({
            modelId,
            originalData: originalDoc,
            updatedData,
            changeType: 'delete',
            user,
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

          let isSoftDelete = false;
          if (self.softDelete) {
            const wasDeleted = getValueByPath(originalDoc, self.softDelete.field) === self.softDelete.value;
            const isDeleted = getValueByPath(doc, self.softDelete.field) === self.softDelete.value;
            if (!wasDeleted && isDeleted) {
              isSoftDelete = true;
            }
          }

          if (isSoftDelete) {
            await self.saveLogHistory({
              modelId,
              originalData: originalDoc,
              updatedData: doc.toObject(),
              changeType: 'delete',
              user,
            });
          } else {
            await self.saveLogHistory({
              modelId,
              originalData: originalDoc,
              updatedData: doc.toObject(),
              changeType: 'update',
              user,
            });
          }
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
        await self.batchLogHistory(
          docs,
          async (batch, user) => {
            const logEntryParams = [];
            for (const doc of batch) {
              if (!doc._id) {
                doc._id = new mongoose.Types.ObjectId();
              }
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

              let isSoftDelete = false;
              if (self.softDelete) {
                const wasDeleted = getValueByPath(originalDoc, self.softDelete.field) === self.softDelete.value;
                const isDeleted = getValueByPath(updatedData, self.softDelete.field) === self.softDelete.value;
                if (!wasDeleted && isDeleted) {
                  isSoftDelete = true;
                }
              }

              if (isSoftDelete) {
                logEntryParams.push({
                  modelId,
                  originalData: originalDoc,
                  updatedData,
                  changeType: 'delete',
                  user: userData,
                });
              } else {
                logEntryParams.push({
                  modelId,
                  changeType: 'update',
                  originalData: originalDoc,
                  updatedData,
                  user: userData,
                });
              }
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

    field.trackedFields.forEach((subField, idx) =>
      validateTrackedField(subField, `${path}.${field.value}.trackedFields[${idx}]`)
    );
  }
}

function validateOptions(options) {
  if (!options.modelName || typeof options.modelName !== 'string') {
    throw new Error('[mongoose-log-history] "modelName" option is required and must be a string.');
  }
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

/**
 * Mongoose plugin to track and log changes to specified fields in documents.
 * @param {mongoose.Schema} schema - The Mongoose schema to apply the plugin to.
 * @param {Object} options - Plugin configuration options.
 */
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

module.exports = { ChangeLogPlugin, changeLoggingPlugin, buildLogEntry };
