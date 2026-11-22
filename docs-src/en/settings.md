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

## Points & rewards

Points rules (check-in / initial / regular / short), showcase reward amount (default +6000, set 0 to disable), default quota and sync-to-all.

## Third-party services

NodeLoc / GitHub OAuth client ID and secret (server-side only, never sent to the browser), AI review channel, root domain list, public stats and DNSHE NS presets.

## Abuse reports

The "Report abuse · handling entry" button in the admin header opens the report page. Admins can mark investigating / resolved / dismissed, or suspend a domain directly.
