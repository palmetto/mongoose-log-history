# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.0] - 2026-11-19

### Added

- `maskedFields` plugin option: masks keyed by full dotted path, merged with the masks of tracked fields. It masks fields that are not tracked in `original_doc` and `updated_doc`.
- Optional `maskedFields` argument to `getTrackedChanges`.

### Fixed

- A changed object or array logged as one value now has the masks on its nested paths applied before it is stringified. Before, a whole-subdocument update logged masked sub-fields in plaintext.
- The `valueField` of an added or removed `custom-key` array item now uses the mask on its path.
- A mask on a path now also masks log entries for paths under it.

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
