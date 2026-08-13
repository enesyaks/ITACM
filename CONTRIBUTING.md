# Contributing to ITACM

Thanks for taking the time. This file covers the few things about this codebase
that are not obvious from reading it.

**Security bugs do not belong here** — see [SECURITY.md](SECURITY.md) and report
them privately.

## Getting it running

```bash
cp .env.example .env          # set JWT_SECRET at minimum
docker compose up -d          # database, schema, first Owner, web UI
```

The app is at `http://localhost:8000`. The first-run Owner password is printed
in the API logs (`docker compose logs api`) when `ADMIN_PASSWORD` is unset.

Demo data — run it **inside** the container, since the database port is not
published to the host:

```bash
docker compose exec api npm run seed:all -- --reset
```

## Before you open a pull request

```bash
npm run lint      # syntax check across server.js, src/ and scripts/
npm test          # unit tests — no database needed
npm run test:db   # integration tests — starts a throwaway Postgres in Docker
```

All of them must pass. `npm test` is pure and runs anywhere; `npm run test:db`
spins up its own disposable database and never touches your dev data.

## How this codebase is shaped

**The frontend has no build step, on purpose.** `public/` is vanilla JS served
directly by the backend — one file per screen under `public/js/views/`. Please
do not introduce a bundler, a framework or TypeScript into it. "Clone it and
`docker compose up`" is a feature, and a build pipeline is what usually takes it
away.

**Cache-busting is manual.** Every `<script>` and `<link>` in
`public/index.html` carries a `?v=` query. If you change a JS or CSS file, bump
its version there — otherwise browsers keep serving the old file after a deploy.

**Schema changes go in a migration, never only in `schema.sql`.** Migrations in
`src/providers/postgres/migrations/` are tracked by filename in
`schema_migrations` and applied once, on startup. Two consequences:

- Never edit a migration that has shipped. It will not re-run on any database
  that already applied it, so the change is invisible there. Add a new one.
  The one exception is a migration that **fails part-way on a fresh database** —
  a later migration cannot help, because provisioning never reaches it. Fix the
  failing file in place, keep the end state identical for databases that already
  applied it, and say so in the commit.
- Write them idempotently (`IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`) so the
  same file is safe against a database that partly has the change already.

`schema.sql` runs **first** and is for a fresh database. It must never reference
a column that only a later migration adds — `tests/schema-consistency.test.js`
fails the build if it does.

**Permissions are checked on the server, every request.** A UI gate is a
convenience, not a control. If you add an endpoint, gate it with
`requirePermission` / `requireAllPermissions` and give the nav entry the *same*
permissions — a menu item the server then refuses is a bug.

**User text is untrusted.** Escape with `esc()` before putting anything into
`innerHTML`. Extracted PDF text, filenames and imported spreadsheet cells all
count.

**Every user-facing string goes through i18n.** `public/js/i18n.js` carries all
twelve languages in one call per key: `L(en, tr, de, fr, es, it, pt, nl, pl, ru,
ar, ja)`. Fill in every language — an English string repeated twelve times is
worse than a missing key, because the fallback would have caught the latter.

## Commits and pull requests

Conventional-commit prefixes: `feat(scope):`, `fix(scope):`, `docs(scope):`,
`chore(scope):`. Explain in the body **why** the change is needed and what
breaks without it; the diff already says what changed.

Keep a pull request to one concern. If you found an unrelated bug on the way,
that is a second PR.

## Tests

`tests/` uses the built-in `node:test` runner — no test framework dependency.

- **Unit tests** must not need a database. Most of the existing suite is static
  analysis of the schema, the permission matrix and pure helpers.
- **Integration tests** live in `tests/db/` and get a real Postgres from
  `npm run test:db`. Put anything transactional there: row locks, rollback
  behaviour, migrations against a fresh database.

Test the behaviour that would actually hurt if it broke. A test asserting that
a getter returns what the setter set is noise; a test proving two concurrent
handovers cannot assign the same asset is the reason the suite exists.

## License

Contributions are accepted under the [MIT License](LICENSE).
