# Changelog

All notable changes to **ITACM — IT Asset Control Pro** are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/) and the
project adheres to [Semantic Versioning](https://semver.org/).

## [1.3.22] — 2026-08-04

### Fixed
- **Hardware list no longer gets stuck on empty/ghost rows after a return, repair
  or scrap.** After such an action the list refreshes with the same filters, so
  the URL hash is unchanged and the browser fires no `hashchange` — the freshly
  painted skeleton was then never replaced and the table looked permanently empty.
  The refresh now re-runs the view explicitly when the hash does not change, so the
  skeleton is always replaced with fresh data (and the action's result actually
  shows without a manual reload).

## [1.3.21] — 2026-08-04

### Added
- **Skeleton on the first paint of the hardware list too.** 1.3.19 ghosted the
  rows only on in-view search/filter refetches, which flash by when the API is
  fast. Opening the hardware page (or arriving from another view) now shows a full
  skeleton — header, metric cards, toolbar and ghost rows — while the first load
  is in flight, so the loading state is actually visible. In-view search still
  ghosts just the rows and keeps the search box mounted.

## [1.3.20] — 2026-08-04

### Fixed
- **Front-end updates now reach browsers on a normal refresh — no hard-refresh
  needed.** The JS/CSS in `index.html` are cache-busted with manual `?v=` query
  strings that had not been bumped for the files changed in 1.3.14–1.3.19, so a
  cached browser kept running the old scripts after `git pull` (this is why the
  search fix, the scanner gate and the localisations appeared not to take). Bumped
  the `?v=` on every changed asset (app.css, i18n.js, ui.js, mobile-shell.js and
  the assets/onboarding/hr/dashboard/catalog/users views) so the browser fetches
  the new versions automatically.

## [1.3.19] — 2026-08-04

### Fixed
- **Search no longer drops the last character you type.** Typing e.g. `1337` in
  the hardware search could lose the final digit: the debounced search re-renders
  the list, and any keystroke entered while the results were being fetched landed
  in an input that was about to be replaced. The debounced search now mirrors the
  live value and restores it (and re-applies it) after the re-render, so fast
  typing survives. This applies to every debounced search box in the app.

### Added
- **Skeleton loading for the hardware list.** When a search, filter, sort or page
  change refetches, the list now shows shimmering ghost rows instead of feeling
  like a full-page refresh.

## [1.3.18] — 2026-08-03

### Fixed
- **Mobile modal action bar no longer covers the screen.** On phones the modal
  footer stacked every action button full-width in a single column, so an
  action-heavy dialog — e.g. the asset detail with Close / QR / Label / Edit /
  Duplicate / Repair / Handover — produced a ~7-row footer that filled the lower
  half of the screen and pushed the body content behind it. The footer is now a
  2-column grid (a lone trailing button spans the full width), roughly halving its
  height so the scrollable body keeps its room.

## [1.3.17] — 2026-08-03

### Fixed
- **Barcode/QR scanner: closed the last un-gated entry point.** v1.3.14 hid the
  scanner from users without inventory access on the desktop topbar and the mobile
  center FAB, but the **"Scan asset" item in the mobile "More" sheet** was still
  shown to everyone. It is now gated on the same `asset:read` permission, so Portal
  (self-service), HR and other restricted users no longer see any way to open the
  camera scanner.

## [1.3.16] — 2026-08-03

### Fixed
- **Localized the Onboarding wizard, reports, status badges and the catalog-model
  dialog.** Several surfaces still showed English inside a non-English UI:
  - Onboarding wizard field labels (Full name / Email / Department / Title /
    Notes), the stock filter, "no stock / no free lines" empty states, the
    review step (Employee / Reserved assets / Reserved lines) and the
    Cancel / Back / Next buttons.
  - Asset **status badges** (In Stock / Assigned / In Repair / Reserved / Scrap /
    Sold, plus Active / Inactive) now translate everywhere via a single display
    helper — the canonical English value is unchanged, so filters and exports
    keep working. The **EOL / EOL soon** lifecycle pills are localized too.
  - **Report** chrome: Print / Export CSV buttons, the "first 100 of N rows"
    preview note, the row-count footer, common column headers and the
    "N assigned assets across M employees" summary. CSV exports keep English
    headers for stable downstream parsing.
  - The **Add catalog model** dialog (title, field labels, placeholder, submit
    button and success toast).

### Changed
- **HR onboarding email is now optional for HR — IT fills it in.** HR often does
  not know a new hire's address when filing the ticket. The HR onboarding form no
  longer requires an email; when IT acknowledges the request on the dashboard, it
  prompts for a valid email (only when the ticket has none) and saves it onto the
  request before provisioning the employee. A new migration
  (`046_hr_request_optional_email.sql`) rebuilds the pending-onboard dedup index so
  it only applies to tickets that actually carry an email.

## [1.3.15] — 2026-08-03

### Fixed
- **Localized the New IT User and Transfer Ownership dialogs.** Their field labels,
  hints and buttons were hardcoded in English regardless of the selected UI
  language; they now use the 12-language i18n. The New IT User dialog also notes
  that if the person already has web (self-service) access it must be removed first
  (one login per person).

## [1.3.14] — 2026-08-03

### Fixed
- **Barcode/QR scanner no longer offered to users without inventory access.** The
  mobile center scan FAB (and the desktop topbar scan button) showed for Portal
  self-service and HR accounts even though they can't read assets — the scan looks
  an asset up by its tag, so it was useless (and would prompt for the camera) for
  them. Both are now gated on `asset:read`; the mobile nav keeps its layout with an
  empty center when the scanner is hidden.

## [1.3.13] — 2026-08-03

### Added
- **`npm run update` — one-command update.** Backs up the database, `git pull`s,
  and rebuilds with the compose profile your `.env` implies — plain
  (`docker compose up`), own domain (`--profile tls`), or Cloudflare
  (`--profile cloudflare`, detected from `APP_DOMAIN` + `certs/origin.pem`) — so
  you never have to remember which `--profile` / `--build` flag to pass. Then it
  prints the version now running. `npm run update -- --dry-run` previews the
  detected command without changing anything. `.env` and `certs/` are untouched.

## [1.3.12] — 2026-08-03

### Added
- **Running version shown in the sidebar.** A small, muted label (e.g. `v1.3.12`)
  now sits at the bottom of the left sidebar so the current version is visible at
  a glance (previously only under Help → About). It reads what the backend reports
  at `/api/config`, so after an update it reflects the running build — a quick way
  to confirm a rebuild actually took effect.

## [1.3.11] — 2026-08-03

### Added
- **Manual "Check now" button for software updates** (Integrations → Software
  updates, Owner). The automatic check runs at most once a day; this button forces
  an immediate check against GitHub and shows the result inline — "you're on the
  latest version (vX)", "update available: vX", or "couldn't reach the update
  server". It runs regardless of the auto-check toggle (clicking is explicit
  consent). New `POST /api/integrations/update-check` (integration:manage); the
  check awaits the result and ignores the daily throttle.

