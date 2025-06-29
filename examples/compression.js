const mongoose = require('mongoose');
const { changeLoggingPlugin, decompressObject } = require('mongoose-log-history');
const { Binary } = require('mongodb');

async function main() {
  await mongoose.connect('mongodb://localhost:27017/mongoose_log_history_example');

  const orderSchema = new mongoose.Schema({ status: String, data: String });
  orderSchema.plugin(changeLoggingPlugin, {
    modelName: 'OrderCompression',
    trackedFields: [{ value: 'status' }],
    singleCollection: true,
    saveWholeDoc: true,
    compressDocs: true,
  });

  const Order = mongoose.model('OrderCompression', orderSchema);

  const order = await Order.create({ status: 'pending', data: 'foo' });
  order.status = 'done';
  order.data = 'bar';
  await order.save();

  const LogHistory = mongoose.model('LogHistory', mongoose.Schema({}, { strict: false }), 'log_histories');
  const log = await LogHistory.findOne({ model_id: order._id, change_type: 'update' });
  const orig = decompressObject(log.original_doc._bsontype === 'Binary' ? log.original_doc.buffer : log.original_doc);
  const updated = decompressObject(log.updated_doc._bsontype === 'Binary' ? log.updated_doc.buffer : log.updated_doc);

  console.log('Decompressed original:', orig);
  console.log('Decompressed updated:', updated);
  // Example:
  // Decompressed original: { status: 'pending', data: 'foo' }
  // Decompressed updated: { status: 'done', data: 'bar' }

  await mongoose.disconnect();
}

main();
