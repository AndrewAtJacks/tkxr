# Changelog

All notable changes to this project will be documented in this file.

## [1.1.10] - 2026-02-22
### Added
- Open Tasks stat button to top row dashboard
- Sprint accordion view grouped by status (Planning, Active, Completed)
- Responsive ticket card status layout for smaller screens/split-view

### Changed
- Top-row stat buttons now enforce grid view when clicked
- Ticket status buttons redesigned as unified button group
- Sprint status buttons redesigned as unified button group with Planning option
- Sprint management modal organizes sprints by status with Active section expanded by default

### Fixed
- Status button compression issues on smaller screens
- Spacebar closing comments modal while typing
- Newly created task tickets not filling full width of kanban lane

## [1.1.2] - 2026-02-21
### Changed
- Automated patch version bump and sync for root and web package.json on each build.
- Version badge in web UI now reflects actual package version.
- CLI command added for manual version bump and sync.

### Fixed
- Complete Sprint button bug.

## [1.1.1] - 2026-02-20
### Added
- Initial version sync between root and web package.json.
- Version badge in web UI.

### Changed
- UI improvements for sprint combobox.

### Fixed
- Ticket status review and bug fixes.