## [1.3.10] — 2026-08-03

### Added
- **`npm run setup` now configures HTTPS interactively.** The new-install wizard
  asks how the app will be reached — local HTTP, own domain (auto HTTPS via
  Caddy), or behind Cloudflare — and writes the matching `.env` (`APP_DOMAIN`,
  `APP_URL`, `TRUST_PROXY`, host-local `API_PORT`) plus the exact
  `docker compose --profile …` start command. For the Cloudflare path it walks
  you through creating an Origin Certificate and lets you **paste the certificate
  and key straight in**, writing `certs/origin.pem` / `certs/origin.key` (key
  `chmod 600`) for you — no manual file editing. It then prints the steps only you
  can do (DNS record, Cloudflare SSL mode, firewall).

## [1.3.9] — 2026-08-03

### Changed
- **AI assistant is now a matrix-controlled permission (`ai:use`).** Previously
  every non-Portal/HR user could open the assistant; it now requires the new
  `ai:use` permission, so access is granted per group in the IAM matrix. Owner
  and Admin get it by default (migration 045 + role fallback); Helpdesk, Viewer
  and custom groups must be granted it explicitly. `/api/ai/status`, `/query` and
  `/exports/:id` enforce it, so the launcher simply doesn't appear for users who
  lack it. The assistant's tools still apply each user's own per-resource RBAC on
  top of this.

## [1.3.8] — 2026-08-03

### Documentation
- **Cloudflare HTTPS guide completed + update pitfall fixed.** The "Behind
  Cloudflare" section now includes the DNS A-record and firewall (`443`) steps,
  so it's a full from-scratch walkthrough. The Updating section now warns that if
  you started with an HTTPS profile (`--profile tls` / `--profile cloudflare`)
  you must pass the **same flag** when updating — otherwise the reverse-proxy
  container isn't recreated and HTTPS goes down. Docs only.

## [1.3.7] — 2026-08-03

