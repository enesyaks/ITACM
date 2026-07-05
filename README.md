# ITACM — IT Asset Control Pro

> Self-hostable IT asset management backend: hardware inventory, employee asset
> handovers (with printable receipts), software licenses, consumables and repair
> tracking — with a **switchable storage backend**: run it fully self-hosted on
> **PostgreSQL via Docker Compose**, or on **Firebase (Auth + Firestore)**.

**[🇹🇷 Türkçe dokümantasyon için buraya tıklayın → README.tr.md](README.tr.md)**

---

## Screenshots

| Dashboard | Hardware Inventory |
|---|---|
| ![Dashboard](docs/screenshots/dashboard.png) | ![Hardware Inventory](docs/screenshots/hardware.png) |

| Handover Operations | Printable Handover Form (Zimmet Tutanağı) |
|---|---|
| ![Handover](docs/screenshots/handover.png) | ![Print preview](docs/screenshots/print-preview.png) |

| Employee Detail (assets, software, history) | Reports & Custom Report Builder |
|---|---|
| ![Employee detail](docs/screenshots/employee-detail.png) | ![Reports](docs/screenshots/reports.png) |

---

## Features

- 🖥 **Built-in web UI** — served by the backend itself (no build step): Login, Dashboard, Hardware Inventory (bulk actions, QR codes, global search), Employee Directory with per-employee device history, Handover basket with **printable receipt**, software (license) assignment, Licenses, Consumables, Maintenance and IT User management with login auditing. Open `http://localhost:8000` after starting.
- 🚀 **First-run onboarding** — set company name, logo and the Admin account on first launch; branding is applied across the UI and the printed handover forms (change later via Settings).
- 🧪 **Demo dataset** — `npm run seed:demo` fills a postgres instance with a realistic 500-employee company (773 assets, receipts, audit history, software assignments) for evaluation.
- 🔐 **Role-based access control** — `Admin`, `Helpdesk`, `Viewer` roles enforced on every endpoint
- 💻 **Hardware inventory** — asset tags (unique, QR-encoded), serials, MAC addresses, specs, warranty
- 🤝 **Atomic handover basket** — assign multiple assets to an employee in one all-or-nothing transaction, producing a printable handover receipt (Zimmet Tutanağı)
- 🛠 **Maintenance lifecycle** — send to repair / return / scrap, with the pre-repair assignment state restored automatically
- 📄 **Software licenses** — seat pools with atomic claim/release and 30-day expiry alerts
- 📦 **Consumables** — stock movements with low-stock alerts
- 📊 **Dashboard aggregates** — asset counts by status, alerts, recent handover activity
- 🧾 **Full audit trail** — every assign/return/repair/progress-note is logged with who/when/why; per-user login history
- ⏳ **Product lifecycle management** — set a lifecycle duration (months) per category once in Settings; every asset shows its EOL date, "EOL soon"/overdue flags in inventory, and lifecycle reports
- 📈 **Reports & Custom Report Builder** — six preset reports plus a builder (7 data sources × selectable columns × filters), exported as Excel-friendly CSV or printed with company letterhead
- 🗂 **Product catalog** — centrally managed brand/model lists per category feed the asset form dropdowns; asset tags are system-assigned and sequential
- 🔁 **Two interchangeable backends, one API** — PostgreSQL (self-hosted) or Firebase (managed); the REST contract is identical

## Choose your backend

| | 🐘 PostgreSQL (self-hosted) | 🔥 Firebase (managed) |
|---|---|---|
| **Best for** | On-premises, full data ownership, air-gapped networks | Zero-ops, Google-managed infra |
| **Auth** | Built-in Email/Password + JWT (bcrypt-hashed) | Firebase Authentication (roles in custom claims) |
| **Database** | PostgreSQL 16 (auto-provisioned schema) | Cloud Firestore (+ security rules included) |
| **Setup** | `docker compose up -d` — that's it | Create a Firebase project, add a service account |
| **Runs on** | Docker/VPS, Vercel + managed Postgres | Vercel, Docker/VPS, anywhere Node runs |

