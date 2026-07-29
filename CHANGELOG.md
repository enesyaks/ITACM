# Changelog

All notable changes to **ITACM — IT Asset Control Pro** are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/) and the
project adheres to [Semantic Versioning](https://semver.org/).

## [1.2.19] — 2026-07-29

### Changed
- **IT Users / IAM screens localized in all 12 languages.** The IT Users list
  (subtitle, buttons, permission-group cards incl. built-in descriptions, the
  operators table + status/role columns) and the IAM permissions-matrix modal
  chrome (warnings, matrix header, resource/actions columns, buttons) now go
  through the i18n layer. The technical permission tokens (read/create/asset/…)
  stay as-is since they mirror the API identifiers.

## [1.2.18] — 2026-07-29

### Added
- **Custom report builder: filter Hardware Assets by assignment + employee.** A
  new **Assignment** filter (All / Assigned / Unassigned) and a multi-select
  **Assigned to (employees)** filter let you build a custom report scoped to one
  or more specific holders.

### Changed
- **Custom report builder localized in all 12 languages** — data-source cards,
  step labels, filter labels / options, column chips, Generate/preview text and
  the generated custom-report title/columns now go through the i18n layer.

## [1.2.17] — 2026-07-29

### Changed
- **Help & tips modal localized in all 12 languages.** UI-tips toggle, page-tip
  callout, guided-tour / replay-intro buttons, keyboard shortcuts, role
  descriptions and the About text now go through the i18n layer.

## [1.2.16] — 2026-07-29

### Changed
- **Reports module localized in all 12 languages.** The page subtitle, KPI stat
  tiles, range selector, Ready/Build-your-own tabs, search, group filter pills,
  and all 20 preset report titles + descriptions + the Open action now go
  through the i18n layer.

## [1.2.15] — 2026-07-29

### Changed
- **Maintenance & Repair and Stock Count localized in all 12 languages.** Wired
  the maintenance list (filters, columns, In-Repair pill, Notes/Close), the
  close-repair dialog, the repair notes & documents modal, and the stock-count
  session table (columns, Open/Closed pills, Continue/Result) through t().

## [1.2.14] — 2026-07-29

### Changed
- **Hardware list header and Product Catalog EOL tables localized in all 12
  languages.** The hardware page subtitle + "managed separately" note and the
  per-model / per-category lifecycle (EOL) tables (Brand/Model/Lifecycle columns,
  "mo" unit, Delete) now go through t().

## [1.2.13] — 2026-07-29

### Changed
- **Provider / contract forms and the license "Assigned" modal localized in all
  12 languages.** Wired the provider and contract form fields (website, company
  / support contact fields, billing, dates, cost, owner, etc.) and the license
  holders modal (Users/Devices headers, Revoke/Close, empty state) through t().
  Also fixed the EN/TR-only `hr.status` key that was poisoning the reverse-index
  lookup for the word "Status" in other languages.

## [1.2.12] — 2026-07-29

### Changed
- **Consumables and Mobile Lines localized in all 12 languages.** Wired their
  list views (columns, status pills, empty states, action buttons), the
  new/adjust consumable dialogs and the new/edit mobile-line form (labels,
  placeholders, status options) + toasts through the i18n layer.

## [1.2.11] — 2026-07-29

### Changed
- **Hardware (asset) detail modal localized in all 12 languages.** Its overview/
  specs/infrastructure labels, lifecycle bar, licenses/note/custom-field/history/
  repair sections, footer actions and the return dialog were hardcoded English
  and now go through the i18n layer (new `hw.d.*` keys, all 12 languages).

## [1.2.10] — 2026-07-29

### Changed
- **Employees module localized in all 12 languages.** Wired the directory list
  (header, search, columns, filter chips, empty states, action titles), the
  person-detail modal (assigned assets/software/lines/contracts, handover
  receipts, documents tab) and the portal-credentials dialog through the i18n
  layer, filling DE, FR, ES, IT, PT, NL, PL, RU, AR, JA.

## [1.2.9] — 2026-07-29

### Changed
- **Asset form and License module now ship real translations for all 12
  languages** (previously EN/TR only). Every `asset.f.*` and `lic.*` key is
  filled for DE, FR, ES, IT, PT, NL, PL, RU, AR, JA. Continues the 12-language
  coverage started with the dashboard; RU/AR/JA are machine-assisted.

## [1.2.8] — 2026-07-29

### Changed
- **Dashboard now ships real translations for all 12 languages** (not just EN/TR
  with English fallback). Every `dash.*` string is filled for DE, FR, ES, IT, PT,
  NL, PL, RU, AR, JA. Start of expanding the whole UI to genuine 12-language
  coverage; RU/AR/JA are machine-assisted and benefit from a native review.

## [1.2.7] — 2026-07-29

### Fixed
- **Dashboard was largely in English regardless of language.** Localized the
  whole dashboard: KPI cards, fleet-value strip, scheduled-onboarding and HR
  panels, recent-handover and EOL tables, the "Attention Required" cards, asset
  distribution and license-expiry panels, and the location breakdown popup
  (new `dash.*` keys with Turkish; other languages fall back to English).

## [1.2.6] — 2026-07-29

### Fixed
- **License list view + renew/cancel/assign dialogs were still English.**
  Continued the localization pass: page header, table headings, status pills,
  row hints, action-button titles, empty state, and the renew/cancel/assign
  dialog fields / toasts now use the i18n layer (Turkish; others fall back to
  English). Part of the ongoing full-app localization.

## [1.2.5] — 2026-07-29

### Fixed
- **License add/edit form was always in English.** Wired its labels, section
  headings, hints, placeholders, dropdown options, buttons and the renew/cancel/
  assign dialog titles through the i18n layer (new `lic.f.*` keys with Turkish;
  other languages fall back to English). Continues the form-i18n pass started
  with the asset form in 1.2.4.

## [1.2.4] — 2026-07-29

### Fixed
- **Add/Edit asset form was always in English**, ignoring the selected UI
  language. Its labels, section headings, hints, placeholders and buttons were
  hardcoded. They now go through the i18n layer (~50 new `asset.f.*` keys, with
  Turkish translations; other languages fall back to English as usual). Purely
  technical labels (MAC, OS, CPU/RAM/STORAGE) are intentionally left untranslated.

## [1.2.3] — 2026-07-29

### Fixed
- **Report print stopped after one page.** Printing a preset report (e.g. Full
  Inventory, 300+ rows) reused the one-page handover-receipt print styles, which
  clamp the sheet to a single A4 page (`max-height` + `overflow: hidden`), so
  every row past the first page was clipped. Report prints now carry a
  `receipt-report` modifier that lets the table flow across as many pages as
  needed, repeats the column header on each page, and avoids splitting a row.

## [1.2.2] — 2026-07-29

### Fixed
- **Update popups showed a raw `<span class="ms">…</span>` tag in the title.**
  `openModal` escapes its title (by design), but the "Update available" and
  "System updated" dialogs embedded an icon as HTML in the title string, so the
  markup rendered as literal text. `openModal` now takes an optional `icon`
  parameter and both dialogs pass a plain-text title — the rocket / update icon
  renders correctly again.

## [1.2.1] — 2026-07-29

### Fixed
- **Dashboard & asset create/update returned "Internal server error" on 1.2.0.**
  The depreciation feature referenced an `assets.cost` column that was never
  created — the `NUMERIC cost` column lives on `maintenance_logs`, not `assets`.
  Added migration `041_asset_cost.sql` (and the matching `schema.sql` column) so
  the dashboard EOL/fleet-value query and asset writes work. Existing 1.2.0
  installs pick up the column automatically on next start.
- **Guided sidebar tour (coach-marks) was cut off at the bottom.** Taller steps
  now measure their real height and clamp their position so the whole card —
  including the Skip / Next buttons — always stays on-screen.

## [1.2.0] — 2026-07-29

### Added
- **Straight-line asset depreciation / book value.** Every asset now carries a
  **purchase cost** and an optional **salvage value**; the current **book value**
  is computed straight-line over the *same* lifecycle window the EOL engine
  already resolves (per-asset → catalog model → category default). Shown on the
  asset detail ("Book value · N% depreciated") and rolled up on the dashboard as
  **Fleet Purchase Value / Current Book Value / Depreciated** (active inventory),
  and exportable as a new **Asset Depreciation / Book Value** preset report
  (Reports → Hardware) with per-asset cost, salvage, book value and totals.
  - The lifecycle-resolution rule was extracted into a pure, unit-tested
    `src/utils/depreciation.js` shared by the asset service and the dashboard EOL
    engine, so EOL dates and book values can never drift apart.
  - Schema: one nullable `assets.salvage_value` column (migration
    `040_asset_salvage_value.sql`); the existing `assets.cost` column is now
    editable from the asset form. A category with a 0 lifecycle is excluded from
    depreciation (keeps full value), matching its EOL behaviour.
- **Scheduled automatic alert digests.** The alert digest (expired/expiring
  licenses, low stock, EOL overdue, onboarding due) can now be sent
  automatically on a **daily** or **weekly** cadence, configured under
  **Integrations → SMTP & alert digest** (Auto-send: Off / Daily / Weekly, with
  a time-of-day and — for weekly — a weekday, in server local time). Previously
  the digest only fired when an admin clicked **Run digest now**.
  - A lightweight in-process scheduler (1-minute tick, no new dependency) runs
    `runScheduledDigest()`; all "is it due / already ran today" logic lives in
    the pure, unit-tested `src/utils/digestSchedule.js`.
  - The cadence is stored inside the existing `app_settings.notify_json`
    (`schedule`, `hour`, `weekday`, plus a server-managed `lastRunDate` guard) —
    **no schema migration required**. Default is `off`, so existing instances
    are unchanged until an Owner/Admin opts in.

## [1.1.1] — 2026-07-27

### Added
- **Owner toggle for the upstream update check** under **Integrations →
  Software updates**. The preference is persisted in `app_settings.update_check`
  (nullable — `NULL` inherits the `UPDATE_CHECK` env default, `TRUE`/`FALSE` is
  an explicit Owner choice), so the check can be turned on/off from the UI
  without editing `.env`.

### Changed
- `/api/config` now reflects the effective (DB-or-env) update-check state when
  computing `updateAvailable`.

## [1.1.0] — 2026-07-26

### Added
- **In-app update notice.** The running app version is now surfaced through
  `/api/config` and `/api/health`. When the server starts on a newer version
  than the browser last acknowledged, the **Owner** gets a one-time popup on
  their next login/reload announcing the new version, with a link to the
  release notes. Fully self-hosted — no outbound calls, no CSP change. Each
  browser stores the last-seen version in `localStorage` (`itacm_seen_version`)
  and never fires on a fresh install or a rollback.
- App version is shown in **Help → About**.
- **Opt-in upstream update check** (`UPDATE_CHECK=1`). When on, the server asks
  the GitHub Releases API — at most once a day — whether a release newer than the
  running version exists, and shows the Owner an "update available" popup with a
  link to the release. Off by default; offline / air-gapped installs never reach
  out. Configurable via `UPDATE_CHECK_REPO` and `UPDATE_CHECK_TOKEN`
  (`GITHUB_TOKEN` also accepted). _(Made toggleable from the UI in 1.1.1.)_
- `CHANGELOG.md` and a documented update path (see README "Updating").

### Changed
- `/api/health` and `/api/config` responses now include a `version` field;
  `/api/config` also carries `updateAvailable` when the upstream check is on.

## [1.0.0] — Initial release

- Self-hosted IT asset management on PostgreSQL + Docker Compose with a
  built-in web UI: hardware & infrastructure inventory, employees, transactional
  handovers (zimmet) with signed PDF receipts, licenses, consumables, contracts,
  maintenance, providers, approval workflows, org chart, HR onboarding/offboarding
  requests, document archive, audit trail, IAM roles (Owner/Admin/Helpdesk/
  Viewer/Portal/HR), MFA, and a 12-language UI.

[1.1.1]: https://github.com/enesyaks/ITACM/releases/tag/v1.1.1
[1.1.0]: https://github.com/enesyaks/ITACM/releases/tag/v1.1.0
[1.0.0]: https://github.com/enesyaks/ITACM/releases/tag/v1.0.0
