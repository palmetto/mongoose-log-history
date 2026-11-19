# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.0] - 2026-11-19

### Added

- `maskedFields` plugin option: masks keyed by full dotted path, merged with the masks of tracked fields. On the same path, `maskedFields` wins. Use it to mask fields that are not tracked, so they never reach `original_doc` and `updated_doc`. A key with an array index or positional operator, such as `cards.0.number`, throws when the plugin is registered.
- Optional `maskedFields` argument to `getTrackedChanges`, merged with the masks of the tracked fields.
- Optional `maskedFields` and `itemPath` arguments to `extractLogContext`, which mask the extracted context values.

### Changed

- A mask on a path also covers every path under it in log entries, `context`, and snapshots. When a path under it has its own mask, the most specific mask wins.
- A function mask is only called with the value at its own path. A path under it is stored as `****`.
- A masked field whose value is null or undefined is now stored as is. Before, a string mask replaced it, and a function mask was called with it, which could throw and drop the history entry.
- Snapshots now hold stored fields only, whatever the schema's `toObject` options are: no virtuals or aliases, no `toObject` transforms, and populated paths stored as ids. Map fields are stored with their entries instead of as `{}`.

### Fixed

These fixes stop masked values from being stored in plaintext:

- A changed object or array logged as one value now has the masks on its nested paths applied before it is stringified. Before, a whole-subdocument update logged masked sub-fields in plaintext.
- The `valueField` of an added or removed `custom-key` array item now uses the mask on its path.
- Values copied into `context` by `contextFields`, the plugin-level option and each tracked field's own, now use the masks.
- `original_doc` and `updated_doc` now mask keys that an update sets by a dotted or positional path, such as `bank.account` or `cards.$.number`, and the elements of an array under a tracked field whose `value` has an index, such as `cards.0.number`. Before, only a key that matched a mask path exactly was masked.
- The document created by an upsert through `findOneAndUpdate` is now masked in `updated_doc`. Before, the hydrated Mongoose document was cloned from its internals, so no mask path matched.
- A document field named after an `Object.prototype` member, such as `toString`, is no longer treated as masked.

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