Run the interactive wizard to choose and configure:

```bash
npm install
npm run setup
```

The wizard writes a ready-to-run local `.env` (generates strong secrets for
you) and prints the exact next steps for your choice. On hosted platforms such
as Vercel, Railway, Render, Fly.io or Cloud Run, define the same names in the
platform's Environment Variables / Secrets UI; the app reads them from
`process.env` at runtime.

---

## Quick start A — Self-hosted with Docker Compose (recommended)

Everything is automatic: the database container is created, the schema is
applied, permissions are handled, and the first Admin account is seeded.

```bash
git clone https://github.com/<you>/itacm.git
cd itacm
cp .env.example .env
# Edit .env: set at minimum JWT_SECRET (openssl rand -hex 32)
# Optionally set ADMIN_EMAIL / ADMIN_PASSWORD

docker compose up -d
docker compose logs api        # ← first-run Admin credentials are printed here
curl http://localhost:8000/api/health
```

> If you leave `ADMIN_PASSWORD` empty, a strong random password is generated
> and printed **once** in the API logs. Change it after first login.

Login and call the API:

```bash
TOKEN=$(curl -s http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"<from-logs-or-env>"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["token"])')

curl http://localhost:8000/api/dashboard/stats -H "Authorization: Bearer $TOKEN"
```

## Quick start B — Firebase (managed)

### 1. Create the Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project**
2. **Authentication → Sign-in method** → enable **Email/Password**
3. **Firestore Database → Create database** (production mode)

### 2. Get a service account key — and keep it safe 🔒

**Project settings → Service accounts → Generate new private key** downloads a
JSON file. This file is a **full-access credential to your project. Never
commit it, never put it inside the repo folder.** (`.gitignore` blocks
`*serviceAccount*.json` as a safety net, but treat it like a password.)

Provide it to the app one of these ways:

| Method | How | Use for |
|---|---|---|
| **Base64 env var** (recommended) | `base64 -i key.json \| tr -d '\n'` → `FIREBASE_SERVICE_ACCOUNT_BASE64` | Vercel & any PaaS secret store |
| Raw JSON env var | paste JSON into `FIREBASE_SERVICE_ACCOUNT_JSON` | CI secrets |
| File path | `GOOGLE_APPLICATION_CREDENTIALS=/path/outside/repo/key.json` | local development |
| Explicit ADC | `FIREBASE_USE_APPLICATION_DEFAULT_CREDENTIALS=true` | Google Cloud runtimes |

The `npm run setup` wizard does the base64 conversion for you and never copies
the key into the project.

If you use the built-in web UI in Firebase mode, also create a Firebase Web App
and set `FIREBASE_WEB_CONFIG` to the one-line web config JSON. This value is
public Firebase client config, not the Admin service account key.

### 3. Configure, deploy rules, create the first Admin

```bash
npm run setup                # choose option 2 (Firebase)
firebase deploy --only firestore:rules,firestore:indexes
npm start
node scripts/setUserRole.js --create admin@company.com 'S3cret!' 'IT Admin' Admin
```

Roles are stored in **Firebase Auth custom claims**, so they are
cryptographically embedded in every ID token. Changing a role revokes the
user's refresh tokens immediately.

In Firebase mode the **client** signs in with the Firebase Web SDK
(`signInWithEmailAndPassword`) and sends the resulting ID token as
`Authorization: Bearer <ID_TOKEN>`. In PostgreSQL mode the client calls
`POST /api/auth/login` instead. Everything after that is identical.

---

## Deploying

### Vercel

1. Push the repo to GitHub and **Import Project** in Vercel — `vercel.json` is
   already configured (all `/api/*` traffic → one serverless function).
