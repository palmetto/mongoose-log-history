const mongoose = require('mongoose');
const { changeLoggingPlugin } = require('mongoose-log-history');

async function main() {
  await mongoose.connect('mongodb://localhost:27017/mongoose_log_history_example');

  // userField as nested (dot notation)
  const schema1 = new mongoose.Schema({
    status: String,
    user: { name: String, email: String },
  });
  schema1.plugin(changeLoggingPlugin, {
    modelName: 'OrderUserField',
    trackedFields: [{ value: 'status' }],
    singleCollection: true,
    userField: 'user.name',
  });
  delete mongoose.connection.models.OrderUserField;
  const Order = mongoose.model('OrderUserField', schema1);

  const order = await Order.create({ status: 'pending', user: { name: 'Alice', email: 'alice@example.com' } });
  order.status = 'done';
  await order.save();

  const LogHistory = mongoose.model('LogHistory', mongoose.Schema({}, { strict: false }), 'log_histories');
  const logs = await LogHistory.find({ model_id: order._id }).lean();
  console.log('User field log (user.name):\n', JSON.stringify(logs, null, 2));
  // "created_by": "Alice"

  // userField as top-level
  const schema2 = new mongoose.Schema({ status: String, updated_by: String });
  schema2.plugin(changeLoggingPlugin, {
    modelName: 'OrderUserFieldTop',
    trackedFields: [{ value: 'status' }],
    singleCollection: true,
    userField: 'updated_by',
  });
  delete mongoose.connection.models.OrderUserFieldTop;
  const OrderTop = mongoose.model('OrderUserFieldTop', schema2);

  const order2 = await OrderTop.create({ status: 'pending', updated_by: 'Bob' });
  order2.status = 'done';
  await order2.save();

  const logsTop = await LogHistory.find({ model_id: order2._id }).lean();
  console.log('User field log (updated_by):\n', JSON.stringify(logsTop, null, 2));
  // "created_by": "Bob"

  await mongoose.disconnect();
}

main();
