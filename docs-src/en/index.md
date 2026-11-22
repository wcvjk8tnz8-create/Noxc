# About Noxc

Noxc is a free subdomain distribution and DNS management system running on **Cloudflare Workers + D1**.

You request `<label>.<root-domain>`, get an independent subdomain and your own console: DNS records, NS delegation, expiry dates and more.

## What the platform provides

- DNS resolution and basic technical hosting, 12 record types with custom TTL
- A standalone domain console, WHOIS lookup and a public user showcase
- One-click NS delegation for DNSHE hosting
- Third-party login (NodeLoc / GitHub), email verification codes and daily points

## What it does not provide

- No website hosting and no SLA
- Not a registrar for arbitrary TLDs — only root domains owned by the platform
- The content and operation of each subdomain are the sole responsibility of its owner; the platform assumes no liability for user-generated content

::: tip Primary domain vs. recommended suffix
The primary domain is `meoy.top`. `noxc.uk` is the **recommended suffix** (first in the list), not the primary domain — Zone configuration never changes because of that.
:::

## Stack

| Layer | Role |
|---|---|
| Cloudflare Workers | API, page rendering, static asset fallback |
| D1 (SQLite) | Users, domains, records, points, reports |
| KV / R2 | Cache and user avatars (auto-bound in CI) |
| React + Vite | Console and public pages |
| VitePress | This documentation |

Next: [Quick start](./quick-start.html).
