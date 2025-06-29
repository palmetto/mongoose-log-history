const mongoose = require('mongoose');
const { changeLoggingPlugin } = require('mongoose-log-history');

async function main() {
  await mongoose.connect('mongodb://localhost:27017/mongoose_log_history_example');

  const orderSchema = new mongoose.Schema({
    status: String,
    tags: [String],
  });

  orderSchema.plugin(changeLoggingPlugin, {
    modelName: 'OrderMongoOps',
    trackedFields: [{ value: 'status' }, { value: 'tags', arrayType: 'simple' }],
    singleCollection: true,
  });

  const Order = mongoose.model('OrderMongoOps', orderSchema);

  const order = await Order.create({ status: 'pending', tags: ['a', 'b'] });

  // $unset
  await Order.updateOne({ _id: order._id }, { $unset: { status: '' } });

  // $push
  await Order.updateOne({ _id: order._id }, { $push: { tags: 'c' } });

  // $pull
  await Order.updateOne({ _id: order._id }, { $pull: { tags: 'a' } });

  // $addToSet
  await Order.updateOne({ _id: order._id }, { $addToSet: { tags: 'd' } });

  // $pop
  await Order.updateOne({ _id: order._id }, { $pop: { tags: 1 } });

  const LogHistory = mongoose.model('LogHistory', mongoose.Schema({}, { strict: false }), 'log_histories');
  const logs = await LogHistory.find({ model_id: order._id }).lean();
  console.log('MongoDB operator logs:\n', JSON.stringify(logs, null, 2));
  // Example log entries:
  // - $unset: logs a "remove" for status
  // - $push/$addToSet: logs an "add" for tags
  // - $pull/$pop: logs a "remove" for tags

  await mongoose.disconnect();
}

main();
