# Third-party domain access (external domains)

Bring a **full domain you own** into Noxc. It is labelled **(External domain)** everywhere, and DNS is **fixed to SEUS DNS** — there is no provider picker.

> Interactive entry: <a href="/external-domains">open the standalone Third-party domain access page →</a> (direct open, refresh and external links all work). The same entry also stays under the "Register domain" card in the console.

## Eligibility

- Only **gTLD second-level domains** such as `xxx.com` / `xxx.xyz` / `xxx.top`
- **Not accepted**: subdomains like `xxx.example.com`, documentation examples such as `example.com`
- **Not accepted**: ccTLD / country suffixes like `.cn` / `.uk` / `.cc` / `.io` / `.ai` / `.tv`
- Active site suffixes cannot be submitted as external domains
- Up to 5 domains per account; no registration quota usage, excluded from public statistics

The allowlist lives in `GTLD_ALLOWLIST`; adding a new gTLD requires one entry plus a regression update.

## Step by step

1. Enter your own full domain on the standalone page (or the console card) and submit
2. At your **registrar**, change the NS to `a.ns.fs5.net` / `b.ns.fs5.net`, and finish DNS hosting for the domain at s.eus first (BYOS requires KYC L2 and manual review, which the site does not do for you)
3. Click **Connect via API**: the site uses the `mbt_` MCP token from the **single input** under **Site Settings → Third-party domain access** to call the official `dns_zones` tool and find the hosted zone / zone id. It takes effect **on save** — no environment variable, Worker Secret or redeploy; zones are looked up automatically
4. **Leaving it blank also works**: when no site token is configured, you can temporarily paste your own `mbt_` token while connecting — used for that one request only, never stored or echoed back
5. Wait for the site owner to approve in **Site Settings → Third-party domain access**. Only applications with a connected SEUS zone can be approved; afterwards the domain becomes a root domain and you can apply for subdomains under it

After approval, `root_dns_backends` is set to `<domain>:seus` and `external_root_lock` pins it: the DNS dropdown in **Root domain management** is disabled and marked "SEUS DNS · third-party (locked)", and the switch API rejects changes. All four `cfCreate / cfUpdate / cfDelete / cfList` entry points dispatch to the site-level SEUS backend.

## Ownership and boundaries

There is no TXT ownership check — the chain is "a real hosted zone exists in the SEUS account + registrar NS points to SEUS + manual approval by the site owner".

- The token has a single source (`settings.seus_api_token`) and stays server-side; the admin page returns only a mask, `/api/config` exposes a boolean, and redacted backups blank it out
- Records are written into the SEUS hosted zone; **until the registrar NS points to SEUS, global DNS will never query them**
- Turn off DNSSEC at the registrar before switching nameservers, or the domain may become unreachable during the transition
- A separate table with a user index keeps this feature out of public-statistics aggregation and D1 read volume

## FAQ

| Symptom | Check |
|---|---|
| Connected and records written, but nothing resolves | `dig NS xxx.com @1.1.1.1` — are the authoritative NS the two SEUS servers? Use **Recheck NS** on the application |
| Authentication error | Is the token `mbt_` with `dns:read` / `dns:write`? Do not mix in an AnyNS `nhtdns_` token |
| Want to switch the DNS backend after approval | Not possible; SEUS DNS is fixed by design, the dropdown is disabled and the switch API rejects it |
| Application missing from the approval list | The domain must be submitted and connected to a SEUS zone before it becomes approvable |

See [Site settings](/en/settings.html) for the rest of the admin options.
