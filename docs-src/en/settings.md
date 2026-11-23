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

## Automatically switch to the primary suffix

A paused root domain is **removed from every selectable list**: the registration suffix menu, home page suffix cards and lookup dropdown, WHOIS dropdown and root-domain landing page dropdown do not show it at all, so it **cannot be clicked**.

- The primary suffix is `noxc.uk` (marked "Featured" on the home page); if it is paused too, the next open suffix is used automatically
- Arriving via `/register?root=paused-suffix` or an old home / WHOIS / landing-page link **automatically switches to the primary suffix** and rewrites the URL, so a refresh does not jump back
- If the currently selected suffix is paused while the page is open, the registration page switches to the primary suffix immediately instead of locking the picker (the old version got stuck after switching)
- The suffix picker stays **clickable** while paused; it simply contains only open suffixes
- The expanded statistics breakdown and the "Most active suffix HOT" label hide paused suffixes; the totals still reflect the whole site
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
