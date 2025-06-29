const mongoose = require('mongoose');
const { changeLoggingPlugin } = require('mongoose-log-history');

async function main() {
  await mongoose.connect('mongodb://localhost:27017/mongoose_log_history_example');

  const orderSchema = new mongoose.Schema({
    status: String,
    user: { name: String, role: String },
    items: [
      {
        sku: String,
        qty: Number,
        meta: { color: String },
      },
    ],
  });

  orderSchema.plugin(changeLoggingPlugin, {
    modelName: 'OrderContext',
    trackedFields: [
      {
        value: 'items',
        arrayType: 'custom-key',
        arrayKey: 'sku',
        contextFields: {
          doc: ['user.role'],
          item: ['sku', 'meta.color'],
        },
        trackedFields: [{ value: 'qty' }],
      },
    ],
    contextFields: ['user.name'],
    singleCollection: true,
  });

  const Order = mongoose.model('OrderContext', orderSchema);

  const order = await Order.create({
    status: 'pending',
    user: { name: 'Alice', role: 'admin' },
    items: [{ sku: 'A', qty: 1, meta: { color: 'red' } }],
  });

  order.items = [{ sku: 'A', qty: 2, meta: { color: 'blue' } }];
  await order.save();

  const LogHistory = mongoose.model('LogHistory', mongoose.Schema({}, { strict: false }), 'log_histories');
  const logs = await LogHistory.find({ model_id: order._id }).lean();
  console.log('Context fields log:\n', JSON.stringify(logs, null, 2));
  // Example:
  // "context": {
  //   "doc": { "user": { "role": "admin" } },
  //   "item": { "sku": "A", "meta": { "color": "blue" } }
  // }

  await mongoose.disconnect();
}

main();
