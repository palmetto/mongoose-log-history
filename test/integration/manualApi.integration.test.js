const mongoose = require('mongoose');
const {
  changeLoggingPlugin,
  getTrackedChanges,
  buildLogEntry,
  getLogHistoryModel,
  decompressObject,
} = require('../../dist');

describe('mongoose-log-history plugin - Manual Logging API', () => {
  let LogHistory;

  beforeAll(() => {
    const schema = new mongoose.Schema({
      status: String,
      tags: [String],
      items: [
        {
          sku: String,
          qty: Number,
        },
      ],
    });
    schema.plugin(changeLoggingPlugin, {
      modelName: 'ManualApiOrder',
      trackedFields: [
        { value: 'status' },
        { value: 'tags', arrayType: 'simple' },
        {
          value: 'items',
          arrayType: 'custom-key',
          arrayKey: 'sku',
          trackedFields: [{ value: 'qty' }],
        },
      ],
      singleCollection: true,
      saveWholeDoc: true,
      compressDocs: true,
    });
    LogHistory = getLogHistoryModel('ManualApiOrder', true);
  });

  afterEach(async () => {
    await LogHistory.deleteMany({});
  });

  it('getTrackedChanges detects add, remove, edit, and no change', () => {
    const trackedFields = [
      { value: 'status' },
      { value: 'tags', arrayType: 'simple' },
      {
        value: 'items',
        arrayType: 'custom-key',
        arrayKey: 'sku',
        trackedFields: [{ value: 'qty' }],
      },
    ];
    const original = {
      status: 'pending',
      tags: ['a', 'b'],
      items: [
        { sku: 'A', qty: 1 },
        { sku: 'B', qty: 2 },
      ],
    };
    const updated = {
      status: 'done',
      tags: ['b', 'c'],
      items: [
        { sku: 'A', qty: 3 },
        { sku: 'C', qty: 4 },
      ],
    };
    const changes = getTrackedChanges(original, updated, trackedFields);
    expect(changes.some((c) => c.field_name === 'status' && c.change_type === 'edit')).toBe(true);
    expect(changes.some((c) => c.field_name === 'tags' && c.change_type === 'add')).toBe(true);
    expect(changes.some((c) => c.field_name === 'tags' && c.change_type === 'remove')).toBe(true);
    expect(changes.some((c) => c.field_name === 'items' && c.change_type === 'remove')).toBe(true);
    expect(changes.some((c) => c.field_name === 'items' && c.change_type === 'add')).toBe(true);
    expect(changes.some((c) => c.field_name === 'items.qty' && c.change_type === 'edit')).toBe(true);
  });

  it('buildLogEntry creates a valid log entry', () => {
    const modelId = new mongoose.Types.ObjectId();
    const changes = [{ field_name: 'status', from_value: 'pending', to_value: 'done', change_type: 'edit' }];
    const logEntry = buildLogEntry(
      modelId,
      'ManualApiOrder',
      'update',
      changes,
      'Alice',
      { status: 'pending' },
      { status: 'done' },
      { doc: { user: { name: 'Alice' } } },
      true,
      true
    );
    expect(logEntry.model).toBe('ManualApiOrder');
    expect(logEntry.model_id.toString()).toBe(modelId.toString());
    expect(logEntry.change_type).toBe('update');
    expect(logEntry.logs.length).toBe(1);
    expect(logEntry.created_by).toBe('Alice');
    expect(logEntry.context.doc.user.name).toBe('Alice');
    expect(logEntry.is_deleted).toBe(false);
    expect(logEntry.original_doc).toBeInstanceOf(Buffer);
    expect(logEntry.updated_doc).toBeInstanceOf(Buffer);
  });

  it('getLogHistoryModel returns the correct model', () => {
    const Model = getLogHistoryModel('ManualApiOrder', true);
    expect(Model.modelName).toMatch(/LogHistory/);
  });

  it('manual log entry can be saved and decompressed', async () => {
    const modelId = new mongoose.Types.ObjectId();
    const logEntry = buildLogEntry(
      modelId,
      'ManualApiOrder',
      'update',
      [{ field_name: 'status', from_value: 'pending', to_value: 'done', change_type: 'edit' }],
      'Alice',
      { status: 'pending', data: 'foo' },
      { status: 'done', data: 'bar' },
      { doc: { user: { name: 'Alice' } } },
      true,
      true
    );
    await LogHistory.create(logEntry);

    const log = await LogHistory.findOne({ model_id: modelId, change_type: 'update' });

    const orig = decompressObject(log.original_doc.buffer);
    const updated = decompressObject(log.updated_doc.buffer);
    expect(orig.status).toBe('pending');
    expect(orig.data).toBe('foo');
    expect(updated.status).toBe('done');
    expect(updated.data).toBe('bar');
  });

  it('getTrackedChanges returns empty array for no changes', () => {
    const trackedFields = [{ value: 'status' }];
    const original = { status: 'pending' };
    const updated = { status: 'pending' };
    const changes = getTrackedChanges(original, updated, trackedFields);
    expect(changes.length).toBe(0);
  });

  it('buildLogEntry works with minimal args (no compression)', () => {
    const modelId = new mongoose.Types.ObjectId();
    const logEntry = buildLogEntry(
      modelId,
      'ManualApiOrder',
      'create',
      [],
      null,
      null,
      { status: 'pending' },
      null,
      true,
      false
    );
    expect(logEntry.model).toBe('ManualApiOrder');
    expect(logEntry.model_id.toString()).toBe(modelId.toString());
    expect(logEntry.change_type).toBe('create');
    expect(logEntry.logs.length).toBe(0);
    expect(logEntry.created_by).toBeNull();
    expect(logEntry.updated_doc).toEqual({ status: 'pending' });
    expect(logEntry.original_doc).toBeNull();
  });
});
