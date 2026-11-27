# Site settings (admins)

Everything below is changed in the console and takes effect on save — no redeploy needed.

## Branding & announcement

| Item | Notes |
|---|---|
| Site name / Logo / favicon | Navigation, title, browser tab |
| **Site announcement** | Plain text up to 300 characters; empty hides it. Appears at the top of every page (console, home, login, docs and root-domain landing pages), rendered as text rather than HTML, and never translated |
| Footer ICP / contact | Paste an `<a>` anchor; empty hides it |

## Registration & verification

- Registration slider captcha toggle and image subset; the dialog only opens on submit, admins are exempt
- Email allowlist and third-party email request channel
- Per-suffix registration limits per person
- Domain validity and renewal window (blank = half of the validity period)

## Pause applications per suffix

Under "Site settings → Pause applications per suffix", tick a root domain to **stop new applications for that suffix only**; every other suffix stays open.

- The home page marks the suffix "Applications paused" and drops the "Register" link
- The registration page locks when that suffix is selected and unlocks when switching back
- WHOIS still works; admins can still create domains manually
- **DNS records, renewal, transfer, showcase and check-in for existing domains are unaffected**
- The notice reuses the "pause message" setting; otherwise a suffix-specific default is used
- `ROOT_APPLY_PAUSED=meoy.top,v-1.top` forces a pause that cannot be cleared from the console

This is separate from per-suffix registration limits: one controls *whether* you can apply, the other *how many times*.

## Third-party domain access (external domain) · SEUS DNS only

Standalone page: <a href="/external-domains">`/external-domains`</a> (documentation-style guide + application form; direct open, refresh and external links all work). The entry also sits directly under the console's **Register domain** card, and the registration page links to it; see the full guide at [Third-party domain access](/en/external-domains.html). The list and WHOIS results are consistently marked **(External domain)**.

**Flow**

1. Enter your own full domain: **gTLD registrable domains only** (e.g. `xxx.com`, `xxx.xyz`, `xxx.top`). **Subdomains such as `xxx.example.com` are not accepted**, nor are ccTLDs (`.cn`, `.uk`, `.cc`, `.io`, `.ai`, ...), documentation examples (`example.com`) or this site's own active suffixes.
2. At your registrar, point the **NS to `a.ns.fs5.net` / `b.ns.fs5.net`** and complete DNS hosting for the domain at s.eus first (BYOS requires KYC L2 and manual review; this site does not do it for you).
3. Click **Connect via API**: the site owner pastes an `mbt_` MCP token into the **single input** under **Site Settings → Third-party domain access** — it takes effect on save, with **no environment variable, Worker Secret or redeploy**; zones are looked up automatically. The site then calls the official `dns_zones` tool to find the hosted zone / zone id. **Leaving it blank also works**: you may temporarily paste your own token when connecting — **used once, never stored**.
4. **Wait for the site owner's approval**: the request appears under **Site Settings → Third-party domain access**. Once approved the domain becomes a root domain and users can apply for subdomains under it.

**SEUS DNS only**: there is no provider picker. After approval the DNS-backend dropdown for that root is disabled and reads "SEUS DNS · third-party (locked)"; even an administrator cannot switch it. All DNS records are written by the site backend through the SEUS API.

> **The common trap**: connecting the API and writing records only affect the hosted zone at SEUS. **Until the registrar NS points at SEUS, global DNS never queries that provider**, so the record has no effect. Responses include `nsWarning` and the approval list marks "NS pending". See README appendices Z.5 / Z.14.

**Boundaries and security**

- Separate `external_domains` table with a per-user index; **no quota usage, not counted in site statistics, no writes to this site's DNS zone**
- Names under this site's active suffixes (including the roots) cannot be registered here
- Up to 5 per account; pending requests can be withdrawn, approved domains are managed by the site owner in Root Domain Management
- **The site-wide SEUS token has a single source** (the `settings.seus_api_token` field) and stays server-side: the admin page only returns a mask, `/api/config` exposes a boolean, and redacted backups blank it out. A user-supplied token is used only for that single request
- No TXT ownership check: ownership is established by "a real hosted zone exists in the SEUS account + registrar NS points at SEUS + manual approval by the site owner"

## D1 read optimisation

The free D1 tier allows 5M rows read per day. Public statistics now live in a single JSON snapshot row in `settings` (recomputed every 10 minutes, read costs 1 row); `/api/config` caches the whole response for 30 seconds with a browser `Cache-Control`; frontend background refresh is throttled to 60 seconds; the registration input uses a 600ms debounce plus a 15-second result cache. A global middleware invalidates caches after every write. See README appendix Z.1.

## Automatically switch to the primary suffix

Pausing **only stops new registrations** — it does not mean the suffix disappears. It is still a site suffix: existing domains keep resolving, renewing and showing up, and it still appears in the public statistics.

- **Application entry points** (home suffix cards and lookup dropdown, WHOIS dropdown, root-domain landing page dropdown) omit paused suffixes
- In the **registration suffix picker**, a paused suffix is **still shown, greyed out and unclickable** (`disabled` + reduced opacity + `pointer-events:none`), labelled "PAUSED" on the right

- The primary suffix is `noxc.uk` (marked "Featured" on the home page); if it is paused too, the next open suffix is used automatically
- Arriving via `/register?root=paused-suffix` or an old home / WHOIS / landing-page link **automatically switches to the primary suffix** and rewrites the URL, so a refresh does not jump back
- If the currently selected suffix is paused while the page is open, the registration page switches to the primary suffix immediately instead of locking the picker (the old version got stuck after switching)
- The suffix picker stays **clickable** while paused: open suffixes and greyed-out paused suffixes are both visible, so you can never get stuck on a paused one
- The **expanded statistics breakdown still lists every active suffix** (including a paused `meoy.top`); a paused row only gets a muted "PAUSED" tag. The "Most active suffix HOT" label follows real approved-domain counts and is not hidden by a pause; totals still reflect the whole site
- If every suffix is paused there is nothing to switch to, so the submit button stays hard-locked

## Submit button cannot be clicked while paused

When a suffix is paused, the "Submit registration" button is **hard-locked**, not merely rejected by the API:

- `disabled` + `aria-disabled` + CSS `pointer-events:none` — even stale cached JS cannot receive a click
- The click handler, slider-captcha callback, `doSubmit()` and the pending-application loader all re-check the current suffix
- The captcha modal never opens while paused, and is closed immediately if already open
- The frontend locks everyone (admins included); the API still returns 403 as the last line, while admin self-provisioning stays exempt
- WHOIS results no longer offer an "Apply for this domain" button

Arriving from the home page, WHOIS or a root-domain landing page with `?root=` uses the same check. Switching back to an open suffix unlocks the button.

## Points & rewards

Points rules (check-in / initial / regular / short), showcase reward amount (default +6000, set 0 to disable), default quota and sync-to-all.

## Third-party services

NodeLoc / GitHub OAuth client ID and secret (server-side only, never sent to the browser), AI review channel, root domain list, public stats and DNSHE NS presets.

## Abuse reports

The "Report abuse · handling entry" button in the admin header opens the report page. Admins can mark investigating / resolved / dismissed, or suspend a domain directly.
