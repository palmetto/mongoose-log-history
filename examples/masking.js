const mongoose = require('mongoose');
const { changeLoggingPlugin, getLogHistoryModel } = require('mongoose-log-history');

async function main() {
  await mongoose.connect('mongodb://localhost:27017/mongoose_log_history_example');

  const accountSchema = new mongoose.Schema({
    name: String,
    ssn: String,
    card: { number: String, cvc: String, brand: String },
  });
  accountSchema.plugin(changeLoggingPlugin, {
    modelName: 'AccountMasking',
    trackedFields: [
      { value: 'name' },
      {
        value: 'card',
        trackedFields: [{ value: 'number', mask: (v) => `****${String(v).slice(-4)}` }, { value: 'cvc' }],
      },
    ],
    maskedFields: { ssn: '****', 'card.cvc': '****' },
    singleCollection: true,
    saveWholeDoc: true,
  });

  const Account = mongoose.model('AccountMasking', accountSchema);

  const account = await Account.create({
    name: 'Alice',
    ssn: '123-45-6789',
    card: { number: '4000000000000002', cvc: '987', brand: 'visa' },
  });
  await Account.updateOne(
    { _id: account._id },
    { $set: { name: 'Alice B', card: { number: '4111111111111111', cvc: '123', brand: 'visa' } } }
  );

  const LogHistory = getLogHistoryModel('AccountMasking', true);
  const created = await LogHistory.findOne({ model_id: account._id, change_type: 'create' }).lean();
  const updated = await LogHistory.findOne({ model_id: account._id, change_type: 'update' }).lean();
  console.log('Created doc:', created.updated_doc);
  console.log('Update logs:', updated.logs);
  // Example:
  // Created doc: { name: 'Alice', ssn: '****', card: { number: '****0002', cvc: '****', brand: 'visa' }, ... }
  // Update logs: [
  //   { field_name: 'name', from_value: 'Alice', to_value: 'Alice B', change_type: 'edit', ... },
  //   {
  //     field_name: 'card',
  //     from_value: '{"number":"****0002","cvc":"****","brand":"visa"}',
  //     to_value: '{"number":"****1111","cvc":"****","brand":"visa"}',
  //     change_type: 'edit',
  //     ...
  //   }
  // ]

  await mongoose.disconnect();
}

main();
