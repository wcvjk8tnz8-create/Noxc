# DNS records

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

## Platform verification

Root-domain verification uses a TXT record with one-click write and re-check. The Cloudflare proxy toggle only applies to supported record types.
