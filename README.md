<div align="center">

# 🖥️ ITACM — IT Asset Control Pro

### Self-hosted IT asset management, batteries included.

Hardware & network inventory · employee handovers with printable PDF receipts · software licenses · mobile lines · vendors & contracts · repairs · physical stock counts · an ITIL-aligned service desk (incidents, requests, approvals, SLAs) · a natural-language AI assistant · a full audit trail — all behind a built-in, mobile-ready web UI running entirely on your own infrastructure.

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

📘 **New here?** Follow the simple, copy-paste [**visual install guide**](https://enesyaks.github.io/ITACM/install-guide.html) — available in 12 languages.

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
- **The whole company, one dump.** Assets, employees, receipts, contracts and audit history live in PostgreSQL. Uploaded document files live on the filesystem (`DATA_DIR/documents`); use `npm run migrate:export` for a full move.
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
| **Hardware inventory** | **Product Catalog — per-model EOL lifecycle** |
| ![Hardware inventory](docs/screenshots/hardware.png) | ![Product Catalog](docs/screenshots/catalog.png) |

<br />

<img src="docs/screenshots/mobile-dashboard.png" width="30%" alt="Mobile dashboard" />
&nbsp;&nbsp;
<img src="docs/screenshots/mobile-lines-phone.png" width="30%" alt="Mobile lines on phone" />

<sub>Responsive layout with bottom navigation and a center QR-scan button.</sub>

</div>

> More screens (handover basket, network map, login) live in [`docs/screenshots/`](docs/screenshots).

---

## ✨ Feature highlights

<table>
<tr>
<td width="50%" valign="top">

### 🎫 Service Desk (ITIL-aligned)
A full ITSM suite living next to your inventory. **Incidents & requests** with **Impact × Urgency** priority, **SLA** response/resolution timers that run on a 24/7 clock (pause on *pending* & breach flags), a **Jira-style workflow editor** (custom status transitions + *auto-close resolved* automation), **automation rules** that triage a ticket the moment it opens — *if the subject mentions "toner" and it arrived by email, set the category, drop the priority and assign the print team* — with a dry-run tester and per-rule match counters, canned replies and **CSAT** on closure. **Request templates** power a self-service **Portal** — the same login employees use for their assets — with **multi-step approval chains** (manager → IT team → final), delegation, reminders and escalation. An agent can also send a single ticket to a **named approver** when the org chart is not the right answer — a stand-in while a manager is away, a budget owner outside the reporting line — and nobody can route a ticket to themselves. **Three-level visibility** on comments & attachments — *public*, *approver-only*, *IT-only* — keeps price research and PO internals off the requester's view while approvers see what they need. Plus **Problem** and **Change** management, a **Knowledge Base** with portal deflection, a **"similar past tickets"** panel that surfaces how earlier tickets were solved, and **email-to-ticket (IMAP)** with **DMARC-verified** sender attribution and `[REQ-1234]` cross-linking.

### 🖥 Built-in, mobile-ready web UI
Served by the backend itself — no build step, strict same-origin CSP. 20+ modules, global search (Cmd/Ctrl+K), QR codes, dark-mode aware, **per-user customizable table columns** (show/hide + drag-to-reorder, remembered per browser), and a responsive shell with mobile bottom-nav + camera scanner. Just open `http://localhost:8000`.

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

### 🌳 Organization chart
Departments (with a **manager**), teams (with a **lead**) and their members drawn as an interactive **topology graph** — the same node-and-edge style as the network view. Assign or change a manager/lead in one click, add teams, and move people between them. Departments are a **single source of truth**: add one in the Product Catalog and it shows up here instantly, ready for a manager. Great for helpdesk escalation — one glance shows who to contact.

### 📄 Bulk zimmet PDF import
Your old signed handover forms, filed automatically. Drop in one PDF or twenty — several forms per file is fine — and the server **splits them into individual documents**, reads the assignee's name, matches it to an employee and attaches each form to that profile. Works in **all 12 UI languages**: form titles and "received by" labels are recognised per language, and names match across Latin, Cyrillic, Arabic and CJK scripts (accent-tolerant too, so a scan reading `Ayse Yilmaz` still finds `Ayşe Yılmaz`). Nothing is written until you review: every form shows **auto-matched / uncertain / no match**, and you fix the odd one with a searchable picker. **Scanned** forms — pictures, with no text to read — are handled by opt-in **OCR** (Turkish + English, on-device, nothing leaves the machine); toggle it in **Settings → Integrations**. Discarded or abandoned batches clean themselves up, and the import is confined to the same department scope as the per-employee upload, so it can never file a document you couldn't file by hand.
</td>
<td width="50%" valign="top">

### 🤖 AI assistant (natural-language queries)
Ask about your inventory in plain language and get grounded answers — **provider-agnostic**: a local **Ollama** model or a cloud API (OpenAI, DeepSeek, Anthropic, Groq, Mistral, Together, OpenRouter, or a custom endpoint). Streaming replies, result tables, CSV export, auto charts and a collapsible "show SQL". Analytical questions run a **guarded read-only** query against a curated view schema — never the base tables — under a low-privilege role, honouring each user's RBAC (a user can't surface data the UI denies them), with SSRF-safe outbound and a per-user rate limit. **Off by default** — enable under **Integrations → AI**.

