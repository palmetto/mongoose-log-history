const mongoose = require('mongoose');
const { changeLoggingPlugin } = require('mongoose-log-history');

async function main() {
  await mongoose.connect('mongodb://localhost:27017/mongoose_log_history_example');

  const orderSchema = new mongoose.Schema({ status: String });
  orderSchema.plugin(changeLoggingPlugin, {
    modelName: 'OrderBatch',
    trackedFields: [{ value: 'status' }],
    singleCollection: true,
    maxBatchLog: 2,
    batchSize: 1,
  });

  const Order = mongoose.model('OrderBatch', orderSchema);

  await Order.insertMany([{ status: 'a' }, { status: 'b' }, { status: 'c' }]);

  await Order.updateMany({}, { $set: { status: 'done' } });

  const LogHistory = mongoose.model('LogHistory', mongoose.Schema({}, { strict: false }), 'log_histories');
  const logs = await LogHistory.find({ change_type: 'update' }).lean();
  console.log('Batch update logs (maxBatchLog=2):\n', JSON.stringify(logs, null, 2));
  // Example: Only 2 logs due to maxBatchLog

  await mongoose.disconnect();
}

main();