### Documentation
- **README brought up to date with the AI assistant** (added in 1.3.0 but not
  documented): a new Feature-highlights entry, a Modules-table row, `/api/ai/*`
  in the API reference, and `AI_*` / `APP_URL` / `APP_DOMAIN` in the
  configuration reference. No code changes.

## [1.3.6] — 2026-08-03

### Added
- **Turnkey HTTPS behind Cloudflare (Origin Certificate).** New
  `docker compose --profile cloudflare up -d` serves the app on 443 with a
  Cloudflare Origin Certificate instead of Let's Encrypt — which cannot be issued
  behind Cloudflare's orange-cloud proxy. Drop the cert/key from Cloudflare
  (SSL/TLS → Origin Server) into `certs/`, set `APP_DOMAIN`, keep the api
  host-local, and switch Cloudflare to Full (strict) for end-to-end TLS. New
  `Caddyfile.cloudflare` and `caddy-cf` service; `certs/` keys are git-ignored
  (with a README); README and `.env.example` now document both HTTPS paths (`tls`
  for direct, `cloudflare` for proxied). Off by default; the standard stack is
  unchanged.

## [1.3.5] — 2026-08-03

### Fixed
- **Onboarding tour no longer shows developer setup notes.** The "See the product
  in action" step listed "drop your own video at /media/how-it-works.mp4" and
  "set ONBOARDING_VIDEO_URL" — internal setup instructions that don't belong in an
  end-user wizard. Replaced with a single plain-language line (EN + TR); the step
  still falls back to the built-in animated demo reel when no video is configured.

## [1.3.4] — 2026-08-03

### Added
- **Loading states.** A first-load **boot splash** (centered spinner + product
  name) now covers the brief gap before the app picks onboarding / login /
  dashboard — no more blank flash on startup, with a failsafe so it can never
  stick. Page navigation shows a proper **spinner** in the content area instead
  of plain "Loading…" text, matching the 404 / 403 / error screens.

## [1.3.3] — 2026-08-03

### Added
- **One-command automatic HTTPS (Caddy `tls` compose profile).** `docker compose
  --profile tls up -d` runs a bundled Caddy reverse proxy that fetches and renews
  a Let's Encrypt certificate for `APP_DOMAIN` on its own — HTTP→HTTPS redirect
  included, no certbot / nginx / manual certificates. Off by default, so the
  standard stack is unchanged. New `Caddyfile`; documented in the README and
  `.env.example` (`APP_DOMAIN`, plus the `TRUST_PROXY=1` / `APP_URL` pairing).

## [1.3.2] — 2026-08-03

### Added
- **"App URL" setting (Integrations → Notifications).** The public address this
  instance is reached at, used for links in outbound email (alert digest,
  handover, owner-transfer). Previously those links came only from the
  undocumented `APP_URL` / `PUBLIC_URL` env var and defaulted to
  `http://localhost:8000`, so a deployed instance mailed broken localhost links.
  It's now set in-app (no `.env` editing), validated and normalized (http/https,
  trailing slash stripped), localized across 12 languages. The env var remains a
  fallback and is documented in `.env.example`.

## [1.3.1] — 2026-08-03

### Fixed
- **AI assistant launcher advertised the wrong shortcut.** The floating launcher
  showed `⌘K`, but `⌘K` is bound to global search, so it never opened the
  assistant (the working shortcut is `⌘J`). Corrected the badge and tooltip to
  `⌘J` across all 12 locales; clicking the launcher continues to work.
- **Department-scoped employee directory was inaccessible.** A user whose
  `employee:read` grant carried a department constraint got a 403 on the whole
  directory — the list gate evaluated the constraint against an empty context and
  failed closed, before the row-scoping filter could run. List reads are now
  gated on the capability (`requireCapability`) and the department scope is
  enforced on the rows, so such users see exactly their department(s). Fails
  safe: no grant → still 403; cross-department detail reads remain blocked.

### Security
- **body-parser bumped to 1.20.6** (from 1.20.5) to clear a low-severity DoS
  advisory (GHSA-v422-hmwv-36x6). `npm audit`: 0 vulnerabilities. Follows a deep
  security review (auth/JWT, IAM constraints, injection, SSRF, path-traversal,
  CSV formula injection, XSS/CSP) that surfaced no exploitable High/Critical/
  Medium issues.

### Added
- **Designed 404 / 403 / error screens.** Unknown routes now show a localized
  404 page (previously a silent redirect to the dashboard); routes the user
  cannot open show a 403 "access denied" page; a view that fails to load shows an
  error screen with Retry / Home actions. All render in the content area with the
  navigation intact, in the selected language (12 locales).