2. In **Project Settings → Environment Variables**, add the required values for
   Production (and Preview if you want branch deploys). Do **not** put secrets
   in `vercel.json`, source code, or the repo.
   - **Firebase mode:** `DATA_BACKEND=firebase`,
     `FIREBASE_SERVICE_ACCOUNT_BASE64=<base64 service account JSON>`,
     `FIREBASE_WEB_CONFIG=<one-line web config JSON>`
   - **Postgres mode:** `DATA_BACKEND=postgres`,
     `DATABASE_URL=<managed Postgres URL>`, `PGSSL=true`,
     `JWT_SECRET=<openssl rand -hex 32>`, `ADMIN_EMAIL`,
     `ADMIN_USERNAME`, `ADMIN_PASSWORD`
3. Deploy. The schema is applied automatically on the first cold start.

Vercel Environment Variables are available to the serverless function through
`process.env`; changes apply to new deployments, so redeploy after editing
them. `DATABASE_URL` is the preferred Postgres connection variable. If a
Marketplace integration injects `POSTGRES_URL`, ITACM will use it as a
fallback, but prefer the provider's pooled connection string for serverless.

### Docker on a VPS / on-premises

The compose file above works unchanged on any server with Docker. Put a
reverse proxy (Caddy/Nginx/Traefik) with TLS in front of port 8000 and set
`CORS_ORIGINS` to your frontend's origin.

### Other platforms (Railway, Render, Fly.io, Cloud Run…)

Deploy the `Dockerfile`, attach a Postgres add-on, and set the same env vars in
the platform's secret/env manager. Nothing else is required — provisioning is
automatic at startup.

---

## Configuration reference

| Variable | Mode | Required | Description |
|---|---|---|---|
| `DATA_BACKEND` | both | ✅ | `postgres` or `firebase` |
| `PORT` | both | – | HTTP port (default `8000`) |
| `CORS_ORIGINS` | both | – | Comma-separated allowed origins |
| `DATABASE_URL` | postgres | ✅ | Preferred Postgres URL: `postgres://user:pass@host:5432/db` |
| `POSTGRES_URL` | postgres | – | Fallback when a platform integration injects this instead of `DATABASE_URL` |
| `PGSSL` | postgres | – | `true` for managed Postgres over TLS |
| `JWT_SECRET` | postgres | ✅ | Min 32 chars — `openssl rand -hex 32` |
| `JWT_EXPIRES_IN` | postgres | – | Token lifetime (default `12h`) |
| `ADMIN_EMAIL` / `ADMIN_USERNAME` / `ADMIN_PASSWORD` | postgres | – | First-run Admin seed (password auto-generated if empty) |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | firebase | ✅* | Base64 service account JSON |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | firebase | ✅* | Raw JSON alternative |
| `GOOGLE_APPLICATION_CREDENTIALS` | firebase | ✅* | File-path alternative (local dev) |
| `FIREBASE_USE_APPLICATION_DEFAULT_CREDENTIALS` | firebase | ✅* | Set `true` to use Google Cloud ADC without a key file |
| `FIREBASE_WEB_CONFIG` | firebase | – | Public Firebase Web App config JSON; required for built-in UI login |

\* exactly one Firebase Admin credential source.

## API reference

