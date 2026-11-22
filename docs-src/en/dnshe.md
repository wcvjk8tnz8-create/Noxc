# DNSHE hosting

Written from the console screenshots; if the DNSHE UI changes later, follow the live interface.

## Fig 1 · Sign in

![Fig 1 · Sign in to DNSHE](/docs/img/fig1.png)

Open the DNSHE console and sign in.

## Fig 2 · Domain list

![Fig 2 · Domain list](/docs/img/fig2.png)

Locate the domain you want to host and open its management page.

## Fig 3 · Domain overview

![Fig 3 · Domain overview](/docs/img/fig3.png)

Check the domain status and its current nameservers.

## Fig 4 · DNS management

![Fig 4 · DNS management](/docs/img/fig4.png)

Switch to the DNS records / nameserver settings.

## Fig 5 · NS records are DNS records

![Fig 5 · NS records are ordinary DNS records](/docs/img/fig5.png)

NS records appear in the normal record list and can be edited or deleted.

## Fig 6 · Write hosting NS

![Fig 6 · Write hosting NS](/docs/img/fig6.png)

External domains use `ns1.dnshe.org` and `ns2.dnshe.org`.

::: tip Do not use the wrong set
`ns1.dnshe.com` / `ns2.dnshe.com` are only for **domains registered at DNSHE**; `api005.dnshe.com` is an API gateway, not a nameserver.
:::

## Fig 7 · New domain setup dialog

![Fig 7 · New domain setup dialog](/docs/img/fig7.png)

There are three buttons at the bottom. **Only the blue `Add DNS records` in the middle opens Fig 8**:

| Button | Effect |
|---|---|
| `Check again` | Refreshes the yellow notice in place, no navigation |
| **`Add DNS records`** | **Opens the DNS records page (Fig 8)** |
| `Cancel` | Exits the wizard |

This is the step most people get wrong — always click `Add DNS records`.

## Fig 8 · DNS records page

![Fig 8 · DNS records page](/docs/img/fig8.png)

"0 records / No DNS records found." is the **normal state of a fresh zone**, not an error. Start adding records here.
