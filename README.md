<div align="center">

# 🖥️ ITACM — IT Asset Control Pro

### Self-hosted IT asset management, batteries included.

Hardware & network inventory · employee handovers with printable PDF receipts · software licenses · mobile lines · vendors & contracts · repairs · physical stock counts · a full audit trail — all behind a built-in, mobile-ready web UI running entirely on your own infrastructure.

<br />

[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e.svg?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white)](https://docs.docker.com/compose/)
[![Self-hosted](https://img.shields.io/badge/Self--hosted-100%25-0ea5e9?style=flat-square)](#-quick-start--docker-compose)
[![No build step](https://img.shields.io/badge/Frontend-No%20build%20step-f59e0b?style=flat-square)](#-project-structure)
[![Mobile ready](https://img.shields.io/badge/Mobile-ready-8b5cf6?style=flat-square)](#-mobile-ready)
[![i18n](https://img.shields.io/badge/i18n-12%20languages-14b8a6?style=flat-square)](#-feature-highlights)
[![Website](https://img.shields.io/badge/Website-itacm.site-6366f1?style=flat-square)](https://itacm.site/)

<br />

**🇬🇧 English** · [🇹🇷 Türkçe →](README.tr.md)

<br />

![Dashboard](docs/screenshots/dashboard.png)

</div>

---

## 📑 Table of contents

- [Why ITACM?](#-why-itacm)
- [Screenshots](#-screenshots)
- [Feature highlights](#-feature-highlights)
- [Modules](#-modules)
- [Mobile ready](#-mobile-ready)
- [Tech stack](#-tech-stack)
- [Quick start — Docker Compose](#-quick-start--docker-compose)
- [Deploying to a server](#-deploying-to-a-server)
- [Backup & recovery](#-backup--recovery)
- [Configuration reference](#-configuration-reference)
- [API reference](#-api-reference)
- [Security notes](#-security-notes)
- [Project structure](#-project-structure)
- [Development](#-development)
- [License](#-license)

---

## 💡 Why ITACM?

Most asset trackers are either a spreadsheet that rots or a heavyweight SaaS you can't self-host. ITACM sits in the middle:

- **One command to run.** `docker compose up -d` gives you the database, schema, first admin and a full web UI — no build step, no separate frontend to deploy.
- **Handovers that hold up.** Every asset assignment is an atomic, row-locked transaction that produces a printable **Zimmet Tutanağı** (handover receipt) with your company branding.
- **The whole company, one dump.** Assets, employees, receipts, contracts, audit history and uploaded documents all live in PostgreSQL, so a single backup captures everything.
- **Works from the warehouse floor.** The UI is fully responsive with a mobile bottom-nav and a camera QR/barcode scanner — count stock or hand over a laptop from your phone.
- **Yours to keep.** No telemetry, no vendor lock-in, MIT licensed.

---

## 📸 Screenshots

<div align="center">

| Network & Server topology | Providers & Contracts |
|:--:|:--:|
| ![Network topology](docs/screenshots/network-topology.png) | ![Providers](docs/screenshots/providers.png) |
| **Mobile Lines** | **Physical Stock Count** |
| ![Mobile Lines](docs/screenshots/mobile-lines.png) | ![Stock Count](docs/screenshots/stock-count.png) |
| **Employee detail — assets, licenses, lines** | **System Audit Log** |
| ![Employee detail](docs/screenshots/employee-detail.png) | ![Audit log](docs/screenshots/audit-log.png) |
| **Printable handover receipt** | **Reports & builder** |
| ![Print preview](docs/screenshots/print-preview.png) | ![Reports](docs/screenshots/reports.png) |

<br />

<img src="docs/screenshots/mobile-dashboard.png" width="30%" alt="Mobile dashboard" />
&nbsp;&nbsp;
<img src="docs/screenshots/mobile-lines-phone.png" width="30%" alt="Mobile lines on phone" />

<sub>Responsive layout with bottom navigation and a center QR-scan button.</sub>

</div>

> More screens (hardware inventory, product catalog, handover basket, login) live in [`docs/screenshots/`](docs/screenshots).

---

## ✨ Feature highlights

<table>
<tr>
<td width="50%" valign="top">

### 🖥 Built-in, mobile-ready web UI
Served by the backend itself — no build step, strict same-origin CSP. 15 modules, global search (Cmd/Ctrl+K), QR codes, dark-mode aware, and a responsive shell with mobile bottom-nav + camera scanner. Just open `http://localhost:8000`.

### 🤝 Atomic handover basket
Assign multiple assets to an employee in one all-or-nothing transaction, producing a printable handover receipt (Zimmet Tutanağı). Row locks make double-assignment impossible; reprints preserve the original issuer's name.

### 🎨 Customizable handover designs
Live-preview editor to pick which sections, columns, titles and labels appear on the printed/PDF form, plus multiple visual themes (`terminal`, `classic`, `corporate`, `slate`).

### 🌐 Network & Server inventory
Infrastructure gear (switches, firewalls, routers, servers, storage) kept **out** of personal zimmet — assigned to a **site + responsible person** instead. Interactive **dependency topology** (per-site graphs, uplinks, cross-site parents) and **rack-cabinet** U-maps.

### 🏢 Providers & Contracts
Vendors / ISPs / MSPs as first-class records with contacts, account numbers and support lines. Attach **contracts** with renewal dates, cost, billing cycle and internal owner; 60-day renewal alerts and per-provider document storage.

### 📱 Mobile lines
Company SIM cards & phone numbers as first-class inventory: operator, plan, ICCID, monthly cost. Assign / take back with full history — lines show up on the employee profile and on handover forms.

### 🧑‍💼 Guided onboarding & offboarding
Schedule a new hire's kit (reserve assets + lines), then complete it into a single handover. Offboarding is a **transactional checklist** that returns, reassigns, scraps or sells every asset, seat, line and infra responsibility before deactivating the employee.

</td>
<td width="50%" valign="top">

### 🔐 Role-based access control
`Owner`, `Admin`, `Helpdesk`, `Viewer` roles enforced on **every** endpoint, re-checked on each request so changes apply instantly. Owners can disable or delete accounts — every disable/enable/delete/role change is recorded. Sign-in is local email/password with optional **TOTP MFA**, password change, and server-side logout (JWT revoke). There is no SSO / Entra login.

### 🧾 System-wide audit log
A unified, filterable timeline of **all** instance activity — assets, users, documents, handovers, logins, settings and more — merging the append-only audit table with legacy domain history. Search by source, actor and date; secrets are redacted before storage.

### ⏳ Product lifecycle (EOL)
Lifecycle duration per category plus per-asset overrides (e.g. MacBooks at 5 years) — or untick EOL for a category (accessories) to exclude it entirely. Every asset shows its EOL date and "EOL soon" / overdue flags.

### 📦 Physical stock counts
Open a count session and scan from **any signed-in device** — start on the PC, keep scanning barcodes/QRs from your phone camera. Closing the session reconciles against live inventory: found / missing / unknown, with CSV export.

### 📥 Excel / CSV migration
Download the template, fill it with your existing zimmet spreadsheet, upload — a dry-run preview shows exactly what will be created, then one transaction auto-creates employees, catalog entries, assets (sequential tags) and one handover per employee with full history.

### 📄 Licenses · 🏷 labels · 💱 currency
Seat pools with atomic claim/release and 30-day expiry alerts. Print scannable **Code 128** labels (size/fields/copies configurable). Pick your **display currency** for costs across the app.

### 🌍 Multi-language UI
12 languages (EN, TR, DE, FR, ES, IT, PT, NL, PL, RU, AR, JA). Pick one on the onboarding screen, change it any time in Settings; untranslated strings fall back to English.

</td>
</tr>
</table>

> 🚀 **First-run onboarding** sets your company name, logo and Owner account; branding flows into the UI and every printed receipt.
> 🧪 **Demo dataset** — `npm run seed:demo` fills Postgres with a realistic company; scale it with `SEED_EMPLOYEES=2000 npm run seed:demo -- --reset`, and add `npm run seed:infra` / `npm run seed:providers` for network gear and vendors.

---

## 🧩 Modules

The sidebar maps 1:1 to the feature set:

| Module | What it does |
|---|---|
| **Dashboard** | KPIs, attention-required alerts (licenses, low stock, EOL), asset distribution, recent activity |
| **Hardware** | Full device inventory — QR codes, bulk actions, cost/warranty, lifecycle, global search |
| **Network & Server** | Infra inventory + dependency topology + rack cabinets (site/owner, not personal zimmet) |
| **Product Catalog** | Approved brands/models, categories, locations, departments, lifecycle & spec options |
| **Software & Licenses** | Seat pools, atomic claim/release, expiry alerts, per-license holder export |
| **Mobile Lines** | SIM/phone-number inventory with assignment history |
| **Providers & Contracts** | Vendor directory + commercial agreements with renewal tracking and documents |
| **Consumables** | Stock movements with low-stock alerts |
| **Employees** | Directory, per-person detail (assets/licenses/lines/infra), onboarding & offboarding |
| **Handover Ops** | Atomic handover basket + printable/PDF receipts |
| **Maintenance & Repair** | Send to repair / return / scrap, with document attachments |
| **Stock Count** | Physical count sessions with camera scanning and reconciliation |
| **Reports** | 19 preset reports + a builder (data sources × columns × filters), CSV / letterhead print |
| **Audit Log** | Unified, filterable activity timeline (Owner/Admin) |
| **IT Users** | RBAC user management — create, role, disable/enable, delete (audited) |

---

## 📱 Mobile ready

The entire app is responsive — no separate mobile build:

- Collapsible sidebar with a **bottom navigation bar** and a center **QR-scan** button.
- **Camera** barcode/QR scanning (via a vendored ZXing build) for stock counts and quick asset lookup.
- **Start on PC, continue on phone**: open a stock-count session on your desktop and keep scanning from any signed-in device.
- Viewport-fit, theme-color and web-app meta so it behaves well when added to a home screen.

---

## 🧰 Tech stack

| Layer | Technology |
|---|---|
| **Runtime** | Node.js ≥ 20, Express 4 |
| **Database** | PostgreSQL 16 — idempotent `schema.sql` + tracked versioned migrations, applied on startup |
| **Auth** | JWT (HS256, pinned alg) + bcrypt (cost 12), role-based middleware re-checked per request |
| **Frontend** | Vanilla JS SPA served by the backend — **no build step**, split into per-view modules |
| **PDF / labels** | PDFKit + QR codes, custom handover templates, Code 128 barcodes |
| **Scanning** | Vendored ZXing browser build (camera QR/barcode) |
| **Packaging** | Docker + Docker Compose |

---

## 🚀 Quick start — Docker Compose

Everything is automatic: the database container is created, the schema + migrations are applied, and the first Admin (Owner) account is seeded.

```bash
git clone https://github.com/<you>/itacm.git
cd itacm

npm install
npm run setup          # generates .env with strong secrets (or copy .env.example)

docker compose up -d
docker compose logs api   # first-run Owner credentials are printed here
```

Then open **http://localhost:8000** — the first visit shows the onboarding wizard to set your company name/logo, pick a zimmet design and language, and create the **Owner** account.

> [!TIP]
> If you leave `ADMIN_PASSWORD` empty, a strong random password is generated and printed **once** in the API logs. Change it after first login.

Prefer to configure by hand? Copy `.env.example` to `.env`, set at least `JWT_SECRET` (`openssl rand -hex 32`), then `docker compose up -d`.

---

## 🌍 Deploying to a server

The compose file works unchanged on any host with Docker. Put a reverse proxy (Caddy / Nginx / Traefik) with TLS in front of port 8000 and set `CORS_ORIGINS` to your frontend's origin if it differs.

For managed platforms (Railway, Render, Fly.io, Cloud Run…), deploy the `Dockerfile`, attach a Postgres add-on, and set the same environment variables (`DATABASE_URL`, `PGSSL=true`, `JWT_SECRET`, `ADMIN_*`). The schema and migrations are applied automatically on startup.

---

## 💾 Backup & recovery

Your entire system — assets, employees, handover receipts, contracts, audit history and the document archive (scanned/generated PDFs) — lives in PostgreSQL. Back it up regularly.

```bash
npm run backup                 # → backups/itacm-YYYYMMDD-HHMMSS.sql.gz
npm run restore backups/itacm-20260707-120000.sql.gz   # replaces current data (asks to confirm)
```

A single dump captures everything (the document archive is stored inside the database). Copy the `backups/` folder somewhere safe, or schedule the command with cron, e.g. daily at 02:00:

```cron
0 2 * * *  cd /path/to/ITACM && npm run backup
```

### Changing the database password

`POSTGRES_PASSWORD` is fixed when the database volume is first created. **Editing it in `.env` and restarting will not work** — the API will fail to authenticate. To rotate it safely, without losing any data:

```bash
npm run change-db-password
```

> [!WARNING]
> **Never run `docker compose down -v`.** The `-v` flag deletes the database volume and permanently destroys all your data. If the API ever reports `password authentication failed`, run `npm run change-db-password` (or restore the previous password in `.env`) — do not wipe the volume.

---

## ⚙️ Configuration reference

| Variable | Required | Description |
|---|:---:|---|
| `PORT` / `API_PORT` | – | HTTP port (default `8000`) |
| `CORS_ORIGINS` | – | Comma-separated allowed origins (blank = same-origin) |
| `DATABASE_URL` | ✅ | `postgres://user:pass@host:5432/db` (or `POSTGRES_URL`) |
| `PGSSL` | – | `true` for managed Postgres over TLS |
| `JWT_SECRET` | ✅ | Min 32 chars — `openssl rand -hex 32` |
| `JWT_EXPIRES_IN` | – | Token lifetime (default `12h`) |
| `ADMIN_EMAIL` / `ADMIN_USERNAME` / `ADMIN_PASSWORD` | – | First-run Owner seed (password auto-generated if empty) |

With docker compose, `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` feed both the database container and the API's `DATABASE_URL`.

---

## 🔌 API reference

All responses are `{ success, data }` or `{ success: false, error, details? }`. All endpoints (except `login` / `health`) require `Authorization: Bearer <TOKEN>`. Every router applies `authenticate`; writes/deletes additionally require a role.

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| POST | `/api/auth/login` | public | Email/password → JWT |
| POST | `/api/auth/verify-token` | any | Validate token, return profile + permissions |
| GET/POST | `/api/auth/users` | Admin | List / create IT users |
| PATCH | `/api/auth/users/:uid/role` · `/status` | Admin/Owner | Change role · disable/enable (audited) |
| DELETE | `/api/auth/users/:uid` | Owner | Delete an IT user (audited) |
| GET | `/api/dashboard/stats` | all | KPIs, alerts, recent activity |
| GET | `/api/assets` · `/:id` | all | Inventory list (`?status=&category=&search=`) · detail + history |
| POST/PUT | `/api/assets` · `/:id` | Admin, Helpdesk | Create / update hardware & infra |
| POST | `/api/assets/:id/return` | Admin, Helpdesk | Return an assigned asset to stock |
| POST | `/api/handovers` | Admin, Helpdesk | **Atomic handover basket** (below) |
| GET | `/api/handovers` · `/:id` | all | Receipts (feed the printable form) |
| GET/POST | `/api/onboardings` … `/:id/complete` · `/cancel` | Admin, Helpdesk | Schedule / complete / cancel onboarding |
| POST | `/api/employees/:id/offboard` | Admin, Helpdesk | Transactional offboarding disposition |
| GET/POST | `/api/maintenance` · `/:id/close` | Admin, Helpdesk | Repair logs / send / close (`{scrap:true}`) |
| GET | `/api/employees` | all | Directory + handover selector |
| POST/PUT | `/api/employees` · `/:id` | Admin, Helpdesk | Create / update |
| GET/POST | `/api/licenses` · `/:id/assign` · `/revoke` | Admin, Helpdesk | Seat pools + atomic claim/release |
| GET/POST | `/api/lines` · `/:id/assign` · `/unassign` | Admin, Helpdesk | Mobile lines + history |
| GET/POST | `/api/providers` · `/contracts` | Admin, Helpdesk | Vendors & contracts (+ document upload/download) |
| GET/POST | `/api/consumables` · `/:id/adjust` | Admin, Helpdesk | Stock + atomic movements |
| GET/POST | `/api/counts` · `/:id/scan` · `/close` | Admin, Helpdesk | Physical stock-count sessions |
| GET/PUT | `/api/catalog/*` | Admin, Helpdesk | Catalog, locations, departments, settings |
| POST | `/api/import/inventory` | Owner, Admin | Excel/CSV migration (dry-run + commit) |
| GET | `/api/documents/:id/download` | Owner, Admin, Helpdesk | Stream a stored handover document (auth required) |
| GET | `/api/audit` · `/:bucket/:id` | Owner, Admin | Unified audit timeline + event detail |

<details>
<summary><b>The atomic handover basket — how it works</b></summary>

<br />

```http
POST /api/handovers
{
  "employeeId": "…",
  "documentType": "single",
  "items": [
    { "assetId": "…", "conditionNote": "New, sealed box" },
    { "assetId": "…", "conditionNote": "Used, good condition" }
  ]
}
```

In **one transaction** (Postgres `BEGIN … FOR UPDATE`): every asset is validated as `In Stock` → the receipt document is created → each asset flips to `Assigned` bound to the employee → the employee's `activeAssetCount` is incremented → one audit row is written per asset.

If **any** asset is locked, the API returns `409` with a per-asset conflict list and **nothing is written**. Row locks / transaction retries make it impossible for two operators to hand over the same laptop concurrently.

</details>

---

## 🔒 Security notes

- **Secrets never live in the repo.** `.env` is git-ignored; the setup wizard writes it with `0600` permissions and generates a strong `JWT_SECRET` and DB password for you. Database backups (`backups/`) are git-ignored too.
- **Auth:** passwords are bcrypt-hashed (cost 12); JWTs are signed HS256 with the algorithm **pinned** on verify; login uses a single error message and a constant-time compare (dummy hash for unknown emails) so it can't be used to enumerate accounts; every request re-checks the user row so role changes / disables / deletes apply instantly.
- **Access control:** every API router mounts `authenticate`, and mutating routes add `requireRole(...)`. The audit log **redacts** sensitive keys (passwords, tokens, keys) before persisting.
- **Uploads:** document routes validate the real file type by **magic bytes** (not the client's claim) and cap the body at 12 MB; downloads set a sanitized `Content-Disposition`. All SQL is parameterized; all rendered values are HTML-escaped.
- **Hardening:** strict Content-Security-Policy (no inline scripts, self-only), HSTS, nosniff / frame-deny / referrer / permissions-policy headers, login rate-limiting (20 / 15 min / IP), global API rate limit (1000 / 5 min / IP), same-origin-only CORS by default, 1 MB default body limit, `x-powered-by` disabled, a one-shot onboarding endpoint that locks itself after first use, and an `npm audit`-clean dependency tree.
- **Transport:** front the API with HTTPS (Caddy / Nginx / Traefik). Set `CORS_ORIGINS` to your exact frontend origin if it differs.

---

## 🗂 Project structure

```
├── server.js                  Node/Docker entry (auto-migrates on startup)
├── public/                    Built-in web UI (vanilla JS SPA, no build step)
│   ├── index.html             App shell + onboarding/login
│   ├── css/app.css
│   └── js/
│       ├── api.js  i18n.js  ui.js  money.js  barcode.js  mobile-shell.js
│       └── views/             One module per screen (dashboard, assets, network,
│                              providers, audit, onboarding, stockcount, …)
├── src/
│   ├── app.js                 Express app, body limits, audit middleware, route mounting
│   ├── config/                Env parsing
│   ├── middleware/            Bearer auth + role gate, error handling
│   ├── routes/                Thin controllers (assets, providers, contracts, audit, …)
│   ├── utils/                 PDF, uploadGuard, contentDisposition, permissions, defaults
│   ├── services/              Backend-agnostic service facade
│   └── providers/postgres/    JWT auth + PostgreSQL
│       ├── schema.sql         Idempotent base schema
│       ├── migrations/        Tracked versioned migrations (schema_migrations)
│       ├── migrate.js         Applies schema.sql + pending migrations
│       └── *Service.js        assets, employees, providers, audit, offboard, onboarding, …
├── scripts/                   setup · seed-demo · seed-infra · seed-providers · backup · restore
├── docker-compose.yml         Self-hosted stack (API + Postgres)
├── Dockerfile · docker-entrypoint.sh
└── .env.example               Fully documented configuration template
```

---

## 🧑‍💻 Development

```bash
npm install
npm run setup      # or hand-write .env
npm run dev        # auto-restarting local server
npm run lint       # syntax check (server + all src/scripts)
npm run migrate    # apply schema + pending migrations manually (optional)

# Demo data
npm run seed:demo                                  # ~500 employees
SEED_EMPLOYEES=2000 npm run seed:demo -- --reset   # larger, historical dataset
npm run seed:infra                                 # network/server gear + topology
npm run seed:providers                             # vendors + contracts
```

---

## 📜 License

Released under the [MIT](LICENSE) license.

<div align="center">
<br />
<sub>Built with ❤️ by <a href="https://github.com/enesyakisik">Enes Yakışık</a> · If ITACM helps you, consider giving it a ⭐</sub>
</div>