## [1.3.0] — 2026-08-02

### Added
- **AI assistant (natural-language queries).** A provider-agnostic chat
  assistant answers questions about the inventory in the selected UI language.
  Works with a local Ollama model or a cloud API (OpenAI, DeepSeek, Anthropic,
  Groq, Mistral, Together, OpenRouter, or a custom endpoint), with streaming
  answers, result tables, CSV export, auto charts, and a collapsible "show SQL"
  view. **Disabled by default** — an admin enables it under Integrations → AI.
- **Guarded advanced queries.** For analytical questions the assistant can run a
  read-only `advanced_query` against a curated `ai.*` view schema — never the
  base tables. Executed under a low-privilege NOLOGIN role via `SET LOCAL ROLE`
  in a read-only, statement-timed transaction (always rolled back), behind an
  app-side single-SELECT validator.

### Security
- **Per-resource RBAC on `advanced_query`.** Every `ai.*` view maps to an app
  permission; the caller must hold read on each view a query touches, so the
  assistant cannot surface data (contracts, costs, lines…) a role is denied
  elsewhere. Matching is fail-safe (can only withhold, never grant).
- **`ai.contracts` hardened with `security_barrier`** (migration 044) to block
  leaky-qual oracles across the Confidential-row filter.
- **Per-user rate limit on `/api/ai/query`** (default 20/min, `AI_QUERY_RATE_MAX`
  to override) to contain provider cost and abuse.
- **SSRF-safe outbound** to AI endpoints (DNS-pinned; private/reserved/metadata
  addresses blocked) and **encrypted-at-rest, masked** provider API keys.

### Migrations
- `042_ai_settings.sql`, `043_ai_query_schema.sql`, `044_ai_contracts_security_barrier.sql`
  run automatically on start.

### Fixed
- **Handover screen fully localized.** The document-generation panel and other
  handover UI strings (In Stock Only, Single/Separate document, Confirm & Print,
  basket labels, condition-note fields, acknowledgement modal, etc.) were
  hardcoded in English; they now follow the selected language across 12 locales.

## [1.2.24] — 2026-07-30

### Added
- **Server-side account recovery: `npm run reset-password`.** Resets an Owner/IT
  user password (forces a change on next login, revokes sessions) and, with
  `--clear-mfa`, removes their TOTP so a locked-out Owner who lost their
  authenticator can regain access. Runs only on the box/container (no network
  endpoint), so it adds no attack surface. Docs: README recovery section.

## [1.2.23] — 2026-07-30

### Added
- **Startup guard: refuse to boot on a missing/weak `JWT_SECRET`** (< 32 chars).
  A short signing key makes session tokens forgeable; the server now exits with
  clear guidance (`openssl rand -hex 32`) instead of running insecurely. Existing
  installs generated by `npm run setup` (64-char key) are unaffected.

## [1.2.22] — 2026-07-30

### Fixed
- **CRITICAL: `src/utils/setupAccess.js` was corrupted** with non-code text
  prepended by an external edit tool, which committed into 1.2.21 and crash-
  looped the API (`Unexpected identifier`). Restored the file and rebuilt it.

### Changed
- **Rate-limit / brute-force IP now resolves the real client behind a trusted
  proxy.** When `TRUST_PROXY` is set (e.g. behind Cloudflare + nginx/Traefik),
  `rateLimitIp` uses `CF-Connecting-IP` (then `req.ip`) so limits are per-visitor
  instead of bucketing every user under the proxy IP. With no proxy declared it
  still uses the unspoofable TCP peer, so headers cannot be forged to dodge limits.

## [1.2.21] — 2026-07-30

### Changed
- **Removed the fleet-value strip from the dashboard** (Fleet Purchase Value /
  Current Book Value / Depreciated). Per-asset book value on the asset detail and
  the Asset Depreciation / Book Value report are unchanged.

## [1.2.20] — 2026-07-29

### Fixed
- **Portal (self-service) users appeared in the IT Users operators list and the
  role dropdown mis-displayed them as 'Owner'.** Granting an employee web access
  creates a `Portal` login (confined to `/api/me`); it is not an IT operator.
  `listUsers()` now excludes `Portal` accounts, so they no longer surface in the
  operators table. Defensive frontend guard added: a user whose role is not in
  the dropdown options now shows that role (disabled) instead of defaulting the
  browser to the first option ('Owner').

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
