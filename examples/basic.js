const mongoose = require('mongoose');
const { changeLoggingPlugin } = require('mongoose-log-history');

async function main() {
  await mongoose.connect('mongodb://localhost:27017/mongoose_log_history_example');

  const orderSchema = new mongoose.Schema({
    status: String,
    tags: [String],
  });

  orderSchema.plugin(changeLoggingPlugin, {
    modelName: 'OrderExample',
    trackedFields: [{ value: 'status' }, { value: 'tags', arrayType: 'simple' }],
    singleCollection: true,
  });

  const Order = mongoose.model('OrderExample', orderSchema);

  // Create
  const order = await Order.create({ status: 'pending', tags: ['a'] });
  // Update
  order.status = 'done';
  order.tags.push('b');
  await order.save();

  // Fetch logs
  const LogHistory = mongoose.model('LogHistory', mongoose.Schema({}, { strict: false }), 'log_histories');
  const logs = await LogHistory.find({ model_id: order._id }).lean();
  console.log('Basic log entries:\n', JSON.stringify(logs, null, 2));
  // Example log:
  // [
  //   {
  //     "model": "OrderExample",
  //     "model_id": "...",
  //     "change_type": "create",
  //     "logs": [],
  //     ...
  //   },
  //   {
  //     "model": "OrderExample",
  //     "model_id": "...",
  //     "change_type": "update",
  //     "logs": [
  //       { "field_name": "status", "from_value": "pending", "to_value": "done", "change_type": "edit" },
  //       { "field_name": "tags", "from_value": null, "to_value": "b", "change_type": "add" }
  //     ],
  //     ...
  //   }
  // ]

  await mongoose.disconnect();
}

main();
