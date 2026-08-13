# Security Policy

ITACM is self-hosted software that holds employee records, signed handover
documents and the credentials that guard them. If you find a way to get at data
or actions an account should not have, please tell us before telling anyone
else.

## Reporting a vulnerability

**Do not open a public issue for a security problem.** A public report is a
working exploit handed to everyone running ITACM before any of them can patch.

Use one of these instead:

1. **GitHub private advisory** (preferred) —
   [Report a vulnerability](https://github.com/enesyaks/ITACM/security/advisories/new).
   It is private between you and the maintainers, and becomes the advisory
   published with the fix.
2. **Email** — enes@yakisik.com, subject line starting with `ITACM security:`.

Please include:

- what an attacker can do, and what access they need to start (unauthenticated?
  a `Viewer` account? a specific permission group?)
- the steps to reproduce it — a request, a payload, or a short script
- the ITACM version (`/api/health` reports it) and how it is deployed (Docker
  Compose, behind Cloudflare, reverse proxy…)

You do not need a proof-of-concept exploit. A clear description of the flaw is
enough; do not attack an instance you do not own to produce one.

## What to expect

| | |
|---|---|
| First reply | within 5 days |
| Assessment and severity | within 10 days |
| Fix for a confirmed high-severity issue | in the next release, and a patch release if one is not imminent |

Fixes ship with a CHANGELOG entry and a GitHub advisory. You will be credited by
the name or handle you choose, or left anonymous — your call. There is no paid
bounty programme.

## Supported versions

Fixes land on the latest release. This is self-hosted software with no
auto-update: **updating is your responsibility.** See
[Updating](README.md#%EF%B8%8F-updating). Enable `UPDATE_CHECK=1` to be told
when a newer release exists.

## Scope

In scope — anything that breaks the app's own security promises:

- authentication or session handling (JWT, MFA, password reset, logout/revoke)
- authorization: reaching data or actions your role or permission group forbids,
  including escaping a department / location / category / cost constraint
- the AI assistant returning data the asking user's own permissions deny
- SQL injection, SSRF, XSS, path traversal, unsafe file upload or download
- secrets leaking into the audit log, API responses, or error messages

Out of scope:

- anything requiring an Owner account — an Owner is *designed* to have full
  access, including the query surfaces
- findings that need physical or shell access to the host or the database
- missing hardening headers with no demonstrated impact
- rate-limit tuning, and automated-scanner output with no working attack path
- vulnerabilities in a dependency with no path to exploit them through ITACM
  (report those upstream; tell us if ITACM's usage is what makes it reachable)
- self-XSS, clickjacking on unauthenticated pages, or issues that need a user to
  paste attacker-supplied code into a console

## Deploying safely

Most real-world incidents with self-hosted software are configuration, not code.
Before exposing an instance to the internet:

- set a strong `JWT_SECRET` (`openssl rand -hex 32`) and a real
  `POSTGRES_PASSWORD` — never the defaults
- terminate TLS in front of the app (see the `tls` / `cloudflare` compose
  profiles) and set `TRUST_PROXY=1` **only** behind a proxy that sanitises
  forwarded headers
- keep the database off the public internet; the compose port mapping is
  commented out for that reason
- MFA is mandatory for `Owner` accounts — leave it that way
- back up `DATA_DIR` alongside the database; the documents live on the
  filesystem, not in Postgres
