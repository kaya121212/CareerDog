# Changelog

## [2.6] – 2026-05-31
### Added
- Google Sheets integration: configure a Google Apps Script URL in Profile to POST job data directly to a Sheet
- `scriptUrl` field added to profile settings
- `host_permissions` for `script.google.com` in manifest
### Changed
- Save falls back to clipboard copy when no Script URL is configured, with a hint to set it up

## [2.2] – 2026-05-28
### Changed
- Refactored all site extractors into `sites/` folder
- Extracted shared `toText()` and `register()` into `shared/utils.js`
- Removed deprecated root-level site scripts
- Added README and GPL v3 license

## [2.1.1] – 2026-05-28
### Added
- Glassdoor job listing support (Copy, Save)

## [2.1] – 2026-05-28
### Added
- Indeed job listing support (Copy, Save, Autofill)

## [2.0] – 2026-05-27
### Added
- Greenhouse job board support (Copy, Save)
### Changed
- Phone autofill now works on react-tel-input sites (e.g. Ashby)
- Added Address field to profile

## [1.3] – 2026-05-27
### Fixed
- Save/Copy now works correctly on LinkedIn search panel view

## [1.2] – 2026-05-26
### Added
- Save Job button — copies Company, Title, URL as tab-separated text for Google Sheets

## [1.1] – 2026-05-26
### Added
- LinkedIn job detail capture (title, company, description)
- Autofill for job application forms

## [1.0] – 2026-05-25
### Added
- Initial release
