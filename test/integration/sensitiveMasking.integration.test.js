require('../setup/mongodb');
const mongoose = require('mongoose');
const { changeLoggingPlugin, getLogHistoryModel } = require('../../dist');

const lastFour = (v) => `****${String(v).slice(-4)}`;

const OLD_CARD = '4000000000000002';
const NEW_CARD = '4111111111111111';
const OLD_CVC = '987';
const NEW_CVC = '123';
const OLD_NOTE = 'old private note';
const NEW_NOTE = 'new private note';

function expectNoPlaintext(history, secrets) {
  const stored = JSON.stringify({
    logs: history.logs,
    original_doc: history.original_doc,
    updated_doc: history.updated_doc,
  });
  for (const secret of secrets) {
    expect(stored).not.toContain(secret);
  }
}

describe('mongoose-log-history plugin - Sensitive Masking', () => {
  let Account;
  let LogHistory;

  beforeAll(() => {
    const accountSchema = new mongoose.Schema({
      name: String,
      notes: String,
      card: {
        number: String,
        cvc: String,
        brand: String,
      },
      cards: [{ _id: false, id: String, number: String, label: String }],
    });

    accountSchema.plugin(changeLoggingPlugin, {
      modelName: 'Account',
      trackedFields: [
        { value: 'name' },
        {
          value: 'card',
          trackedFields: [{ value: 'number', mask: lastFour }, { value: 'cvc', mask: '****' }, { value: 'brand' }],
        },
        {
          value: 'cards',
          arrayType: 'custom-key',
          arrayKey: 'id',
          valueField: 'number',
          trackedFields: [{ value: 'number', mask: lastFour }, { value: 'label' }],
        },
      ],
      maskedFields: { notes: '[redacted]' },
      singleCollection: true,
      saveWholeDoc: true,
    });

    Account = mongoose.model('SensitiveAccount', accountSchema);
    LogHistory = getLogHistoryModel('Account', true);
  });

  const wait = () => new Promise((resolve) => setTimeout(resolve, 100));

  afterEach(async () => {
    await Account.deleteMany({});
    await LogHistory.deleteMany({});
  });

  it('masks nested values when a whole subdocument changes', async () => {
    const account = await Account.create({ name: 'a', card: { number: OLD_CARD, cvc: OLD_CVC, brand: 'visa' } });
    await Account.updateOne(
      { _id: account._id },
      { $set: { card: { number: NEW_CARD, cvc: NEW_CVC, brand: 'visa' } } }
    );
    await wait();

    const history = await LogHistory.findOne({ model_id: account._id, change_type: 'update' }).lean();
    expect(history.logs).toHaveLength(1);
    expect(history.logs[0].field_name).toBe('card');
    expect(JSON.parse(history.logs[0].from_value)).toEqual({ number: '****0002', cvc: '****', brand: 'visa' });
    expect(JSON.parse(history.logs[0].to_value)).toEqual({ number: '****1111', cvc: '****', brand: 'visa' });
    expect(history.updated_doc.card.number).toBe('****1111');
    expectNoPlaintext(history, [OLD_CARD, NEW_CARD, OLD_CVC, NEW_CVC]);
  });

  it('masks a field listed in maskedFields that is not tracked', async () => {
    const account = await Account.create({ name: 'a', notes: OLD_NOTE });
    await Account.updateOne({ _id: account._id }, { $set: { name: 'b', notes: NEW_NOTE } });
    await wait();

    const created = await LogHistory.findOne({ model_id: account._id, change_type: 'create' }).lean();
    expect(created.updated_doc.notes).toBe('[redacted]');
    expectNoPlaintext(created, [OLD_NOTE]);

    const history = await LogHistory.findOne({ model_id: account._id, change_type: 'update' }).lean();
    expect(history.logs.map((l) => l.field_name)).toEqual(['name']);
    expect(history.updated_doc.notes).toBe('[redacted]');
    expectNoPlaintext(history, [OLD_NOTE, NEW_NOTE]);
  });

  it('masks the valueField of custom-key array items that are added or removed', async () => {
    const account = await Account.create({ name: 'a', cards: [{ id: 'c1', number: OLD_CARD, label: 'old' }] });
    await Account.updateOne({ _id: account._id }, { $set: { cards: [{ id: 'c2', number: NEW_CARD, label: 'new' }] } });
    await wait();

    const history = await LogHistory.findOne({ model_id: account._id, change_type: 'update' }).lean();
    const removed = history.logs.find((l) => l.change_type === 'remove');
    const added = history.logs.find((l) => l.change_type === 'add');
    expect(removed.from_value).toBe('****0002');
    expect(added.to_value).toBe('****1111');
    expectNoPlaintext(history, [OLD_CARD, NEW_CARD]);
  });

  it('masks tracked fields of custom-key array items that change in place', async () => {
    const account = await Account.create({ name: 'a', cards: [{ id: 'c1', number: OLD_CARD, label: 'x' }] });
    await Account.updateOne({ _id: account._id }, { $set: { cards: [{ id: 'c1', number: NEW_CARD, label: 'x' }] } });
    await wait();

    const history = await LogHistory.findOne({ model_id: account._id, change_type: 'update' }).lean();
    expect(history.logs).toHaveLength(1);
    expect(history.logs[0].field_name).toBe('cards.number');
    expect(history.logs[0].from_value).toBe('****0002');
    expect(history.logs[0].to_value).toBe('****1111');
    expectNoPlaintext(history, [OLD_CARD, NEW_CARD]);
  });

  it('lets maskedFields override the mask on a tracked field', async () => {
    const schema = new mongoose.Schema({ name: String });
    schema.plugin(changeLoggingPlugin, {
      modelName: 'Override',
      trackedFields: [{ value: 'name', mask: 'tracked' }],
      maskedFields: { name: 'explicit' },
      singleCollection: true,
      saveWholeDoc: true,
    });
    const Override = mongoose.model('SensitiveOverride', schema);

    const doc = await Override.create({ name: 'before' });
    await Override.updateOne({ _id: doc._id }, { $set: { name: 'after' } });
    await wait();

    const history = await LogHistory.findOne({ model_id: doc._id, change_type: 'update' }).lean();
    expect(history.logs[0].from_value).toBe('explicit');
    expect(history.logs[0].to_value).toBe('explicit');
    expect(history.updated_doc.name).toBe('explicit');
  });

  it('throws if maskedFields is not an object of string or function masks', () => {
    const schema = new mongoose.Schema({ name: String });
    expect(() => {
      schema.plugin(changeLoggingPlugin, { modelName: 'Bad', trackedFields: [], maskedFields: ['name'] });
    }).toThrow(/maskedFields/);
    expect(() => {
      schema.plugin(changeLoggingPlugin, { modelName: 'Bad', trackedFields: [], maskedFields: { name: 1 } });
    }).toThrow(/maskedFields/);
  });
});
