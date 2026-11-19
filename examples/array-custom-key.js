const mongoose = require('mongoose');
const { changeLoggingPlugin, getLogHistoryModel } = require('mongoose-log-history');

async function main() {
  await mongoose.connect('mongodb://localhost:27017/mongoose_log_history_example');

  const orderSchema = new mongoose.Schema({
    items: [{ _id: false, sku: String, name: String, qty: Number }],
  });

  orderSchema.plugin(changeLoggingPlugin, {
    modelName: 'OrderCustomKey',
    trackedFields: [
      {
        value: 'items',
        arrayType: 'custom-key',
        arrayKey: 'sku',
        valueField: 'name',
        trackedFields: [{ value: 'qty' }],
      },
    ],
    singleCollection: true,
  });

  const Order = mongoose.model('OrderCustomKey', orderSchema);

  const order = await Order.create({
    items: [
      { sku: 'A', name: 'Apple', qty: 1 },
      { sku: 'B', name: 'Banana', qty: 2 },
    ],
  });

  order.items = [
    { sku: 'A', name: 'Apple', qty: 5 },
    { sku: 'C', name: 'Cherry', qty: 3 },
  ];
  await order.save();

  const LogHistory = getLogHistoryModel('OrderCustomKey', true);
  const log = await LogHistory.findOne({ model_id: order._id, change_type: 'update' }).lean();
  console.log('Custom-key array logs:\n', JSON.stringify(log.logs, null, 2));
  // Example:
  // [
  //   { "field_name": "items.qty", "from_value": "1", "to_value": "5", "change_type": "edit", ... },
  //   { "field_name": "items", "from_value": "Banana", "to_value": null, "change_type": "remove", ... },
  //   { "field_name": "items", "from_value": null, "to_value": "Cherry", "change_type": "add", ... }
  // ]

  await mongoose.disconnect();
}

main();
