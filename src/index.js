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

const { changeLoggingPlugin, buildLogEntry } = require('./plugin');
const { getTrackedChanges } = require('./change-tracking');
const { getLogHistoryModel } = require('./schema');
const { pruneLogHistory } = require('./prune');
const { decompressObject } = require('./compression');

module.exports = {
  changeLoggingPlugin,
  getTrackedChanges,
  buildLogEntry,
  getLogHistoryModel,
  pruneLogHistory,
  decompressObject,
};
