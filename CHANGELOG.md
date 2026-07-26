# Changelog

All notable changes to **ITACM — IT Asset Control Pro** are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/) and the
project adheres to [Semantic Versioning](https://semver.org/).

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
- `CHANGELOG.md` and a documented update path (see README "Updating").

### Changed
- `/api/health` and `/api/config` responses now include a `version` field.

## [1.0.0] — Initial release

- Self-hosted IT asset management on PostgreSQL + Docker Compose with a
  built-in web UI: hardware & infrastructure inventory, employees, transactional
  handovers (zimmet) with signed PDF receipts, licenses, consumables, contracts,
  maintenance, providers, approval workflows, org chart, HR onboarding/offboarding
  requests, document archive, audit trail, IAM roles (Owner/Admin/Helpdesk/
  Viewer/Portal/HR), MFA, and a 12-language UI.

[1.1.0]: https://github.com/enesyaks/ITACM/releases/tag/v1.1.0
[1.0.0]: https://github.com/enesyaks/ITACM/releases/tag/v1.0.0
