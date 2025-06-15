'use strict';

const { getLogHistoryModel } = require('./schema');
const { parseHumanTime } = require('./compression');

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

module.exports = { pruneLogHistory };
