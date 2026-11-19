# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.0] - 2026-11-19

### Added

- `maskedFields` plugin option: masks keyed by full dotted path, merged with the masks of tracked fields. It masks fields that are not tracked in `original_doc` and `updated_doc`.
- Optional `maskedFields` argument to `getTrackedChanges`, merged with the masks of the tracked fields.

### Fixed

- A changed object or array logged as one value now has the masks on its nested paths applied before it is stringified. Before, a whole-subdocument update logged masked sub-fields in plaintext.
- The `valueField` of an added or removed `custom-key` array item now uses the mask on its path.
- A mask on a path now also masks log entries for paths under it, unless a path under it has its own mask: the most specific mask wins.
- Values copied into a log entry's `context` by `contextFields` now use the masks on their paths. Before, they were stored in plaintext.
- `original_doc` and `updated_doc` now mask keys that an update sets by a dotted or positional path, such as `bank.account` or `cards.$.number`. Before, only a key that matched a mask path exactly was masked.
- A document field named after an `Object.prototype` member, such as `toString`, is no longer treated as masked.
- The document created by an upsert through `findOneAndUpdate` is now masked in `updated_doc`. Before, the hydrated Mongoose document was cloned field by field from its internals, so no mask path matched.
- Snapshots now hold stored fields only. Before, a schema's `toObject` options could add virtuals, aliases, or populated documents that no mask covered. Map fields are now stored with their entries instead of as `{}`.
- The plugin-level `contextFields` on create and delete entries now use the masks.
- The mask on a tracked field whose `value` has an array index now applies. A regression earlier in this release had dropped it from log entries.
- A logged object at a path with an array index, such as `slots.0`, now has the masks on its nested paths applied. Before, the index stopped them from matching.
- An explicit `maskedFields` entry now wins over a tracked field's mask on the same path even when the tracked path has an array index.
- A masked field whose value is null or undefined, such as a missing `contextFields` path, is now stored as is. Before, a function mask was called with it and could throw, which dropped the history entry.
- A path under a function mask, such as `bank.account` under a mask on `bank`, is now stored as `****`. Before, the function was called with the nested value, which could throw and drop the history entry.

## [1.1.0] - 2025-10-27

### Changed

- Migrate codebase to TypeScript

### Added

- Support for string and number types for `modelId` field
- Support for embedded dot notation fields

## [1.0.1] - 2025-08-03

### Added

- Add example folder
- Add test folder

### Fixed

- Fix `Duplicate schema index` warning

## [1.0.0] - 2025-06-15

### Added

- Initial release of `mongoose-log-history` plugin.
- Field-level change tracking for create, update, delete, and soft delete.
- Batch operation support.
- Contextual logging and custom logger support.
- Pruning utility and compression support.
- Discriminator support.
- Exposed internal helpers for manual logging.
- First stable release.

---

[Unreleased]: https://github.com/granitebps/mongoose-log-history/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/granitebps/mongoose-log-history/releases/tag/v1.1.0
[1.0.1]: https://github.com/granitebps/mongoose-log-history/releases/tag/v1.0.1
[1.0.0]: https://github.com/granitebps/mongoose-log-history/releases/tag/v1.0.0
