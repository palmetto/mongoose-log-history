const { getTrackedChanges, extractLogContext } = require('../../src/change-tracking');

describe('change-tracking', () => {
  describe('getTrackedChanges', () => {
    it('detects simple field changes (edit)', () => {
      const trackedFields = [{ value: 'status' }];
      const original = { status: 'pending' };
      const updated = { status: 'done' };
      const changes = getTrackedChanges(original, updated, trackedFields);
      expect(changes.length).toBe(1);
      expect(changes[0]).toMatchObject({
        field_name: 'status',
        from_value: 'pending',
        to_value: 'done',
        change_type: 'edit',
      });
    });

    it('detects field addition (add)', () => {
      const trackedFields = [{ value: 'status' }];
      const original = {};
      const updated = { status: 'done' };
      const changes = getTrackedChanges(original, updated, trackedFields);
      expect(changes.length).toBe(1);
      expect(changes[0].change_type).toBe('add');
      expect(changes[0].from_value).toBe(undefined);
      expect(changes[0].to_value).toBe('done');
    });

    it('detects field removal (remove)', () => {
      const trackedFields = [{ value: 'status' }];
      const original = { status: 'pending' };
      const updated = {};
      const changes = getTrackedChanges(original, updated, trackedFields);
      expect(changes.length).toBe(1);
      expect(changes[0].change_type).toBe('remove');
      expect(changes[0].from_value).toBe('pending');
      expect(changes[0].to_value).toBe(undefined);
    });

    it('returns empty array for no change', () => {
      const trackedFields = [{ value: 'status' }];
      const original = { status: 'pending' };
      const updated = { status: 'pending' };
      const changes = getTrackedChanges(original, updated, trackedFields);
      expect(changes.length).toBe(0);
    });

    it('returns empty array if both are null or undefined', () => {
      const trackedFields = [{ value: 'status' }];
      expect(getTrackedChanges({}, { status: null }, trackedFields).length).toBe(0);
      expect(getTrackedChanges({ status: null }, {}, trackedFields).length).toBe(0);
      expect(getTrackedChanges({ status: undefined }, { status: null }, trackedFields).length).toBe(0);
      expect(getTrackedChanges({ status: null }, { status: undefined }, trackedFields).length).toBe(0);
    });

    it('detects add when going from null to value', () => {
      const trackedFields = [{ value: 'status' }];
      const original = { status: null };
      const updated = { status: 'active' };
      const changes = getTrackedChanges(original, updated, trackedFields);
      expect(changes.length).toBe(1);
      expect(changes[0].change_type).toBe('add');
    });

    it('detects remove when going from value to null', () => {
      const trackedFields = [{ value: 'status' }];
      const original = { status: 'active' };
      const updated = { status: null };
      const changes = getTrackedChanges(original, updated, trackedFields);
      expect(changes.length).toBe(1);
      expect(changes[0].change_type).toBe('remove');
    });

    it('handles simple array changes', () => {
      const trackedFields = [{ value: 'tags', arrayType: 'simple' }];
      const original = { tags: ['a', 'b'] };
      const updated = { tags: ['b', 'c'] };
      const changes = getTrackedChanges(original, updated, trackedFields);
      expect(changes.length).toBe(2);
      expect(changes.some((c) => c.change_type === 'add' && c.to_value === 'c')).toBe(true);
      expect(changes.some((c) => c.change_type === 'remove' && c.from_value === 'a')).toBe(true);
    });

    it('handles custom-key array changes (add, remove, edit)', () => {
      const trackedFields = [
        {
          value: 'items',
          arrayType: 'custom-key',
          arrayKey: 'sku',
          valueField: 'qty',
          trackedFields: [{ value: 'qty' }],
        },
      ];
      const original = {
        items: [
          { sku: 'A', qty: 1 },
          { sku: 'B', qty: 2 },
        ],
      };
      const updated = {
        items: [
          { sku: 'A', qty: 3 },
          { sku: 'C', qty: 4 },
        ],
      };
      const changes = getTrackedChanges(original, updated, trackedFields);
      expect(changes.some((c) => c.change_type === 'remove' && c.field_name === 'items')).toBe(true);
      expect(changes.some((c) => c.change_type === 'add' && c.field_name === 'items')).toBe(true);
      expect(changes.some((c) => c.change_type === 'edit' && c.field_name === 'items.qty')).toBe(true);
    });

    it('handles nested trackedFields', () => {
      const trackedFields = [
        {
          value: 'items',
          arrayType: 'custom-key',
          arrayKey: 'sku',
          trackedFields: [{ value: 'qty' }, { value: 'price' }],
        },
      ];
      const original = { items: [{ sku: 'A', qty: 1, price: 10 }] };
      const updated = { items: [{ sku: 'A', qty: 2, price: 15 }] };
      const changes = getTrackedChanges(original, updated, trackedFields);
      expect(changes.length).toBe(2);
      expect(changes.some((c) => c.field_name === 'items.qty')).toBe(true);
      expect(changes.some((c) => c.field_name === 'items.price')).toBe(true);
    });

    it('returns empty array for untracked fields', () => {
      const trackedFields = [{ value: 'status' }];
      const original = { tags: ['a'] };
      const updated = { tags: ['b'] };
      const changes = getTrackedChanges(original, updated, trackedFields);
      expect(changes.length).toBe(0);
    });

    it('handles large arrays and objects', () => {
      const trackedFields = [{ value: 'tags', arrayType: 'simple' }];
      const original = { tags: Array.from({ length: 1000 }, (_, i) => `tag${i}`) };
      const updated = { tags: Array.from({ length: 1000 }, (_, i) => `tag${i + 1}`) };
      const changes = getTrackedChanges(original, updated, trackedFields);
      expect(changes.length).toBe(2);
    });

    it('handles missing trackedFields gracefully', () => {
      expect(getTrackedChanges({}, {}, []).length).toBe(0);
    });

    it('handles undefined original and updated', () => {
      const trackedFields = [{ value: 'status' }];
      expect(getTrackedChanges(undefined, undefined, trackedFields).length).toBe(0);
    });
  });

  describe('extractLogContext', () => {
    it('extracts context from array (doc fields)', () => {
      const contextFields = ['user.name', 'org.id'];
      const doc = { user: { name: 'Alice' }, org: { id: 123 } };
      const context = extractLogContext(contextFields, doc, doc);
      expect(context.doc.user.name).toBe('Alice');
      expect(context.doc.org.id).toBe(123);
    });

    it('extracts context from object (doc and item)', () => {
      const contextFields = {
        doc: ['user.name'],
        item: ['sku', 'qty'],
      };
      const doc = { user: { name: 'Bob' } };
      const item = { sku: 'A', qty: 2 };
      const context = extractLogContext(contextFields, doc, doc, null, item);
      expect(context.doc.user.name).toBe('Bob');
      expect(context.item.sku).toBe('A');
      expect(context.item.qty).toBe(2);
    });

    it('handles missing fields gracefully', () => {
      const contextFields = ['missing.field'];
      const doc = {};
      const context = extractLogContext(contextFields, doc, doc);
      expect(context.doc['missing.field']).toBeUndefined();
    });

    it('returns undefined if no contextFields', () => {
      expect(extractLogContext(undefined, {}, {})).toBeUndefined();
      expect(extractLogContext(null, {}, {})).toBeUndefined();
    });
  });
});
