# mongoose-log-history Examples

This directory contains runnable examples for common use cases:

- `basic.js` — Basic usage: create, update, fetch logs (also covers simple arrays)
- `soft-delete.js` — Soft delete support
- `batch.js` — Batch operations and batch limits
- `context-fields.js` — Logging with context fields (including item context)
- `compression.js` — Compression and decompression of document snapshots
- `user-field.js` — Using userField for user extraction (dot notation and top-level)
- `array-custom-key.js` — Tracking changes in arrays of objects (custom-key)
- `nested-trackedFields.js` — Tracking changes in nested fields and arrays
- `mongo-operators.js` — Logging for $unset, $push, $pull, $addToSet, $pop, etc.
- `manual-api.js` — Using the manual logging API

To run an example:

```bash
node examples/basic.js
```

Make sure you have MongoDB running locally, or adjust the connection string as needed.

Each example prints the log entries to the console, so you can see exactly what gets logged for each operation.