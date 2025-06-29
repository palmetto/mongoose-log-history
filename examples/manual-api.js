const mongoose = require('mongoose');
const { getTrackedChanges, buildLogEntry, getLogHistoryModel, decompressObject } = require('mongoose-log-history');

async function main() {
  await mongoose.connect('mongodb://localhost:27017/mongoose_log_history_example');

  const LogHistory = getLogHistoryModel('ManualApi', true);

  const original = { status: 'pending', approver: 'Alice' };
  const updated = { status: 'approved', approver: 'Bob' };
  const trackedFields = [{ value: 'status' }];

  const changes = getTrackedChanges(original, updated, trackedFields);
  const logEntry = buildLogEntry(
    new mongoose.Types.ObjectId(),
    'ManualApi',
    'update',
    changes,
    'Bob',
    original,
    updated,
    { doc: { user: 'Bob' } },
    true, // saveWholeDoc
    true // compressDocs
  );
  await LogHistory.create(logEntry);

  const log = await LogHistory.findOne({ model: 'ManualApi' });
  const orig = decompressObject(log.original_doc._bsontype === 'Binary' ? log.original_doc.buffer : log.original_doc);
  const upd = decompressObject(log.updated_doc._bsontype === 'Binary' ? log.updated_doc.buffer : log.updated_doc);

  console.log('Manual log entry:', JSON.stringify(log, null, 2));
  console.log('Decompressed original:', orig);
  console.log('Decompressed updated:', upd);

  await mongoose.disconnect();
}

main();
