# DNS records

## Switch domain

The domain detail page has a **Switch domain** dropdown at the top. Choosing another domain reloads the whole page — the title, overview, DNS record list, NS delegation state and showcase settings all update together, and the current tab is kept.

The "Current domain" line inside the Verification card is a **read-only label**, not a switcher: verification records are always written under the root domain of the domain you are viewing. This card used to have a local "Select a domain" dropdown that only changed the verification target without switching the page; the record list below stayed on the old domain, and the next "Add record" wrote back to that old domain, which looked like a duplicate record appearing out of nowhere. Always use the top dropdown to change domains.

## Duplicate protection

The Save button is disabled immediately on click and shows "Saving…", so a slow response plus repeated clicks cannot submit twice. The backend is idempotent for records with the **same name, type and value** and will not create a second record at Cloudflare. Multiple records of the same type with different values (e.g. several AAAA records) or different hostnames are still allowed.

## Record types

A, AAAA, CNAME, MX, TXT, NS, CAA, SRV, PTR, SPF, DS, HTTPS and more — 12 types, all with custom TTL.

## NS records

**An NS record is an ordinary DNS record**: same API, same table, same list as A / TXT. It can be edited and deleted.

The "Add DNSHE" button in the DNS records card header writes the two preset NS records in one click; clicking again does not create duplicates.

::: warning Do not mix the two NS sets
- `ns1.dnshe.org` / `ns2.dnshe.org`: nameservers for **external domains hosted on DNSHE**
- `ns1.dnshe.com` / `ns2.dnshe.com`: nameservers **reserved for domains registered at DNSHE**
- `api005.dnshe.com` is the WHOIS / DNS REST API gateway, **not a nameserver**

:::

## NS delegation

The delegation page writes only the two NS records. It does **not** transfer resolution authority and does not touch registrar settings. Cancelling removes the current preset records.

For **anyns.io** (n.ht community), paste an `nhtdns_` **management token**
created in its panel: Noxc looks up the zone first, creates it only when
missing, and writes the returned `zone.ns` into the NS records. DDNS / ACME
tokens cannot be used here (`token_scope_mismatch`). The token is used only
for that request and never stored. After delegating, "Check delegation" uses
the same token — AnyNS has no dedicated delegation-check endpoint, so this
only reports zone state and its recorded NS; confirm the registrar NS with
`dig NS` or the panel.

## Platform verification

Root-domain verification uses a TXT record with one-click write and re-check. The Cloudflare proxy toggle only applies to supported record types.
