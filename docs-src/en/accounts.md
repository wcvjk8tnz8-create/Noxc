# Accounts & quota

## Points

Configurable in "Site settings → Points rules". Defaults:

| Item | Value |
|---|---|
| Daily check-in | +30 |
| New user | 100 |
| Regular domain | −60 |
| Single-character domain | −300 |

All in-page descriptions are served by `/api/config`, so changing the setting never leaves stale numbers behind. Admins and unlimited (`-1`) accounts are exempt; points cap at 10000.

## Earning quota

- **Bind NodeLoc**: +5 once per account
- **Bind GitHub and star the project**: +5 once, verified live against GitHub
- **Showcase a domain**: first time you enable showcase on an approved domain → **+6000**, once per account, not revoked on disable

Bind / unbind from the profile page. Third-party login requires admin-configured app credentials.

## Per-suffix registration limits

Admins can cap registrations per person per root domain, e.g. `meoy.top:1`, `noxc.uk:-1` (unlimited). Releasing a domain does not refund the counter, and **users who registered before the feature launched are unaffected**.

## Email & login

- Email codes for sign-up, email change and password change (no old password required)
- NodeLoc login reads the real email instead of generating a random `@oauth.local` placeholder
- Addresses like `ns1/ns2.dnshe.com` are no longer mistaken for an "edu" registration bypass

## Bans

Banned accounts cannot return through third-party login. Appeals go through the [report channel](https://nic.299282.xyz/report) or the contact details in the site announcement.