### 🔐 Role-based access control + permission matrix
Six built-in roles — `Owner`, `Admin`, `Helpdesk`, `Viewer`, plus **`HR`** (files onboarding/offboarding requests, sees only its own zimmet) and **`Portal`** (self-service employee login, sees only its own assets) — enforced on **every** endpoint and re-checked on each request so changes apply instantly. Need finer control than a role? Build a **custom permission group** in the IAM matrix: grant any `resource:action` (e.g. `asset:sell`, `license:assign`) and scope it by department / location / category / cost limit. Owners can disable or delete accounts — every disable/enable/delete/role change is recorded. Sign-in is local email/password with **TOTP MFA** — optional for every role and **mandatory for `Owner` accounts**: an Owner must enrol MFA before using the app, cannot disable it, and no one can be promoted to Owner until they have it enabled. Plus password change and server-side logout (JWT revoke). **Single sign-on (OpenID Connect)** is available too — invite-only, off by default (see [Single sign-on](#single-sign-on-openid-connect)) — as is **Active Directory / LDAP**: sign in with a directory password and keep the employee list, org structure and IT accounts in step with the directory (see [Directory sync](#directory-active-directory--ldap)).

### 🧾 System-wide audit log
A unified, filterable timeline of **all** instance activity — assets, users, documents, handovers, logins, settings and more — merging the append-only audit table with legacy domain history. Search by source, actor and date; secrets are redacted before storage.

### ⏳ Product lifecycle (EOL) & depreciation
EOL windows resolve in three tiers — **per-asset override → per-catalog-model → per-category default**. Set a category default in Settings, give a specific catalog model its own lifecycle (e.g. **Apple MacBooks at 5 years** while other laptops keep 4), or override a single device — or untick EOL for a category (accessories) to exclude it entirely. Every asset shows its EOL date and "EOL soon" / overdue flags. The same lifecycle window drives **straight-line depreciation**: enter a purchase cost (and optional salvage value) and each asset shows its current **book value** — exportable via the **Asset Depreciation / Book Value** report.

### 📦 Physical stock counts
Open a count session and scan from **any signed-in device** — start on the PC, keep scanning barcodes/QRs from your phone camera. Closing the session reconciles against live inventory: found / missing / unknown, with CSV export.

### 📥 Excel / CSV migration
Download the template, fill it with your existing zimmet spreadsheet, upload — a dry-run preview shows exactly what will be created, then one transaction auto-creates employees, catalog entries, assets (sequential tags) and one handover per employee with full history.

### 📄 Licenses · 🏷 labels · 💱 currency
Seat pools with atomic claim/release and 30-day expiry alerts. Print scannable **Code 128** labels (size/fields/copies configurable). Pick your **display currency** for costs across the app. The alert digest (expiring licenses, low stock, EOL, onboarding due) can be **auto-sent daily or weekly** over SMTP — **Integrations → SMTP & alert digest** (Auto-send: Off / Daily / Weekly).

### 🌍 Multi-language UI
12 languages (EN, TR, DE, FR, ES, IT, PT, NL, PL, RU, AR, JA). Pick one on the onboarding screen, change it any time in Settings; untranslated strings fall back to English.

</td>
</tr>
</table>

> 🚀 **First-run onboarding** sets your company name, logo and Owner account; branding flows into the UI and every printed receipt.
> 🧪 **Demo dataset** (~100 employees by default) — seed **inside** the API container:
> `docker compose exec api npm run seed:all -- --reset` (demo + infra + providers). Scale with `SEED_EMPLOYEES=200`. Password for demo IT/Portal users: `Demo123!`.

---

## 🧩 Modules

The sidebar maps 1:1 to the feature set, plus a floating **AI assistant** (⌘/Ctrl+J) on top:

| Module | What it does |
|---|---|
| **AI Assistant** | Natural-language queries over your inventory — floating launcher (⌘/Ctrl+J), provider-agnostic, guarded read-only. Off by default (Integrations → AI) |
| **Dashboard** | KPIs, attention-required alerts (licenses, low stock, EOL), asset distribution, recent activity |
| **Hardware** | Full device inventory — QR codes, bulk actions, cost/warranty, lifecycle, global search |
| **Network & Server** | Infra inventory + dependency topology + rack cabinets (site/owner, not personal zimmet) |
| **Product Catalog** | Approved brands/models (with **per-model EOL lifecycle**), categories, locations, departments & spec options |
| **Software & Licenses** | Seat pools, atomic claim/release, expiry alerts, per-license holder export |
| **Mobile Lines** | SIM/phone-number inventory with assignment history |
| **Providers & Contracts** | Vendor directory + commercial agreements with renewal tracking and documents |
| **Consumables** | Stock movements with low-stock alerts |
| **Employees** | Directory, per-person detail (assets/licenses/lines/infra), onboarding & offboarding |
| **Zimmet Import** | Bulk-file historical handover PDFs onto employee profiles — auto split, name matching, review before commit, optional OCR for scans |
| **Organization** | Department → team → member topology chart; assign managers/leads, move people, helpdesk escalation |
| **Handover Ops** | Atomic handover basket + printable/PDF receipts |
| **Maintenance & Repair** | Send to repair / return / scrap, with document attachments |
| **Stock Count** | Physical count sessions with camera scanning and reconciliation |
| **Reports** | 20 preset reports + a builder (data sources × columns × filters), CSV / letterhead print |
| **Audit Log** | Unified, filterable activity timeline (Owner/Admin) |
| **IT Users** | RBAC user management + **custom permission groups** (granular `resource:action` matrix with scoping) — create, role, disable/enable, delete (audited) |
| **Service Desk** | Incidents & requests — Impact×Urgency priority, SLA timers, workflow editor + auto-close, **automation rules** (auto-categorise / prioritise / assign on creation), canned replies, CSAT, three-level note visibility, email-to-ticket (IMAP) |
| **Approvals** | Multi-step request approvals (manager → IT → final) with delegation, reminders and escalation; approvers see an internal worklog the requester never does |
| **Problems** | Problem records with linked incidents and root-cause / workaround tracking |
| **Changes** | Change requests with risk, approval, schedule and rollback plan |
| **Knowledge Base** | Staff-authored articles; employees self-serve the published set (portal deflection) |

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
| **Runtime** | Node.js ≥ 20, Express 5 |
| **Database** | PostgreSQL 16 — idempotent `schema.sql` + tracked versioned migrations, applied on startup |
| **Auth** | JWT (HS256, pinned alg) + bcrypt (cost 12), role-based middleware re-checked per request |
| **Frontend** | Vanilla JS SPA served by the backend — **no build step**, split into per-view modules |
| **PDF / labels** | PDFKit + QR codes, custom handover templates, Code 128 barcodes |
| **PDF reading** | pdf.js (text + page images) and pdf-lib (splitting) for the zimmet import; Tesseract.js for optional on-device OCR of scans |
| **Scanning** | Vendored ZXing browser build (camera QR/barcode) |
| **Packaging** | Docker + Docker Compose |

---

## 🚀 Quick start — Docker Compose

Everything is automatic: the database container is created, the schema + migrations are applied, and the first Admin (Owner) account is seeded.

```bash
git clone https://github.com/enesyaks/ITACM.git
cd itacm

npm install
npm run setup          # generates .env with strong secrets (or copy .env.example)

docker compose up -d
docker compose logs api   # first-run Owner credentials are printed here
```

Then open **http://localhost:8000** — the first visit asks **New workspace** (product tour + company/Owner setup) or **Migrate from another server**.

> [!TIP]
> If you leave `ADMIN_PASSWORD` empty, a strong random password is generated and printed **once** in the API logs. Change it after first login.

Prefer to configure by hand? Copy `.env.example` to `.env`, set at least `JWT_SECRET` (`openssl rand -hex 32`), then `docker compose up -d`.

---

## 🌍 Deploying to a server

The compose file works unchanged on any host with Docker. Put a reverse proxy (Caddy / Nginx / Traefik) with TLS in front of port 8000 and set `CORS_ORIGINS` to your frontend's origin if it differs.

### One-command HTTPS (built-in Caddy profile)

The simplest path — no certbot, nginx, or manual certificates. The compose file ships an optional **Caddy** service (behind the `tls` profile) that fetches and renews a Let's Encrypt certificate automatically.

1. Point a DNS **A/AAAA record** for your domain at the host.
2. In `.env` set **`APP_DOMAIN=itacm.company.com`**, **`TRUST_PROXY=1`**, and **`APP_URL=https://itacm.company.com`** (or set the App URL in-app under **Integrations → Notifications**, so email links use the real domain).
3. Start with the profile:

```bash
docker compose --profile tls up -d
```

Caddy listens on 80/443, redirects HTTP→HTTPS, proxies to the app, and renews the certificate on its own. With the proxy in front you don't need to expose the app port publicly — set `API_PORT=127.0.0.1:8000` in `.env` to keep it host-local. Want certificate-expiry emails? Add `{ email you@example.com }` to the top of the `Caddyfile`.

> **Behind Cloudflare?** Don't use the `tls` profile above — Caddy can't complete a Let's Encrypt challenge through Cloudflare's orange-cloud proxy. Use the `cloudflare` profile instead (next section).

### Behind Cloudflare — end-to-end TLS (Origin Certificate)

When your domain is **proxied by Cloudflare** (orange cloud), the turnkey path is a **Cloudflare Origin Certificate** — a cert Cloudflare pre-issues for your origin, so there's no Let's Encrypt challenge to break. You get full end-to-end HTTPS with SSL/TLS mode **Full (strict)**.

1. **DNS** — in Cloudflare, add an **A record**: your hostname → the server's public IP, **Proxied** (orange cloud). *(once)*
2. **Origin Certificate** — Cloudflare → **SSL/TLS → Origin Server → Create Certificate** (keep defaults, list your hostname). Save the two blocks into `./certs`: *(once)*
   - Origin Certificate → `certs/origin.pem`
   - Private Key → `certs/origin.key`  (then `chmod 600 certs/origin.key`)
3. In `.env`: set `APP_DOMAIN`, `TRUST_PROXY=1`, `APP_URL=https://your-domain`, and keep the app host-local: `API_PORT=127.0.0.1:8000`.
4. Start with the profile:

```bash
docker compose --profile cloudflare up -d
```

5. Cloudflare → **SSL/TLS → Overview → Full (strict)**, then open the origin firewall for Cloudflare: `sudo ufw allow 443/tcp` (port 80 on the origin is no longer needed). Keep the record proxied. *(once)*

Caddy serves 443 with the Cloudflare-trusted certificate and proxies to the app; the key/cert are git-ignored (see `certs/README.md`). The `tls` and `cloudflare` profiles are mutually exclusive — pick the one that matches your setup.

### Behind a reverse proxy / Cloudflare

Rate-limiting and brute-force protection key on the client IP, so when a proxy sits in front you **must** tell the app to trust it — otherwise every visitor is bucketed under the proxy's IP and legitimate users get throttled as one:

- Set **`TRUST_PROXY=1`** in `.env`. The app then resolves the real client from `CF-Connecting-IP` (behind Cloudflare) or `X-Forwarded-For`. With no trusted proxy declared it uses the raw TCP peer, so headers can't be forged to dodge limits.
- **Lock the origin to the proxy.** With `TRUST_PROXY=1` the app trusts those IP headers, so a client reaching the origin directly could spoof them. Use a **Cloudflare Tunnel** (origin has no public port), or firewall the origin to [Cloudflare's IP ranges](https://www.cloudflare.com/ips/) + enable Authenticated Origin Pulls.
- In Cloudflare, **turn OFF Rocket Loader, Auto Minify (JS/HTML) and Email Obfuscation** — they rewrite/inject scripts and the strict `script-src 'self'` CSP will block them. Use SSL mode **Full (strict)** and a cache rule that **bypasses `/api/*`**.

### Shared-IP offices (NAT)

Limits key on **who**, not only **where**: a coarse per-IP guard, a per-user fair-use limit once you're logged in, and a per-**account** login lockout (persisted, so one colleague's mistyped password never locks the rest of the office out). So many people sharing one office IP are normally fine.

If a busy office still hits the coarse per-IP guard, exempt its **public egress IP** — find it from an office machine with `curl ifconfig.me`:

```bash
# .env  (single IP; comma-separate or use a CIDR for a range)
RATE_LIMIT_TRUSTED_CIDRS=203.0.113.7/32
```

Then `docker compose up -d`. The exemption relaxes only the coarse per-IP guard — **authentication and the per-account login lockout still apply**. Behind a proxy/ALB you must also set `TRUST_PROXY=1`, or the app sees the proxy's IP instead of the office's and the match won't fire.

### Single sign-on (OpenID Connect)

Let staff sign in with your identity provider (Google Workspace, Microsoft Entra, Okta, Auth0, Keycloak…). It's **invite-only and secure by design**:

- SSO **never creates accounts** — it signs in a user who already exists in ITACM, matched by their **verified** email (`email_verified` required), then by the stable `(issuer, subject)` pair afterwards. Unknown or unverified emails are refused, so nobody self-provisions.
- Authorization Code flow with **PKCE**; all token exchange is server-side and the ID token is validated against the provider's JWKS (`openid-client`). The finished session reaches the browser via a **single-use** handoff ticket, never a long-lived token in the URL.
- **Local password login stays available** as a break-glass path — if the IdP is down, an Owner can still get in.

**Configure it from the UI** (recommended): sign in as Owner/Admin → **Integrations → Single sign-on (SSO)**. The panel shows the exact **redirect URI** to register at your provider, takes the issuer / client ID / client secret (the secret is **encrypted at rest** and never shown again), and has a **Test connection** button that verifies the provider before you enable it. Options:

- **Allowed email domains** — restrict sign-in to e.g. `company.com`.
- **Require SSO for staff** (optional, off by default) — when on, only an Owner may still use a password; everyone else must use SSO.
- Custom **login-button label**.

Then register the redirect URI **verbatim** at the provider — `https://<your-host>/api/auth/sso/callback` — enable, and a "Sign in with SSO" button appears on the login screen. Behind a proxy/ALB, set `TRUST_PROXY=1`. Admins can see which accounts are SSO-linked in **IT Users** and **unlink** one there.

> Prefer env vars? The same settings exist as `SSO_ENABLED`, `SSO_ISSUER`, `SSO_CLIENT_ID`, `SSO_CLIENT_SECRET`, `SSO_REDIRECT_URI`, `SSO_ALLOWED_DOMAINS`, `SSO_BUTTON_LABEL`, `SSO_REQUIRE` (see below). UI config takes precedence once an issuer is saved there; otherwise the env values are used.

### Directory (Active Directory / LDAP)

Point ITACM at your AD (or any LDAP server) for two independent things — each switchable on its own, both off by default. Configure both under **Integrations → Directory**; the service-account password is **encrypted at rest** and never returned to the browser.

**Sign-in.** Staff authenticate with their directory password. Like SSO it is **invite-only**: the directory verifies the password of an account that already exists in ITACM, and a successful bind never creates one at the login screen. A directory outage looks like a wrong password, so keep one Owner with a local password as the break-glass path.

**Sync.** A run reads the directory and keeps people in step:

- **Employees** — creates and updates name, email, department and job title, and resolves `manager` into ITACM's own manager link, so the **approval chain routes itself** off the org structure your directory already knows.
- **Portal logins** — optionally gives each synced employee a self-service login so they can see their own assets straight away. They sign in with their **directory password**: no temporary password is issued and nobody is asked to change one, which is what would otherwise strand a directory user on the "set a new password" screen. Granting web access by hand from the employee page behaves the same way once the person is directory-backed.
- **IT accounts** — an optional **group → role** mapping provisions `Admin` / `Helpdesk` / `Viewer` / `HR` operator accounts from directory group membership. **`Owner` can never be granted this way**, and a sync never touches an existing Owner. Membership is read from `memberOf` when the directory supplies it (AD always does) and from the group objects themselves otherwise (OpenLDAP without the memberof overlay).
- **Passwords stay in the directory** — a directory-backed account holds no local password, so the account screen shows where to change it instead of a form that cannot work, and the API refuses the change outright. That is not cosmetic: a local password on a directory account would be a second way in that disabling the person in AD could not revoke.
- **Audit trail** — a run records the accounts it creates, re-roles, or disables by name, not just how many. Reviewing who gained access after a nightly sync does not mean diffing the user list by hand.
- **Leavers** — optionally deactivates employees who disappear from the directory. This is guarded: if more than **30%** of synced employees are missing in one run, deactivation is skipped and reported, because that is a filter mistake rather than a third of the company resigning.

People are keyed on the directory's **immutable object id** (`objectGUID` on AD, `entryUUID` on OpenLDAP), not the DN — someone who is renamed or moved to another OU keeps their record instead of coming back as a duplicate. Run it **manually**, **preview it first** (a dry run that writes nothing and shows exactly what would change), or schedule it **hourly / daily**. Attribute names are all configurable; the defaults are Active Directory's.

For managed platforms (Railway, Render, Fly.io, Cloud Run…), deploy the `Dockerfile`, attach a Postgres add-on, and set the same environment variables (`DATABASE_URL`, `PGSSL=true`, `JWT_SECRET`, `ADMIN_*`, and `TRUST_PROXY=1` since these run behind a load balancer). The schema and migrations are applied automatically on startup.

---

## ⬆️ Updating

Releases are tagged (`v1.1.0`, …) and listed under [Releases](https://github.com/enesyaks/ITACM/releases); see [`CHANGELOG.md`](CHANGELOG.md) for what changed. Schema migrations run automatically on startup.

**The easy way — one command:**

```bash
npm run update            # or: npm run update -- --dry-run  (preview only)
```

This backs up the database, pulls the latest code, and rebuilds with the compose profile your `.env` implies (plain / `tls` / `cloudflare`) — so you never have to remember which `--profile` or `--build` flag to pass — then prints the version now running. Your `.env` and `certs/` are left untouched.

**Or do it manually:**

```bash
git pull                       # or: docker compose pull  (if you use a published image)
docker compose up -d --build
```

> **Using an HTTPS profile manually?** If you started with `--profile tls` or `--profile cloudflare`, include the **same flag** when you update — otherwise the reverse-proxy (Caddy) container isn't recreated and HTTPS goes down. (`npm run update` handles this for you.)
> ```bash
> docker compose --profile cloudflare up -d --build
> ```

Take a backup first (`npm run backup`) — it's a one-liner and makes rollback trivial. After the new version boots, the running version is exposed at `GET /api/health` (`version` field) and shown in **Help → About**. The first time the **Owner** signs in on a newer version, a popup announces the update so at least the people running the instance know it changed.

**Optional — get told when a new release is out.** The Owner can turn this on under **Integrations → Software updates** (or set `UPDATE_CHECK=1` as the default). The server then asks GitHub once a day whether a newer release exists; if so, the Owner sees an "update available" popup (with a link to the release). It's **off by default** so offline / air-gapped installs never reach out. Configure the repo with `UPDATE_CHECK_REPO` and, for a private repo or higher rate limits, `UPDATE_CHECK_TOKEN` (`GITHUB_TOKEN` also works).

---

## 💾 Backup & recovery

PostgreSQL holds assets, employees, receipts, contracts, settings (SMTP, company, zimmet templates) and audit history. **Uploaded document files** live under the `app-data` volume (`DATA_DIR/documents`), not only in the database.

```bash
npm run backup                 # → backups/itacm-YYYYMMDD-HHMMSS.sql.gz  (DB only)
npm run restore backups/itacm-20260707-120000.sql.gz   # replaces current DB (asks to confirm)

# Full system move (DB + documents) — also available in the UI:
npm run migrate:export         # → migrations/itacm-migrate-… (+ .zip if available)
npm run migrate:import path/to/itacm-migrate-… [--yes]
```

First open of a fresh install offers **New workspace** or **Migrate from another server**. Copy `JWT_SECRET` from the source `.env` to the target (required for SMTP password decrypt). Owner can also export from **Integrations → System migration**.

Copy the `backups/` / `migrations/` folders somewhere safe, or schedule DB backups with cron, e.g. daily at 02:00:

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

### Recovering a locked-out Owner (forgot password / lost MFA)

There is **no network "forgot password" endpoint** — by design, so no one can reset an account remotely. Recovery runs on the server (shell access to the box = proof you are the legitimate operator):

```bash
# reset the password (forces a change on next login, revokes all sessions)
docker compose exec api npm run reset-password -- owner@example.com

# also clear MFA — for an Owner who lost their authenticator (they re-enrol on next login)
docker compose exec api npm run reset-password -- owner@example.com --clear-mfa

# set a specific password instead of a generated one
docker compose exec api npm run reset-password -- owner@example.com --password 'NewStrongPass123'
```

> A server-side attacker who already has shell/DB access can of course do this too — but they could also read `JWT_SECRET` from `.env` and forge any session. Server compromise is total for **any** self-hosted app; protect the host (key-only SSH, firewall, `chmod 600 .env`, off-site encrypted backups, ideally a Cloudflare Tunnel so the origin has no public ports).

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
| `TRUST_PROXY` | – | `1` (or a hop count) when behind a reverse proxy / Cloudflare, so rate limits key on the real client IP. Off by default. |
| `RATE_LIMIT_TRUSTED_CIDRS` | – | Comma-separated IPs/CIDRs exempt from the coarse per-IP API guard — e.g. your office egress IP behind NAT (`203.0.113.7/32`). Authentication and the per-account login lockout are never exempted. Blank by default. |
| `API_RATE_LIMIT` / `API_RATE_WINDOW_SEC` | – | Coarse per-IP API guard — requests per window (default `1000` / `300`s). |
| `USER_RATE_LIMIT` / `USER_RATE_WINDOW_SEC` | – | Per-user fair-use limit for logged-in sessions (default `600` / `300`s). |
| `LOGIN_FAIL_LIMIT` / `LOGIN_LOCK_MIN` | – | Failed logins before an account is locked, and how long it stays locked (default `10` / `15` min). Keyed per-account and persisted in the DB. |
| `BACKUP_ENABLED` | – | `1` turns on automatic nightly `pg_dump` backups (off by default). |
| `BACKUP_HOUR` / `BACKUP_KEEP` / `BACKUP_DIR` | – | Backup hour `0–23` (default `3`), how many to retain (default `7`), and where they land (default `DATA_DIR/backups`). Each archive is verified as a complete, restorable dump; keep off-box copies too. |
| `SSO_ENABLED` | – | `1` turns on invite-only OpenID Connect sign-in (off by default). Also configurable in the UI (Integrations → SSO), which takes precedence once an issuer is saved there. |
| `SSO_ISSUER` / `SSO_CLIENT_ID` / `SSO_CLIENT_SECRET` / `SSO_REDIRECT_URI` | – | OIDC provider settings. The redirect URI (`https://<host>/api/auth/sso/callback`) must be registered verbatim at the IdP. Via env the secret stays in `.env`; via the UI it is encrypted in the DB. |
| `SSO_ALLOWED_DOMAINS` / `SSO_BUTTON_LABEL` | – | Optional: restrict sign-in to these email domains, and the login-screen button text. |
| `SSO_REQUIRE` | – | Optional. `1` requires staff to use SSO — only an Owner may still sign in with a password (break-glass). Off by default. |
| `APP_URL` | – | Public URL used in outbound email links. Prefer setting it in-app (Integrations → Notifications → App URL); this env var is the fallback. Defaults to `http://localhost:8000`. |
| `APP_DOMAIN` | – | Domain for the HTTPS compose profiles (`--profile tls` / `--profile cloudflare`). |
| `AI_ENABLED` / `AI_PROVIDER` / `AI_MODEL` / `AI_BASE_URL` / `AI_API_KEY` | – | AI assistant defaults (optional). Normally configured in **Integrations → AI**, not via env. Assistant is off unless enabled. |
| `ZIMMET_OCR` | – | Default for reading **scanned** zimmet PDFs with OCR. Only a default — the **Settings → Integrations** toggle is stored in the database and overrides it, so turning OCR on or off needs no restart. Off unless set. |
| `ZIMMET_OCR_LANGS` / `ZIMMET_OCR_LANG_PATH` / `ZIMMET_OCR_MAX_PAGES` | – | OCR languages (default `tur+eng`), the directory holding `<lang>.traineddata` (default `DATA_DIR/tessdata` — with the files there the server never reaches the internet; grab them from [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast)), and the per-batch page budget (default `40`). |

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
| POST | `/api/import/zimmet/analyze` · `/commit` | `handover_document:upload` + `employee:view_handover` | **Bulk zimmet PDF import** — split + name-match into a staged batch, then attach to profiles |
| GET | `/api/documents/:id/download` | Owner, Admin, Helpdesk | Stream a stored handover document (auth required) |
| GET | `/api/audit` · `/:bucket/:id` | Owner, Admin | Unified audit timeline + event detail |
| POST | `/api/ai/query` | staff | **AI assistant** — SSE streaming, agentic tool loop, guarded read-only queries (per-user rate-limited) |
| GET | `/api/ai/status` | staff | Assistant availability (provider/model) |
| GET/PUT/DELETE | `/api/ai/config` | integration:read / manage | Read / save / clear AI settings (API key encrypted, masked) |
| GET/POST/PUT | `/api/tickets` · `/:id` · `/:id/comments` · `/documents` | `ticket:*` | Incidents/requests — list, detail, create, update, comment, attachments (3-level visibility), CSAT |
| GET/PUT | `/api/tickets/workflow` · `/sla` · `/categories/manage` · `/report` | ticket:read / configure / report | Status transitions + auto-close, SLA policy, managed categories, desk reports |
| GET/PUT/POST | `/api/tickets/rules` · `/rules/test` | ticket:read / configure | **Automation rules** — ordered condition→action set applied at ticket creation; `test` dry-runs a sample (or the unsaved draft) without touching a ticket |
| GET/POST | `/api/approvals` · `/:id/decide` | `approval:*` | Approval requests + approve/reject (delegation, escalation) |
| GET/POST/PUT | `/api/problems` · `/api/changes` | `problem:*` / `change:*` | Problem & change management (linked incidents, risk, schedule) |
| GET/POST | `/api/kb` · `/:id` | `kb:*` | Knowledge-base articles + attachments |
| GET/PUT | `/api/integrations/inbound-mail` · `/test` · `/poll` | integration:read / manage | Email-to-ticket (IMAP) — config (password encrypted, masked), test connection, manual poll |
| GET/PUT/POST | `/api/integrations/ldap` · `/test` · `/preview` · `/sync` · `/runs` | integration:read / manage | **Directory (AD/LDAP)** — config (bind password encrypted, masked), bind test, dry-run preview, run a sync, run history |
| GET/POST | `/api/me/tickets` · `/approvals/:id/context` · `/kb` | Portal (self-service) | Own tickets + replies, approver worklog for pending approvals, published KB — scoped to the caller |

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
- **Auth:** passwords are bcrypt-hashed (cost 12); JWTs are signed HS256 with the algorithm **pinned** on verify; login uses a single error message and a constant-time compare (dummy hash for unknown emails) so it can't be used to enumerate accounts; every request re-checks the user row so role changes / disables / deletes apply instantly; **`Owner` accounts must have TOTP MFA enabled** — until they do, the middleware blocks every route except MFA enrolment, token verification and logout.
- **Access control:** every API router mounts `authenticate`, and mutating routes add `requireRole(...)`. The audit log **redacts** sensitive keys (passwords, tokens, keys) before persisting.
- **Service-desk boundaries:** Portal users are path-confined to `/api/me/*` and every read is scoped to their own employee record; ticket comments & attachments carry three visibility levels (**public / approver-only / IT-only**) enforced in the SQL `WHERE` clause of every read path, so internal notes never reach a requester and IT-only notes never reach an approver; **email-to-ticket** attributes a requester (and cross-links `[REQ-N]`) only on a provider-verified **DMARC pass**, so a forged `From` can't open a ticket as someone else.
- **Uploads:** document routes validate the real file type by **magic bytes** (not the client's claim) and cap each file at 8 MB; downloads set a sanitized `Content-Disposition`. All SQL is parameterized; all rendered values are HTML-escaped.
- **Abuse protection keys on identity, not just IP:** a per-**account** login lockout (persisted, `LOGIN_FAIL_LIMIT` / `LOGIN_LOCK_MIN`, audited on trip) so a shared office IP never locks colleagues out; a per-**user** fair-use limit for logged-in sessions; and a coarse per-IP API guard as a DoS backstop, with trusted networks exemptable (`RATE_LIMIT_TRUSTED_CIDRS`). All thresholds are env-tunable.
- **Hardening:** strict Content-Security-Policy (no inline scripts, self-only), HSTS, nosniff / frame-deny / referrer / permissions-policy headers, same-origin-only CORS by default, 1 MB default body limit, `x-powered-by` disabled, a one-shot onboarding endpoint that locks itself after first use, and an `npm audit`-clean dependency tree.
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
│   ├── utils/                 PDF build/read/split/OCR, uploadGuard, contentDisposition, permissions
│   ├── services/              Backend-agnostic service facade
│   └── providers/postgres/    JWT auth + PostgreSQL
│       ├── schema.sql         Idempotent base schema
│       ├── migrations/        Tracked versioned migrations (schema_migrations)
│       ├── migrate.js         Applies schema.sql + pending migrations
│       └── *Service.js        assets, employees, providers, audit, offboard, onboarding, …
├── scripts/                   setup · seed-all · seed-demo · seed-infra · seed-providers · backup · restore
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

npm test           # unit tests — pure, no database required
npm run test:db    # integration tests — starts a throwaway Postgres in Docker,
                   # provisions a scratch database, drops it after. Your own
                   # stack and its data are never touched.

# Demo data (run inside the API container — host `npm run seed:*` needs DB port published)
docker compose exec api npm run seed:all -- --reset              # ~100 employees + infra + providers
docker compose exec -e SEED_EMPLOYEES=100 api npm run seed:demo -- --reset
docker compose exec api npm run seed:infra                       # network/server gear + topology
docker compose exec api npm run seed:providers                   # vendors + contracts
# Demo logins: demo.admin|helpdesk|viewer|user01@example.com / Demo123!
```

---

## 📜 License

Released under the [MIT](LICENSE) license.

<div align="center">
<br />
<sub>Built with ❤️ by <a href="https://github.com/enesyakisik">Enes Yakışık</a> · If ITACM helps you, consider giving it a ⭐</sub>
</div>
