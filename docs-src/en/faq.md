# Known limits & FAQ

## Domains

- No website hosting, no SLA, not a registrar for arbitrary TLDs
- Renewal is judged against the current site setting; changing it affects *when* you can renew, not existing expiry dates
- Releasing a domain does not refund the per-person registration counter
- Reserved labels (`ai` / `dash` / `nic` baseline) can still be created manually by admins

## Email

Email change / password change / sign-up codes all require a mail provider. Without Resend or Brevo configured the API clearly returns 503 instead of pretending to send.

## Third-party login

The NodeLoc app must have the `email` scope, otherwise login fails with `email_required` rather than falling back to a placeholder address. GitHub star rewards are verified live against GitHub.

## Storage

KV / R2 are created and bound by CI. If the token lacks permission the binding degrades without blocking deployment. Check `kvBound` / `avatarUpload` in `/api/config`.

## Fonts

Latin text uses Redaction 35 from Google Fonts (async). System fonts are the fallback; reading is unaffected.

## Abuse

For phishing, malware, spam or other violations, use [Report abuse](https://nic.299282.xyz/report). An admin will review it as soon as possible.