All responses are `{ success, data }` or `{ success: false, error, details? }`.
All endpoints (except `login`/`health`) require `Authorization: Bearer <TOKEN>`.

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| POST | `/api/auth/login` | public | Email/password → JWT *(postgres mode)* |
| POST | `/api/auth/verify-token` | any | Validate token, return profile + permissions |
| GET/POST | `/api/auth/users` | Admin | List / create IT users |
| PUT | `/api/auth/users/:uid/role` | Admin | Change a user's role |
| GET | `/api/dashboard/stats` | all | Counts, low-stock & license alerts, recent activity |
| GET | `/api/assets` | all | Inventory list — `?status=&category=&search=` |
| GET | `/api/assets/:id` | all | Asset detail + audit history |
| POST / PUT | `/api/assets`, `/api/assets/:id` | Admin, Helpdesk | Create / update hardware |
| POST | `/api/assets/:id/return` | Admin, Helpdesk | Return an assigned asset to stock |
| POST | `/api/handovers` | Admin, Helpdesk | **Atomic handover basket** (below) |
| GET | `/api/handovers`, `/:id` | all | Receipts (feeds the printable form) |
| GET/POST | `/api/maintenance` | Admin, Helpdesk | Repair logs / send to repair |
| PUT | `/api/maintenance/:id/close` | Admin, Helpdesk | Close repair (`{scrap:true}` to scrap) |
| GET | `/api/employees` | all | Directory + handover employee selector |
| POST / PUT | `/api/employees` | Admin, Helpdesk | Create / update (deactivation blocked while assets held) |
| GET | `/api/licenses`, `/api/consumables` | all | Lists with alert flags |
| POST | `/api/licenses`, `/:id/seats` | Admin, Helpdesk | Create / atomic seat claim-release |
| POST | `/api/consumables`, `/:id/stock` | Admin, Helpdesk | Create / atomic stock movement |

### The atomic handover basket

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

In **one transaction** (Firestore `runTransaction` / Postgres `BEGIN … FOR UPDATE`):
every asset is validated as `In Stock` → the receipt document is created →
each asset flips to `Assigned` bound to the employee → the employee's
`activeAssetCount` is incremented → one audit row is written per asset.
If **any** asset is locked, the API returns `409` with a per-asset conflict
list and **nothing is written**. Row locks / transaction retries make it
impossible for two operators to hand over the same laptop concurrently.

## Security notes

- **Secrets never live in the repo.** `.env` and `*serviceAccount*.json` are
  git-ignored; the setup wizard writes `.env` with `0600` permissions and
  converts Firebase keys to env vars instead of copying files. On Vercel or a
  similar platform, store these values in the platform Environment Variables /
  Secrets UI and let the app read them from `process.env`.
- **Postgres mode:** passwords are bcrypt-hashed (cost 12); JWTs are signed
  HS256 with your ≥32-char secret; login uses a single error message for both
  unknown email and wrong password; every request re-checks the user row so
  role changes/deletions apply instantly.
- **Firebase mode:** roles live in custom claims (tamper-proof); tokens are
  verified with `checkRevoked`; Firestore security rules
  ([firestore.rules](firestore.rules)) give clients read-only access and force
  all writes through this API.
- **Hardening:** baseline security headers (nosniff, frame-deny, referrer/permissions policies), login
  rate-limiting (20 attempts / 15 min / IP), 1MB body limit, `x-powered-by` disabled, one-shot onboarding
  endpoint that locks itself after first use.
- **Transport:** always front the API with HTTPS (Vercel does this for you;
  use Caddy/Nginx on a VPS). Set `CORS_ORIGINS` to your exact frontend origin.

## Project structure

```
├── server.js                  Node/Docker entry (auto-migrates in postgres mode)
├── api/index.js               Vercel serverless entry
├── public/                    Built-in web UI (vanilla JS SPA, no build step)
├── src/
│   ├── app.js                 Express app + route mounting
│   ├── config/                Env parsing & backend selection
│   ├── middleware/            Bearer auth + role gate, error handling
│   ├── routes/                Thin controllers (backend-agnostic)
│   └── providers/
│       ├── firebase/          Firebase Auth + Firestore implementation
│       └── postgres/          JWT auth + PostgreSQL implementation (schema.sql, auto-migrate)
├── scripts/setup.js           Interactive backend chooser (npm run setup)
├── scripts/setUserRole.js     Firebase custom-claims CLI
├── docker-compose.yml         Self-hosted stack (API + Postgres)
├── Dockerfile
├── vercel.json
├── firestore.rules            Firestore security rules (firebase mode)
└── .env.example               Fully documented configuration template
```

## Development

```bash
npm install
npm run setup      # or hand-write .env
npm run dev        # auto-restarting local server
npm run lint       # syntax check
npm run migrate    # apply the Postgres schema manually (optional)
```

## License

[MIT](LICENSE)
