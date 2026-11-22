# DNS 记录

## 支持的记录类型

A、AAAA、CNAME、MX、TXT、NS、CAA、SRV、PTR、SPF、DS、HTTPS 等，共 12 种，均支持自定义 TTL。

## NS 记录

**NS 记录也是普通 DNS 记录**：和 A / TXT 走同一套接口、同一张表，添加后出现在记录列表里，可编辑可删除。

在「域名管理 → DNS 记录」卡片标题栏有「一键添加 DNSHE」按钮，点一次写入两条预设 NS，重复点不会产生第二组。

::: warning 两组 NS 不要混用
- `ns1.dnshe.org` / `ns2.dnshe.org`：**外部域名托管到 DNSHE** 用的 NS 主机
- `ns1.dnshe.com` / `ns2.dnshe.com`：**专属于在 DNSHE 注册的域名**的 NS 服务器
- `api005.dnshe.com` 是 WHOIS / DNS REST 的 API 网关，**不是 NS 主机**

:::

## NS 委托

「NS 委派」页只写两条 NS 记录，**不转移解析权**，也不改动注册商处的设置。取消托管会按当前预设删除对应记录。

## 平台验证

根域名验证用 TXT 记录，控制台提供一键写入与重新校验。Cloudflare 代理开关仅对支持的记录类型生效。
