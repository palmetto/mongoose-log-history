const mongoose = require('mongoose');
const { changeLoggingPlugin } = require('mongoose-log-history');

async function main() {
  await mongoose.connect('mongodb://localhost:27017/mongoose_log_history_example');

  const orderSchema = new mongoose.Schema({
    customer: {
      name: String,
      address: {
        city: String,
        zip: String,
      },
    },
    items: [
      {
        sku: String,
        details: {
          color: String,
          size: String,
        },
        qty: Number,
      },
    ],
  });

  orderSchema.plugin(changeLoggingPlugin, {
    modelName: 'OrderNested',
    trackedFields: [
      { value: 'customer.name' },
      { value: 'customer.address.city' },
      {
        value: 'items',
        arrayType: 'custom-key',
        arrayKey: 'sku',
        trackedFields: [{ value: 'details.color' }, { value: 'qty' }],
      },
    ],
    singleCollection: true,
  });

  const Order = mongoose.model('OrderNested', orderSchema);

  const order = await Order.create({
    customer: { name: 'Alice', address: { city: 'Jakarta', zip: '12345' } },
    items: [{ sku: 'A', details: { color: 'red', size: 'M' }, qty: 1 }],
  });

  // Change nested fields
  order.customer.name = 'Bob';
  order.customer.address.city = 'Bandung';
  order.items = [{ sku: 'A', details: { color: 'green', size: 'M' }, qty: 2 }];
  await order.save();

  const LogHistory = mongoose.model('LogHistory', mongoose.Schema({}, { strict: false }), 'log_histories');
  const logs = await LogHistory.find({ model_id: order._id }).lean();
  console.log('Nested trackedFields log:\n', JSON.stringify(logs, null, 2));
  // Example log entry:
  // [
  //   {
  //     "logs": [
  //       { "field_name": "customer.name", "from_value": "Alice", "to_value": "Bob", "change_type": "edit" },
  //       { "field_name": "customer.address.city", "from_value": "Jakarta", "to_value": "Bandung", "change_type": "edit" },
  //       { "field_name": "items.details.color", "from_value": "red", "to_value": "green", "change_type": "edit" },
  //       { "field_name": "items.qty", "from_value": 1, "to_value": 2, "change_type": "edit" }
  //     ],
  //     ...
  //   }
  // ]

  await mongoose.disconnect();
}

main();
