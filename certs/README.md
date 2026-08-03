# TLS certificates

This folder holds a **Cloudflare Origin Certificate** for the
`docker compose --profile cloudflare` deployment. The certificate and its
private key are **git-ignored** (`certs/*.pem`, `certs/*.key`) — never commit
them.

## How to get the files (once)

1. In the Cloudflare dashboard: **SSL/TLS → Origin Server → Create Certificate**.
2. Keep the defaults (RSA, 15-year), list your hostname(s), e.g.
   `itacm.company.com` (and `*.company.com` if you want a wildcard). Create.
3. Save the two blocks that Cloudflare shows into this folder:
   - **Origin Certificate** → `certs/origin.pem`
   - **Private Key** → `certs/origin.key`
4. Lock down the key so only you can read it:

   ```bash
   chmod 600 certs/origin.key
   ```

## Then

```bash
docker compose --profile cloudflare up -d
```

and set Cloudflare **SSL/TLS → Overview → Full (strict)**. See the README section
"Behind Cloudflare — end-to-end TLS" for the full walkthrough.
