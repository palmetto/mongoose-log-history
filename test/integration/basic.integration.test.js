require('../setup/mongodb');
const mongoose = require('mongoose');
const { changeLoggingPlugin } = require('../../dist');

describe('mongoose-log-history plugin - Basic Integration', () => {
  let Order;

  beforeAll(() => {
    const orderSchema = new mongoose.Schema({
      status: String,
      tags: [String],
      items: [
        {
          sku: String,
          qty: Number,
          price: Number,
        },
      ],
      created_by: {
        id: mongoose.Schema.Types.ObjectId,
        name: String,
        role: String,
      },
    });

    orderSchema.plugin(changeLoggingPlugin, {
      modelName: 'order',
      trackedFields: [{ value: 'status' }],
      singleCollection: true,
    });

    Order = mongoose.model('Order', orderSchema);
  });

  it('should allow creating a model with the plugin applied', () => {
    const order = new Order({ status: 'pending' });
    expect(order).toBeInstanceOf(Order);
    expect(order.status).toBe('pending');
  });

  it('should not throw when saving a document', async () => {
    const order = new Order({ status: 'pending' });
    await expect(order.save()).resolves.toBeDefined();
  });
});
