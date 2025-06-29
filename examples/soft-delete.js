const mongoose = require('mongoose');
const { changeLoggingPlugin } = require('mongoose-log-history');

async function main() {
  await mongoose.connect('mongodb://localhost:27017/mongoose_log_history_example');

  const orderSchema = new mongoose.Schema({ status: String });
  orderSchema.plugin(changeLoggingPlugin, {
    modelName: 'OrderSoftDelete',
    trackedFields: [{ value: 'status' }],
    singleCollection: true,
    softDelete: { field: 'status', value: 'deleted' },
  });

  const Order = mongoose.model('OrderSoftDelete', orderSchema);

  const order = await Order.create({ status: 'pending' });
  order.status = 'deleted';
  await order.save();

  const LogHistory = mongoose.model('LogHistory', mongoose.Schema({}, { strict: false }), 'log_histories');
  const logs = await LogHistory.find({ model_id: order._id }).lean();
  console.log('Soft delete log entries:\n', JSON.stringify(logs, null, 2));
  // Example log:
  // [
  //   { "change_type": "create", ... },
  //   { "change_type": "delete", ... }
  // ]

  await mongoose.disconnect();
}

main();
