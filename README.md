# Noxc

**Noxc** —— 免费、开源的新一代二级域名分发与 DNS 管理系统。

> 正式更名为 **Noxc**，首推 `noxc.uk` 子域名：它排在后缀选择器第一位并标注「首推」。**主域名仍是 `meoy.top`**，`ROOT_DOMAIN` 与默认 Cloudflare Zone（`CF_ZONE_ID`）都不变 —— 首推只是展示排序，不需要更换 Zone ID，也不需要在站点设置里重配主域名。若要把 `noxc.uk` 真正开放申请，再到后台添加该根域名及其 Zone 配置即可。

前端 **React 18 + TypeScript + Vite**（单页应用，全站无手写 HTML 页面），后端 **TypeScript + Hono on Cloudflare Workers + D1 + KV + R2**。用户自助申请 `xxx.你的根域名`，审核通过后自行添加 DNS 记录；每个根域名可单独选择通过 **Cloudflare API** 或 **Spaceship DNS API** 下发。

> 内置落地首页（`/home`）、12 种 DNS 记录、根域名验证、域名托管委派、工单与转移、积分与兑换券。

---

## 文档导航

| 想找什么 | 去哪 |
|---|---|
| 最近新增的能力 | 速览 · 近期新增 |
| 功能全貌 | 一、核心特性 |
| 从零部署 / Token 权限 | 三、部署步骤 |
| 接口 / 安全 | 五、接口一览 · 六、安全设计 |
| 单项功能实现细节与沿革 | 附录 · 功能与实现细节 |
| **错误 / 故障 / 限制 / 排查**（统一在文末） | **附录 Z · 故障排查与已知错误** |
| KV / R2 没自动绑上、D1 读取超限 | 附录 Z.2 / Z.1 |
| AnyNS / n.ht 管理 API 接入 | 第 19 节 / 附录 Z.10 |
| meoy.top 暂停解析与迁移提示 | 第 21 节 / 附录 Z.12 |

---

## 速览 · 近期新增

> 以下为最近上线的新能力，配置与边界详见正文；「附录」按主题归档全部实现细节。

### 1. GitHub 登录 / Star 配额奖励

在「站点设置 → 第三方登录 · GitHub」填 OAuth App 的 Client ID / Secret 并启用后：

- 登录页出现「使用 GitHub 登录」，个人资料页出现「绑定 GitHub」；
- 用户绑定后点「领取 Star 奖励」，后端用保存在服务端的 access_token
  实时向 GitHub 复核是否给配置的仓库点了 Star，通过即一次性 **+5 配额**
  （每个本地账号只领一次，解绑重绑、换号、重复点击都不叠加）；
- 回调 URI 必须逐字符填 `https://<你的域名>/oauth/github/callback`，
  授权 scope 为 `read:user user:email public_repo`（最后一项用于校验 Star）；
- Client Secret 与用户 access_token 只在 Worker 侧使用，绝不下发浏览器。

### 2. 按后缀限制注册次数

「站点设置 → 按根域名设置每人注册次数」可为每个生效后缀单独填：

| 值 | 含义 |
|---|---|
| 留空 | 不限制 |
| `-1` | 显式无限 |
| `0` | 禁止该后缀的新申请 |
| 正整数 | 每个账号在该后缀下累计最多注册几次 |

例如 `meoy.top:1` 表示每个账号在 `meoy.top` 下只能成功申请一次。
计数存放在独立的 `root_reg_counts` 表，释放 / 删除域名**不退还次数**；
只影响设置之后的新申请，**已注册用户手里的域名一个都不动**。管理员自建不受限。
也可用环境变量 `ROOT_REG_LIMITS` 配置（后台设置优先）。

### 3. D1 读取优化 / 第三方域名接入 / 暂停后缀自动切主推

- **D1 读取优化**：`/api/config` 整响应缓存、公开统计持久化快照、后台刷新节流、
  注册页打字节流，避免免费版 5M rows read/天 被打满导致站点 500。详见文末「故障排查」。
- **第三方域名接入（即将上线）**：入口与说明已就位，接口统一返回「即将上线」，暂未开放；
  完整实现（TXT 验证 + 供应商 API key 写记录）保留待启用，详见「13」。
- **暂停后缀自动切主推**：旧链接带暂停后缀自动切到主推域名并改写 URL；注册页选择器里暂停项**灰显不可点**而非消失，首页**统计展开与 HOT 照常列出**暂停后缀（暂停申请 ≠ 后缀不存在）。

> 错误、故障、限制与排查步骤**统一写在文末「附录 Z」**，正文不再散落排错内容。

### 4. 组合任务奖励 · 积分优惠码 · 响应速度

- **组合任务 3000 积分**：用户必须**同时**完成「绑定 NodeLoc」与「给项目点 Star
  并领取 Star 奖励」，才一次性获得 **3000 积分**；只完成一项不发，每账号仅一次。
  奖励中心 `/rewards` 可看两项进度并点「检查并领取」，存量用户访问积分接口自动补发。
  金额在「站点设置 → 积分规则 → 组合任务奖励积分」调整，填 0 = 关闭。
- **积分优惠码 `DC-XXXXXX`**：管理员在「奖励中心 → 管理员 · 派发券」选择
  `DC 码 · 积分` 批量生成，面值 1–100000。真实用途是**注册域名时抵扣**：
  申请页填码后实时显示「原价 / 抵扣 / 实付」，只抵本次应付部分（不找零），
  每账号对同一张券限用 1 次。奖励中心里的直接兑换路径保留兼容，两条路径共用
  `redeem_logs` 去重。旧 `V-` / `PE-` 码不受影响，详见「18」。
- **响应速度 / 移除过渡动画**：切页过渡（Miku 遮罩 + 气泡）整体移除，站内点击
  **立即换页**，不再延后 200–1400ms；首屏图片预载从 4 张收到 1 张、不再预热解码壁纸、
  整页与卡片入场动画关掉、就绪兜底从 2.5s/3s 收紧到 800ms/1.2s。数据层保留预取，
  `api.get` 直接复用在飞请求（零重复发）；`/api/config` 冷缓存的 11 个子项改为并发，
  静态资源加 immutable 长缓存。详见「16 / 17 / 18」。

### 5. 其它已上线能力（速查）

| 能力 | 入口 / 说明 |
|---|---|
| NodeLoc OAuth | 登录页「使用 NodeLoc 登录」、个人资料可绑定；只读取真实 email，绑定一次性 +5 配额 |
| GitHub OAuth | 见上；给项目点 Star 后领取，一次性 +5 配额 |
| 自助更换邮箱 | 个人资料 → 安全设置 → 更换邮箱，向**新邮箱**发 6 位验证码，不需原邮箱 |
| 滑块验证 | 点「提交注册」后才弹出拼图，通过后自动接着提交；管理员自建豁免 |
| 用户案例展示 | `/showcase`；开关在域名详情，**默认不展示**；首次开启一次性 +6000 积分（每账号一次） |
| 服务文档 | `/docs`；介绍本系统，并含 DNSHE 托管图文流程 |
| 域名有效期 / 续期 | 剩余少于一半即可续期；后台改有效期，首页文案自动跟着变 |
| 页脚联系方式 | 站点设置可填 Telegram 等链接，留空即隐藏 |

---

## 一、核心特性

### 1. 12 种 DNS 记录类型全支持

| 类型 | 说明 | 备注 |
|---|---|---|
| A | 指向 IPv4 | 可开启 Cloudflare 代理 |
| AAAA | 指向 IPv6 | 可开启代理 |
| CNAME | 域名别名 | 可开启代理 |
| MX | 邮件交换 | 带优先级 |
| TXT | 文本（SPF/DKIM/验证） | |
| NS | 名称服务器（子域委派） | |
| SOA | 起始授权 | **只读**，Cloudflare 不允许 API 修改区域 SOA，页面可查看自动生成的 SOA |
| PTR | 反向解析 | 需在 Cloudflare 托管的反向区域才真正生效 |
| SRV | 服务定位（SIP/XMPP） | 服务名 / 协议 / 优先级 / 权重 / 端口 |
| CAA | CA 授权 | flags + issue/issuewild/iodef 等 |
| NAPTR | 命名权威指针 | order/preference/flags/service/regexp/replacement |
| DS | DNSSEC 委托签名者 | key tag / algorithm / digest type / digest |

### 2. 创建子域名默认零记录

申请子域名时**不会**写入任何 DNS 记录。只有在用户主动添加时才会调用 Cloudflare API 创建，避免产生垃圾记录。

### 3. 根域名验证（Vercel / Netlify / DNSPod …）

在「子域名管理 → DNS 记录」页点击「根域名验证」，选择预设（Vercel `_vercel`、Netlify `_netlify`、DNSPod `_dnsauth`/`_dnspod`、阿里云、Cloudflare、GitHub Pages、Google）或自定义主机名，粘贴平台给的 TXT 值即可写入。

**写入位置**（默认根域名）：

| 作用域 | 生成记录 | 适用 |
|---|---|---|
| 根域名 | `_vercel.meoy.top` | Vercel / Netlify / DNSPod 校验**根域名所有权**时 |
| 本子域名 | `_vercel.xxx.meoy.top` | 平台只校验你自己的子域名时 |

**锁定机制**：验证记录写入后立即 `锁定`：

- 锁定期间**任何人都不能修改或删除**这条记录（按钮被禁用，接口也会拒绝）
- 同一主机名上重复发起验证会被拒绝，提示发起人邮箱
- **唯一退出方式**是发起人点击「确认认证完成」→ 解锁；可选择删除记录（推荐，释放主机名）或保留（如 Google 站点验证需要长期保留）
- 管理员后台「验证锁定」页可强制解锁，作为兜底

这样别人既无法抢注你的验证主机名，也无法在你验证过程中破坏它。

### 4. 账号与审核

- 邮箱 + 密码注册登录（**注册验证码可选**，后台「邮件服务与验证码」开启），PBKDF2-SHA256 哈希存储，HttpOnly Cookie 会话；支持自助「更换邮箱」
- **修改密码改为邮箱验证码**：不再要求输入原密码，验证码发到当前账号邮箱，校验通过才写入新密码
- 第一个注册的用户自动成为管理员
- **管理员子域名配额不限**；新用户默认 5 个，后台可自定义（`0` 禁止 / `-1` 不限量）并可一键同步给存量用户；绑定 NodeLoc、领取 GitHub Star 奖励各可一次性 +5
- **管理员申请子域名免审核**，即时开通
- **管理员可申请保留域名**（www / mail / admin / api，以及 `ai` / `dash` / `nic` 等；见 `RESERVED_LABELS`，环境变量与后台设置只做追加）
- 保留列表已包含站点自身功能前缀：**`whois`**（WHOIS 查询页）、**`bbs`** / **`forum`**、以及 `dnshe` / `anyns` / `dns` / `ns` 等，普通用户无法占用
- 子域名默认需管理员审核（可配置为即时开通）
- **被驳回的子域名不占配额**：列表按状态分开统计，驳回项显示驳回原因并标注「不占配额」，可移除后重新申请同名（也可直接重新申请，系统会自动清除旧的驳回记录）
- 管理员驳回/停用需填写原因，用户在列表里直接可见
- 违规使用可封禁：立即踢下线、禁止登录、全部子域名停用，可选一键清空其所有 DNS 记录

### 5. 服务条款与反滥用

- 独立的 `/terms.html` 页，含：服务条款、**禁止滥用清单（8 类）**、账号规则、免责声明、信息与处置、条款变更
- 注册必须勾选同意条款，未勾选接口直接拒绝
- **注册邮箱规则**：默认「白名单域名 ∪ 教育网邮箱」，`gmail.com` / `googlemail.com` / `qq.com` / `foxmail.com` 默认放行。`edu` **只按域名标签判定**（`school.edu.cn`、`harvard.edu` 算；`edu@gmail.com`、`me@myedu.org` 不算）——旧实现把「地址任意位置出现 edu 三个字」当凭证，会被一次性邮箱绕过，现已修正。硬性封禁的一次性邮箱域名优先于一切规则与白名单；`@oauth.local` 是 NodeLoc 第三方账号占位域名，已解封并精确豁免（其它 `.local` / `.test` 仍拒绝）。另有「精确邮箱白名单」与注册页「申请使用此邮箱」，管理员通过后自动放行。后台「站点设置 → 注册邮箱规则」可切换四种模式（`whitelist_edu` / `whitelist` / `edu_only` / `any`），也可用 `EMAIL_RULE` 设默认值（后台优先）；重置密码、更换邮箱等已有账号操作不受规则限制
- **同 IP 最多注册 2 个账号**（后台可调 1-50），超出时注册接口直接拒绝
- 后台「同 IP 账号」页按 IP 聚合，超标的 IP 标红显示，**一键封禁该 IP 下全部账号**：踢下线 + 停用子域名 + 可选清空 DNS + 可选封禁 IP（禁止再注册/登录）

### 6. 界面风格：Zerexa（简约高雅）

参照 Zerexa Domains 实拍：纯黑白灰零彩色、超大**无衬线**超粗黑体标题（800/900）、等宽 uppercase 小标、1px 发丝线、单屏留白、圆角白卡无阴影、墨黑胶囊按钮。侧栏浮岛与胶囊顶栏的**形状保留**，只替换材质；英文用 Redaction 35，衬线只留给少量高雅小标题。

样式已收敛为 4 层，改视觉只动最后一层：

| 文件 | 职责 |
|---|---|
| `shell.css` | 唯一结构层（几何、布局，颜色全令牌化） |
| `captcha.css` | 滑块验证组件 |
| `oauth.css` | 第三方登录组件 |
| `design-system.css` | **唯一视觉源**：令牌 + Zerexa 排版 |

历史皮肤（CYBER/TERMINAL 霓虹、v2「Nyan」蓝粉毛玻璃、蓝色后台面板骨架）均已废弃，绿色毛玻璃元素已全量移除；附录里的相关章节仅作沿革记录。

### 7. 域名托管（NS 委派）

把某个子域名的解析权整体交给第三方 DNS —— 系统在父区域写入 NS 记录，之后由目标服务商负责解析。

| 服务商 | NS | API 自动建区 |
|---|---|---|
| **anyns.io** | `ns1.anyns.io` `ns2.anyns.io`（备用 ns3/ns4） | 无公开稳定 API，写入 NS 后需到其面板添加域名 |
| **DNSHE** | 默认 `ns1.dnshe.com` `ns2.dnshe.com` | ✅ 填 API Token 可自动创建 zone，并使用其返回的官方 NS |
| **Cloudflare** | 需填你在 CF 看到的专属 NS | — |
| **自定义 NS** | 任意（每行一个，≥2 个） | — |

要点：

- 切换或取消托管会自动清理父区域残留的旧 NS 记录（按 name + content 精确匹配）
- **API Token 只在本次请求中使用，不落库、不写日志**
- DNSHE API 失败时自动降级为「按默认 NS 写入 + 提示去面板确认」，不阻断托管
- DNSHE 支持「检查委派」按钮（调其 `/v1/zones/{id}/delegation`）
- 未托管时本站正常解析；托管后本站 DNS 记录页对该域名不再生效

**两组 NS 别混用**：`ns1/2.dnshe.com` 专属于**在 DNSHE 注册的域名**，由委派页使用；
从本站等外部把域名接入 DNSHE 托管，用 `ns1/2.dnshe.org` —— 控制台 DNS 记录卡片的「一键添加 NS」写的就是这一组。
NS 本身是普通 DNS 记录，可在记录列表里编辑或删除，重复点击不会写出第二组。

新增服务商：编辑 `src/lib/delegation.ts` 的 `DELEGATION_PROVIDERS` 即可。

### 8. 积分与每日签到

| 规则 | 默认 | 说明 |
|---|---|---|
| 每日签到 | **+30 分** | 每个自然日一次（按 UTC+8），重复签到会被拒 |
| 申请子域名 | **−60 分** | 长度 ≥ 2 的名称 |
| 单字域名 | **−300 分** | 长度 ≤ `short_domain_len`（默认 1），如 `a` `1` |
| 管理员 | **不限** | 不消耗、不显示余额，显示 `∞` |
| 新用户初始 | 100 分 | `initial_points` |

默认值的**唯一来源**是 `src/lib/pointDefaults.ts`；`schema.sql` 的 INSERT 与它逐项一致
（健康巡检有防回流断言）。老库首次部署会把**仍等于旧默认**（5 / 10 / 5 / 35）的项一次性刷成
新默认，其余自定义值一律保留；`points_defaults_v2` 标记保证只跑一次、之后不再改写。
`/api/config` 下发完整规则，注册须知与签到地说明随后台设置实时更新，
不会再出现「页面写 5 分、实际扣 60 分」。

**老用户无感迁移**：升级后首次进入积分系统时，按其「已有的、计入额度」的子域名数 × 单个域名价格补偿（`max(初始分, 域名数×60)`）。
**已有域名不会被扣分、不会被回收** —— 5 个域名的老用户按 `max(100, 5×60)` 补偿到 300 分。

全部规则（签到奖励 / 域名价 / 单字价 / 单字长度 / 初始分 / 展示奖励）均可在**管理后台 → 站点设置**改。
管理员可在**用户列表**点「积分」直接设置余额或增减，并有完整流水。

**用户案例展示奖励**：账号首次把任意一个**已开通**域名开启「用户案例展示」，一次性发放
**6000 积分**（后台 `showcase_reward_points` 可改，填 `0` = 关闭奖励）。

- 每个账号只发一次：关闭展示**不回收**，再开、换域名、展示更多域名、重复提交都不叠加
- 只有 `status='approved'` 才算真的展示；管理员与无限积分账号跳过
- `showcase_rewards` 表用 `user_id` 主键 + `INSERT OR IGNORE` 防并发重复发放；入账失败会回滚余额并撤掉占位，下次可重试
- 功能上线前就已开启展示的存量用户，下次访问 `/api/points/me`（进控制台 / 签到地）自动补发，不用重新点开关
- 发放时先按站点正常口径初始化积分，老用户的「已有域名补偿」不会被吃掉

- 积分不足时返回 `402`，提示「积分不足：单字域名需要 300 分，当前 X 分」（数字随后台设置变）
- 单字符域名（如 `a`）此前被 `validateLabel` 拒绝，现已放开 —— 默认需 300 分兑换
- 控制台顶部显示余额与签到按钮（已签到则按钮置灰并提示明日再来），可查看积分明细
- 申请输入框实时显示「消耗 X 分 · 余额 Y 分」，不足时标红
- WHOIS 页也显示价格与余额，积分不足时申请按钮禁用

### 9. WHOIS 查询（可查任意域名）

同一个输入框，两种模式：

| 输入 | 行为 |
|---|---|
| `me` | 查本站子域名（注册状态、持有人、积分价格） |
| `me.meoy.top` | 同上 |
| `example.com` | **查任意域名** → RDAP 注册局数据 |
| `foo.de5.net` | **查任意域名** → DNSHE 公开 WHOIS |

**数据源**

> **口径说明（勿混淆）**：DNSHE 的**托管服务主域是 `dnshe.org`**
> （面板 `my.dnshe.org`、WHOIS 入口 `whois.dnshe.org`）；
> 用户在该服务里**注册到的公共域名后缀才落在 `.com` 侧**，例如 `xxx.dnshe.com`。
> 其余分发后缀见下表；`api005.dnshe.com` 与 `ns1/2.dnshe.com` 是 API / NS 主机，
> 同样属于 `.com` 侧的基础设施，不代表服务主域是 `.com`。
> 代码中 `DNSHE_SUFFIXES` 只列「分发后缀」，判断 WHOIS 数据源用；
> 涉及服务官网、面板、帮助入口时一律用 `dnshe.org`。

- **DNSHE 系分发后缀**（`de5.net` `us.ci` `cc.cd` `ccwu.cc` `bot.cd` `dnshe.com`）
  → `https://api005.dnshe.com/index.php?m=domain_hub&endpoint=whois&domain=xxx`

**DNSHE 凭证（推荐配置，额度更高更稳）**，两种填法任选：

| 方式 | 操作 | 优先级 |
|---|---|---|
| Worker Secret | 仓库 **Settings → Secrets → Actions** 加 `DNSHE_API_KEY` / `DNSHE_API_SECRET`，CI 自动 `wrangler secret put` | **高** |
| 后台填写 | 管理后台 → 站点设置 → DNSHE API 凭证 | 低 |

凭证只通过 **HTTP Header**（`X-API-Key` / `X-API-Secret`）发送 —— 官方已禁止 URL 参数与 Body 传递。
两者都没填时退回**公开模式**（免认证，官方限制 2 次/分钟/IP）。

**安全**：后台 `GET /api/admin/settings` **不回传明文**，只给「是否已配置 + 末 4 位」（如 `••••••••9853`）；Secret 输入框为 `password` 类型，留空表示不修改。由环境变量配置时后台输入框会锁定。
- **其它后缀** → `https://rdap.org/domain/xxx`（自动 302 到对应注册局），免 key，返回结构化 JSON
  - HTTP 404 = 注册局无记录，判为未注册
  - 解析出：注册商 + IANA ID、注册/到期/更新时间、EPP 状态、NS
  - GDPR 下注册人信息基本都被脱敏，代码不尝试解析

**缓存**：结果写入 `whois_cache` 表，TTL 6 小时。上游失败时若有旧缓存仍展示，并标注时间。

**第三方直达链接**（结果卡片底部）：whois.dnshe.org / ICANN Lookup。
（原 whois.com 已移除 —— DNSHE 公开 WHOIS 本身就能查外部域名，无需再外跳。）

**托管服务说明卡**（仿 DNSHE 公共域名说明页）

查询外部域名时会探测其 CNAME 指向，命中后在结果下方展示说明卡：

| CNAME 指向 | 显示为 |
|---|---|
| `dash.domain.meoy.top`（后台配置） | 你设定的名称，如「Noxc 面板」 |
| `cname.vercel-dns.com` | Vercel |
| `*.pages.dev` | Cloudflare Pages |
| `*.github.io` | GitHub Pages |
| 其它已知平台（17 种指纹） | Netlify / Firebase / Render / Fly.io / Deno / Heroku … |
| 认不出但有 CNAME | 标记「未识别平台」，原样展示 CNAME |
| 无 CNAME | 不展示 |

说明卡含：托管方名称、CNAME 指向、**滥用与违规举报通道**（投诉邮箱 + 在线举报入口）、服务条款按钮。

**后台配置项**（站点设置）：

| 项 | 说明 |
|---|---|
| 托管面板域名 / 显示名称 | CNAME 指向该域名时显示你的名称 |
| 投诉邮箱 / 在线举报入口 URL | 举报通道区块内容 |

CNAME 探测走 DoH（cloudflare-dns.com → dns.google 双端点降级），5 秒超时，失败不影响主查询。

新增数据源：编辑 `src/lib/whoisExt.ts`。

> 注意：Cloudflare Workers 有真实出网能力，上述接口在部署后可正常访问。
> 本地沙盒若禁止外部出站，会走「查询失败 + 外链引导」分支，属正常降级。

`GET /api/whois?name=me`（公开，无需登录）或访问 `/whois.html`：

| 字段 | 说明 |
|---|---|
| `statusText` | 可注册 / 审核中 / 已注册 / 已驳回 / 已停用 / 系统保留 |
| `registeredAt`、`recordCount` | 申请时间、DNS 记录数 |
| `holder` | 持有人邮箱，默认脱敏 `ab***@gmail.com` |
| `reason` | 驳回或停用原因 |

**whois 子域名自动跳转**：访问 `whois.<根域名>`（如 `whois.meoy.top`）自动进入查询页；`whois.meoy.top/<名称>` 直接查询该名称。
**服务端重定向**（`src/index.ts` 中间件，不依赖前端 JS，最可靠）：Worker 检测 Host 首段为 `whois`，把 `/` 与 `/<名称>` 302 到 WHOIS 页。**只接管入口页** —— `/dashboard`、`/admin`、`/whois`、`/domain` 等一律放行。

> 历史坑：跳转逻辑曾同时写在前端请求层与服务端，前端那份在**每个页面**都执行，
> 与「已登录跳控制台」互相抢夺形成死循环。现在 **WHOIS 跳转只由服务端处理**，新增跳转逻辑务必只写一处。

**WHOIS 页豁免规则**（免登录公开页，必须完全不受影响）：

1. 服务端中间件第一条判断 `/^\/whois(\.html)?$/i` → 无条件放行，任何 host 都不重定向
2. `mountNav('whois', { optional: true })`，未登录正常渲染；条款页同样按公开页处理
3. 公开页设 `window.MEOY_PUBLIC_PAGE = true`，`api.req` 遇 401 不跳登录页 —— 否则未登录时
   `/api/auth/me` 必然 401，在 whois 子域下会形成 `/whois → / → /whois.html` 循环
4. 页面 head 清除 `meoy_whois_rd` / `meoy_whois_n`，不受旧版本残留状态影响
5. 防循环：只在入口页触发，识别 `whois` / `whois.html` 两种形态，同会话同一目标只跳一次

`wrangler.toml` 设 `run_worker_first = true`，Worker 处理完通过 `ASSETS.fetch()` 回落静态资源。
**不要再手动改写路径**（补 `index.html`、去 `.html`）—— ASSETS 自带 `/xxx.html ⇄ /xxx` 规范化，
两边都改会形成自指 307 死循环。

**入口分流**（`src/html/spa.ts` 同步预置脚本，早于渲染）：

| 访问 | 结果 |
|---|---|
| `meoy.top/` 已登录 | 直接进 `/dashboard`，不闪登录页 |
| `meoy.top/` 未登录 | 登录页（表单先 `visibility:hidden`，确认是访客才显示） |
| `meoy.top/?login=1` | 强制留在登录页（切换账号用） |
| `whois.meoy.top/` · `/google` | → `/whois.html` · `?name=google` |

需先把 `whois` 主机名指向本 Worker：在 Cloudflare Worker 设置里添加**自定义域/路由**
`whois.meoy.top/*`（或在 DNS 加一条指向 Worker 的记录并开启代理）。前缀由 `src/index.ts`
中间件按 Host 首段判断，无需前端配置。

持有人显示策略（后台「站点设置」可改）：`masked` 脱敏（默认）/ `none` 不显示 / `full` 完整公开；**本人与管理员始终可见完整地址**。

**一致性与并发**：`/check`、`/whois`、提交申请三者共用同一套判定（`lookupLabel`），不会出现"页面显示可注册、提交却说已被注册"。此外对 `label` / `fqdn` 的唯一约束冲突做了兜底，并发抢注会返回「手慢一步，该子域名刚刚被他人注册」。

被驳回的名称：仅原申请人（或管理员）可重新申请，其他人查询时显示「暂不可用（原申请人正在处理）」，与提交时判定完全一致。

### 10. 登录页与落地页

- 登录页为「左侧品牌陈述 + 右侧表单卡片」：邮箱 + 密码 + **记住我**，
  注册 / 找回密码在同一卡片内切换；早期右侧四块说明模块与顶栏壁纸切换器已移除
- 顶栏：Logo + 站点名、注册账号 / 返回首页 / 服务条款
- 落地页为 Zerexa 风格：超大标题、整行搜索框（前缀 + 根域名下拉 + 查询）、
  胶囊入口、四张指标卡，并显示注册人数与已开通域名数
- 已登录访问 `/login` 直接进控制台；首页顶栏把「登录」换成「→ 去往控制台」

**记住我**：勾选 → 会话 90 天；不勾选 → 1 天。注册默认 90 天。

### 11. 站点品牌（后台可改）

管理员在「管理后台 → 站点设置」可实时修改，无需重新部署：

| 项 | 默认 | 说明 |
|---|---|---|
| 站点名称 | `Noxc` | 显示在导航、标题、浏览器标签 |
| Logo | `/img/logo.jpg` | 站内路径或外链图片均可，带实时预览 |
| favicon | `/img/favicon.png` | 浏览器标签图标 |
| 站点公告 | 空 | 纯文本，最多 300 字，留空则不显示；全站每页可见 |

改完点保存，导航 Logo 与公告条立即刷新，其它页面刷新一次生效。另有「恢复默认 Logo」按钮。

**站点公告以前是「死字段」**：`/api/config` 的 `SELECT` 清单漏了 `announcement`，
前端永远读到 `undefined`；且旧渲染逻辑只在控制台 `mountShell()` 里插、还要求
页面有 `.main`，首页 / 登录 / 注册 / WHOIS / 条款都看不到。现在由 `/api/config`
下发纯文本，`mountAnnouncement()` 统一在 `refreshRuntime()`（每次切页）与
`applyBranding()`（后台保存即时生效）挂载：控制台插在 `.main` 内顶部，其余页面
插在 `body` 最前；纯文档流、零彩色、不压顶栏，长公告可换行。公告是管理员自填
内容，用 `textContent` 渲染并标 `data-no-i18n`，不解析 HTML、英文模式也不翻译。

想换成本地图：把图片放进仓库的 `public/img/`，推一次，再把地址填进后台即可。

### 12. 域名有效期与续期

新域名默认有效期 **365 天**（后台「站点设置 → 域名有效期」可设 1–3650 天）。

**续期窗口 = 有效期的一半**：剩余有效期少于一半即可续期，向下取整（365 → 182 天、
90 → 45 天）。后台「续期窗口（天）」**留空就是自动**，改有效期时窗口自动跟着变；
只有要固定天数才填数字，填 `0` 表示不开放续期。

- 每次续期在原到期时间上顺延一个完整周期；已过期的域名不能续，只能重新申请
- 迁移前已注册的 approved 域名、管理员持有的域名为**永久有效**，不追溯有效期
- 首页三张后缀卡、四张特性卡、注册须知的「单次注册 X 天，到期前 Y 天可续期」全部由
  `/api/config` 的 `expiry` 实时下发，**不再写死 365 / 180**；服务条款与续期失败提示同理
- 文案生成收敛在 `expiryTipText()`，判定收敛在 `renewalWindowDays()`，
  由 `scripts/expiry-regression.ts` 逐项守住边界
- 老库升级只把仍是旧默认 `180` 的库一次性清空（标记 `renew_window_half_v2`），
  管理员自定义值一律保留；后台 `expiry` 已从 `secrets` 提到顶层，输入框不会再显示写死值

---

### 13. 第三方域名接入（外部域名）· 即将上线

入口在控制台「**注册域名**」卡片下面，注册页底部也有状态提示；列表与 WHOIS 统一标
「（外部域名）」。**该功能当前即将上线，暂未开放**：前端只展示状态与计划流程，
后端 `/api/external-domains` 由统一闸门返回 `503 + comingSoon`，不会写入任何数据。

计划中的流程（代码已完整保留，把 `EXTERNAL_DOMAINS_COMING_SOON` 改为 `false` 即可启用）：
**提交域名 → 在当前 DNS 服务商加 `_noxc-verify.<域名>` TXT 验证所有权（公共 DoH）
→ 填自己的 Cloudflare / DNSHE API key 连接 → 添加 DNS 记录**。

> TXT 只证明所有权，**记录生效还要求域名 NS 指向该供应商**，这一步在注册商完成。
> 上线后的排错详见文末「附录 Z.5」。

独立表 + 用户索引，不占配额、不计入公开统计、不写本站 DNS；每账号最多 5 个；
记录名称限定为该域名或其子域；**API key 只在本次请求使用，不落库、每次重填**。

### 14. 数据备份与恢复（管理员）

后台「**管理后台 → 数据备份**」可导出三份文件，遗失时重新汇入：

| 导出物 | 格式 | 内容 |
|---|---|---|
| 子域名 | CSV | 固定列清单，含 `owner_email`；跨库时按邮箱重新对应归属，不依赖旧 `user_id` |
| 用户 | CSV | 含密码哈希，恢复后可原样登录；请加密保存 |
| 站点设置 | JSON | 带 `format` / `version`；**默认包含全部凭据真值**，遗失后可原样汇入；仅分享时才勾选「生成脱敏副本」 |

汇入是**两步**：先「预览」（`dryRun`，只算不写），确认统计后再「确认汇入」。
默认 **merge 只补缺失**，现有数据一字不动；`replace` 覆盖同名记录的可恢复字段，
但**永不覆盖**现有用户密码哈希与角色。脱敏副本里的空密钥会被跳过，不会冲掉正在使用的配置；
JSON 的 `emptyKeys` 列出库中本来就未配置的项（不是导出丢值）；统计快照与运行时迁移标记不导出、不汇入。单文件上限 2MB / 20000 行，全部字段白名单校验、
SQL 参数化，仅管理员可操作。导出是一次性全表读取，属低频手动操作，勿放进轮询。

格式层在 `src/lib/backupFormat.ts`，路由在 `src/routes/backup.ts`；
专项回归 `scripts/backup-regression.ts` 覆盖导出 → 清空 → 汇入的完整 round-trip。
**注意事项与常见错误**统一见文末「Z.6」。

### 15. 界面风格 · NodeLoc 3.0 全圆角形态层

全站形态**全面改版为 NodeLoc 3.0 风格**（参照其深色论坛实拍截图），但**颜色保持
Noxc 现行色板不变**：明/暗主题的 `--zx-*` 颜色令牌仍由
`src/app/styles/design-system.css` 独占定义，形态层
`src/app/styles/nodeloc-skin.css` **不定义任何色值**，`background` / `color` /
`border-color` 一律引用既有令牌。想回到旧外观，删掉 `src/app/main.tsx` 最后一行
`import './styles/nodeloc-skin.css'` 即可。

圆角阶梯定义在唯一视觉源 `design-system.css`，全站所有层共用同一组：

| 令牌 | 值 | 用在哪 |
|---|---|---|
| `--nl-r-sm` | 14px | 小控件 / 源头直角替换 |
| `--nl-r` | 18px | 卡片 / 输入框 / 表格 / 弹窗 / 下拉 |
| `--nl-r-lg` | 24px | 面板 / 侧栏分组 / 公告横幅 / 页面骨架 |
| `--nl-r-pill` | 999px | 按钮 / 标签 / 徽章 / 导航项 / chips |
| `--nl-r-round` | 50% | 圆形图标按钮 |

对照截图改了什么（**抄形态不抄配色**）：

| 部位 | 旧（Yunamo / Zerexa 骨架） | 现在（NodeLoc 3.0） |
|---|---|---|
| 圆角 | 14px / 20px 两档，仍有拼接直角 | **全站统一收口**：组件 100% 非直角，`shell.css` / `design-system.css` 源头 15 处 `border-radius: 0 !important` 全部清掉 |
| 按钮 / 标签 | 14px 圆角矩形 | **胶囊**；侧栏图标、菜单开关改**圆形** |
| 顶栏 / 侧栏 | 贴边直角骨架 | 骨架本身四角圆角；侧栏分组是圆角卡片、导航项是胶囊、选中态有独立底色 |
| 公告横幅 | 贴边纯文本条 | **大圆角卡片** + 圆点 + 发丝线 |
| 查询条 | 输入与后缀拼接成直角边 | 合成一条**完整胶囊**，按钮独立胶囊 |
| 首页结构 | 左右分栏 + 右侧查询卡 | **保留**（上一轮成果，功能契约与卡内顺序不变） |
| 材质 | 发丝线、零阴影 | 零阴影 / 零毛玻璃；新增极淡柔光与点阵（只用令牌的渐变） |

**效果层（纯白不闷）**：用户反馈「简单的纯白有点闷」。`yunamo.com` 是 Vue 3 + Vite
的 SPA，抓取只返回标题、拿不到打包后的 CSS；公开 README 确认前端为
**Vue 3 + Vite + Tailwind CSS + DaisyUI**，DaisyUI 靠 `base-100/200/300` 三层底色、
1px 边框、`depth` 与 `noise` 做层次而不靠彩色。据此落地一版克制效果：

| 效果 | 实现 | 守护 |
|---|---|---|
| 纸面层次 | 两处柔光 + 26px 超淡点阵 | 只引用 `--zx-blue-a8` / `--zx-hair-2`，零颜色字面量 |
| 查询卡 | 右上角柔光晕 9s 呼吸 | `@keyframes nl-glow`，被卡片圆角裁住 |
| 墨点 | eyebrow / 公告圆点 3.8s pulse | `@keyframes nl-dot` |
| 交互 | 卡片上浮 2px、边框加深；按钮 / 导航 / 统计行 hover 底色 | 只走 `transform` / `opacity`，零投影、零 JS、零请求 |

常驻循环动画**恰好两条**；`html[data-motion="paused"]`、`prefers-reduced-motion`
两条既有链路会把动画与 hover 位移一并停掉。**没有恢复**毛玻璃，也**没有恢复**
上一轮删掉的切页过渡（hover 微动效 ≠ 200~1400ms 导航延后）。

**动效默认关闭**：社区反馈「网站太卡、动画效果太多」后，入口 `main.tsx` 把
`documentElement` 统一标成 `data-motion="paused"`，花瓣 / 猫爪 / 柔光呼吸 / 圆点
pulse、几十条 hover 过渡与 JS 数字滚动全部停掉；用户点首页「恢复动效」才放开，
选择记在 `localStorage` 跨页保留。暂停态下入场元素仍强制可见，不会停在 `opacity:0`。

颜色口径沿用上一轮：明色是纯白 + 墨黑 + 灰，暗色由 `design-system.css` 独占定义，
形态层扫描到任何 `#hex` / `rgb()` / `hsl()` 字面量或重定义 `--zx-*` 颜色变量即判失败。
专项回归 `scripts/nodeloc-skin-regression.ts`（静态 + 浏览器计算样式）逐项比对
10 个核心色值、逐元素扫描全站圆角（明/暗 × 首页/控制台等效 DOM），
`scripts/nodeloc-skin-render.py` 生成改造前后对照图。**注意事项与常见错误**
统一见文末「Z.7 / Z.9」。

### 16. 奖励中心：组合任务与 DC 积分码

`/rewards` 在原有 V / PE 兑换码之外新增两块：

| 项目 | 规则 |
|---|---|
| 组合任务 | 绑定 NodeLoc **且** 领取 Star 奖励 → 一次性 +3000 积分 |
| DC 码 | `DC-XXXXXX`（6 位大写、去掉 0/O/1/I/L），管理员批量生成 |

完成判据复用已有真实记录：`oauth_bindings(provider=nodeloc)` 与
`oauth_quota_grants(provider=github-star)`——后者只有 `/claim-star` 实时向 GitHub
复核 204 后才写入，本身就是可信凭据，不重复请求第三方。发放走
`combo_rewards` 表 `user_id` 主键 + `INSERT OR IGNORE`，入账失败会回滚占位，
绝不出现「记了已领却没加分」。管理员 / 无限积分账号跳过，已领不回收，
后台设 0 关闭奖励后调回来仍可领。专项回归 `scripts/rewards-regression.ts`
真跑内存 D1，覆盖缺一不发、并发、回滚、存量补发与 DC 码直接兑换全链路
（直接兑换为兼容路径，`DC-XXXXXX` 的真实用途「注册时抵扣」见「18」）。

**已生成的券可以改**。管理员在「兑换码列表」点「编辑」，可修改
**面值 / 券总使用量 / 已用量（管理员修正）/ 到期时间 / 备注**，不用删了重发
（删券会让旧码上的兑换记录失去对应券）。接口是 `PUT /api/redeem/admin/:id`，
按字段部分更新，券码、类型、创建人不可改；改已用量会写 `redeem.edit` 审计。
总使用量不能低于真实已用量，编辑期间券又被兑换过会返回 409 要求刷新，
不会静默抹掉真实用量。改完立即生效于兑换、`/preview` 与注册页 DC 码抵扣链路。

### 17. 响应速度与过渡动画移除

有用户反映站内切换慢，根因是切页过渡把导航延后到「数据到手 + 动画起手」之后。
现已**移除过渡动画**：删除 `src/app/lib/pageTransition.ts`、遮罩 DOM / CSS、
根域名静态页副本里的过渡层与 300ms 延后跳转，点击链接 `prefetchRoute(href)`
后立即 `navigate(href)`。`prefetch.ts` 新增 `waitPrefetched()`，`api.get` 等同一条
在飞请求，立即换页也不会重复发 GET。

同时收紧首屏成本：图片 preload 4 → 1、去掉壁纸预热解码、整页淡入与卡片
55ms 阶梯入场关闭、就绪硬兜底 2500ms/3000ms → 800ms/1200ms；
`/api/config` 冷缓存的 11 个独立子项改 `Promise.all` 并发（命中配置缓存时仍是 0 次 D1），
`public/_headers` 给带内容 hash 的 `/assets/*` 加 `immutable` 长缓存。
专项回归 `scripts/perf-regression.ts` 真跑预取复用并逐项断言过渡已移除。

### 18. DC 码：注册域名时抵扣积分

`DC-XXXXXX` 是**抵扣券**，不是充值券。用户在 `/register` 的「积分优惠码」栏填写后：

| 环节 | 行为 |
|---|---|
| 查价 | `/api/subdomains/check?discountCode=` 回传 `cost / discount / pay` |
| 提交 | `/api/subdomains` 带 `discountCode`，按 `pay` 判余额、扣分、记 `apply_cost` |
| 消耗 | 先写 `redeem_logs` 再条件 `UPDATE used_count`，域名写入撞车则完整回滚 |

规则：只抵 `min(本次消耗, 券面值)`，**不找零**（面值 3000 用在 60 分域名上只抵 60）；
本次免费不消耗券；积分不足 / 配额已满 / AI 驳回 / 券无效都在消耗之前拦下；
管理员不消耗券。AI 事后驳回收回的是 `apply_cost` 记的「实付」，不会多退。
校验逻辑集中在 `src/lib/discountCode.ts`，注册接口与奖励中心兑换共用
`normCode` 与同一张去重表，所以同一张券不可能「先兑换成余额、再拿去抵扣」。
专项回归 `scripts/discount-code-regression.ts` 用 `node:sqlite` 真跑
`schema.sql` + 三条 Hono 链路，覆盖全额 / 部分抵扣、并发耗尽、撞车回滚等。
该脚本需要 Node 22.5+（CI 主流程是 Node 20，故单独切到 24 执行后立刻切回）。

### 19. AnyNS（n.ht 社区）管理 API 接入

AnyNS（`anyns.io`）是 n.ht 技术社区出品、入驻 NodeLoc 的免费权威 DNS。
此前仓库里它只是「NS 委派」的一个预设，注释写着「未公开稳定的 REST API」，
托管后要自己到面板手工添加域名；现在按官方文档
[anyns.io/docs/api](https://anyns.io/docs/api) 真正接进来了。

**鉴权**：面板创建的 `nhtdns_` 前缀令牌，`Authorization: Bearer`。令牌分三种
scope 且互不通用 —— 管理令牌（本轮用的）、DDNS 令牌（`/nic/update`）、
ACME 令牌（`/api/dns/acme/present`、`/api/dns/certs/current`）。
令牌只在本次请求的内存里用，**不落库、不写日志、不回传前端**。

**接进来的两端**

| 场景 | 之前 | 现在 |
|---|---|---|
| NS 委派 | 只写 NS 记录 + 面板指引 | 填管理令牌 → 幂等建区（已存在不重复建）→ 取回 `zone.ns` 写入父区域；已托管页可「检查委派」 |
| 第三方域名接入 | 只有 Cloudflare / DNSHE / SEUS DNS | 供应商清单加入 `anyns`，用相对名（根域 `@`）写记录 |

管理 API 客户端在 `src/lib/anynsDns.ts`，逐条照官方文档落地：
`zones` 增删改查、`records` 新增/修改（`id>0`）/删除、`lines`、
BIND zone file `export` / `import`、DDNS、ACME。错误按官方
`{error, message}` 分支翻成中文，含 401 / 403 scope 不匹配 / 400
重复记录 / 429 限流（60 次/分、1000 次/时）/ 409 DNSSEC 二次确认。

**官方口径里最容易搞错的两点**

- `zone.ns` 才是「应到注册商填的 NS」，`public_ns` 只是平台默认；
  客户端优先用前者，没返回才回落并标记 `nsSource`。
- **TXT 所有权验证 ≠ 解析生效，写入记录 ≠ 注册商 NS 已改**。
  接口每次都回 `ns` 与警示；官方也**没有**独立的委派校验端点，
  「检查委派」只查 zone 状态与它记录的 NS，并明确提示用 `dig NS` 确认。

> 第三方域名接入仍按此前决定保持 **「即将上线」** 闸门：供应商代码已备好，
> 但后端统一返回 503 `comingSoon`，前端只显示状态卡片。本轮接入 API
> **不等于**重新开放该功能。

专项回归 `scripts/anyns-api-regression.ts` mock 官方接口真跑客户端、
委派预设与供应商适配（鉴权 / 限流 / 幂等 / NS 优先级 / 记录增删改 /
相对名 / 导入导出 / DDNS / ACME / 越域拒绝）。
**注意事项与常见错误**统一见文末「Z.10」。

### 20. SEUS DNS（s.eus）MCP 接入

工作区里同一批「第三方域名接入」供应商扩展还接入了 **SEUS DNS**。
其开发者文档把 DNS 自动化列为 Domains & DNS APIs，但子页需站内会话；
社区官方教程给出的自动化入口是 **MCP Streamable HTTP**：
`https://s.eus/api/mcp` + 账户设置生成的 `mbt_` Token + `Authorization: Bearer`。
适配层 `src/lib/seusDns.ts` 走 `initialize → notifications/initialized → tools/call`，
同时吃得下 `application/json` 与 `text/event-stream`（SSE）两种响应，
工具名照官方暴露的 `dns_zones` / `dns_record_create` 等，不猜裸 REST 路径。

Token 只在本次调用内存里用；SEUS 的相对名称规则（区顶点 `@`）、
`a.ns.fs5.net` / `b.ns.fs5.net` NS 前提、BYOS 需 KYC L2 等口径都在客户端注释里。
专项回归 `scripts/seus-dns-regression.ts` mock 整条 MCP 会话链路，
覆盖鉴权头、会话复用、相对名、错误路径与「即将上线」闸门不回退。

> 与 AnyNS 一样，SEUS 只作为**供应商适配**存在；第三方域名接入仍保持
> 「即将上线」（503 `comingSoon`）。**注意事项与常见错误**见文末「Z.11」。

### 21. meoy.top 暂停解析 · 迁移至 AnyNS（站点级 API 令牌）

`meoy.top` 正在迁移至 **AnyNS**（n.ht 社区的免费权威 DNS）。迁移期间：

- 该后缀下**所有**子域名的状态显示为「**暂停解析**」，控制台与域名详情页
  顶部显示「meoy.top 正在迁移至 anyns」；
- 普通用户暂时不能增删改 DNS 记录（避免记录一边写旧后端、一边迁走），
  **查看记录、WHOIS、续期、用户案例展示、公开统计全部不受影响**；
- **管理员豁免**：迁移记录正是由管理员用站点级 API 令牌补进根域名 zone 的。

**这里澄清上一轮的理解偏差**：第 19 节把 AnyNS 接成了「用户自带令牌」的
NS 委派 / 第三方域名接入（BYOS）。本节的 AnyNS 是**站点后端的 API**：
管理员配一次 `nhtdns_` **管理令牌**，`cf.ts` 就把 `meoy.top` 的记录下发切到
`https://anyns.io/api/dns/v1/zones/:id/records`。普通用户完全无感，
不用填任何 key；**管理员在「站点设置 → AnyNS」里填即可，保存即生效**。

### 站点设置 → AnyNS

后台「站点设置」新增一张 **AnyNS（n.ht 社区）· 站点级 DNS 管理 API** 卡片：

| 字段 | 作用 |
|---|---|
| 管理令牌 | `nhtdns_` 开头；只存服务端，页面只回掩码，留空不修改，可勾选清除 |
| 生效根域名 | 逗号分隔，默认 `meoy.top` |
| Zone ID / 多根映射 | 可选；都没填就按域名 `GET /zones` 查一次并缓存 15 秒 |
| 暂停解析根域名 / 迁移提示 | 同一张卡片管理；**清空第一格即一次性恢复全部域名** |

令牌是敏感项：后台 GET 只回掩码、公开 `/api/config` 完全不下发、
备份的「脱敏副本」会置空（默认完整备份仍含真值以便原样恢复）。
保存后统一失效 settings / dnsProvider / anyns 三层缓存，**不用等
30 秒 TTL，也不用重新部署**。

也可以用 Worker Secret（`ANYNS_API_TOKEN`），**优先级高于后台设置**，
此时后台标「已由环境变量配置」且令牌框只读：

```bash
npx wrangler secret put ANYNS_API_TOKEN
# GitHub：Settings → Secrets and variables → Actions → New repository secret
#          Name = ANYNS_API_TOKEN，Value = nhtdns_xxxxxxxx
```

两个来源都没配令牌时后端完全不启用，`meoy.top` 仍走原来的
Cloudflare / Spaceship，部署也不会中断。

**为什么不动 `subdomains.status`**：`status='approved'` 被公开统计、续期、
配额、用户案例展示等十几处判定依赖，硬改成新值会让几百个域名从统计里
凭空消失、续期被拒。这里只叠加 `dnsPaused` 展示状态；配置在
`settings.dns_paused_roots`（默认 `meoy.top`）与
`settings.dns_migration_notice`。**迁移完成后把 `dns_paused_roots` 清空
即可一次性全部恢复**，不用逐行改数据。

### 根域名管理：拉取域名与「AnyNS」下拉选项

管理员在站点设置保存令牌后，到**「根域名管理」**点 **「从 AnyNS 拉取域名」**：

1. 服务端用该管理令牌调 `GET /api/dns/v1/zones`，列出账号下全部解析区域，
   带上数字 **Zone ID**、官方 NS，并标注哪些已经是本站根域名；
2. 弹窗里勾选 → 还不是根域名的**添加为根域名**；已经是根域名的（例如环境变量
   里配的 `meoy.top`，截图里显示 `CLOUDFLARE DNS`）**把 DNS 写入后端切换成 AnyNS**；
3. Zone ID 自动存进 `settings.anyns_zone_ids`，写记录时直接用，不再查一次 `/zones`。

每行右侧的下拉现在有 **自动 / Spaceship / Cloudflare / AnyNS** 四项，选中后会显示
`ANYNS DNS · #4821` 徽标。**显式选择优先于 `ANYNS_ROOTS` 的自动推断** —— 所以
随时可以切回 Cloudflare 或 Spaceship，不会出现「切不回去」。

> AnyNS 的 zone id 与 Cloudflare Zone ID **分开存**：前者进 `anyns_zone_ids`，
> 后者进 `cf_zone_ids_extra`。混在一起会让后端误判「已配 CF Zone」，把记录
> 写去错误的服务商。

记录名按官方口径转换：完整 FQDN → 相对名，根域 `meoy.top` 用 `@`，
`www.meoy.top` 用 `www`；MX / SRV / CAA 的优先级与结构化字段拼进 `value`；
`ttl=1`（Cloudflare auto）转 AnyNS 的 `300`。DDNS / ACME 令牌不能用于
管理接口，返回 `token_scope_mismatch` 时会明确提示换「管理令牌」。

专项回归 `scripts/anyns-migration-regression.ts` mock 官方接口 + 内存 D1
真跑：暂停判定、记录转换、`cf.ts` 后端选择、后台令牌读写、拉取域名与批量
导入（含缓存踩踏防护）、下拉切到 / 切回 AnyNS、写记录直接复用 Zone ID、
Hono 写闸门（普通用户 403 / 管理员真写进 zone）、清空配置即时恢复。
**注意事项与常见错误**统一见文末「Z.12」。

## 二、项目结构

```
subdomain-hub/
├── src/
│   ├── index.ts                 入口：路由挂载、公开配置、SPA 回落
│   ├── lib/
│   │   ├── records.ts           12 种记录类型的字段定义与校验
│   │   ├── cf.ts                DNS API 封装（自动选 Cloudflare / Spaceship / 自定义）
│   │   ├── spaceshipDns.ts      Spaceship DNS 记录读写适配
│   │   ├── anynsDns.ts          AnyNS（n.ht 社区）管理 API 适配
│   │   ├── crypto.ts            PBKDF2 密码哈希、会话令牌
│   │   └── util.ts              统一响应、审计日志
│   ├── middleware/auth.ts       会话解析、requireAuth / requireAdmin
│   └── routes/*.ts              注册 / 域名 / 记录 / 后台 / 工单 / 转移 …
├── src/html/spa.ts             SPA 外壳模板（构建前生成 index.html，不入库）
├── src/app/                     React 前端
│   ├── main.tsx / App.tsx       入口 + SPA 路由（14 个页面）
│   ├── pages/*.tsx              14 个页面组件
│   ├── legacy/*.ts              由旧内联脚本平移的页面控制器
│   ├── lib/runtime.ts           公共运行时（导航 / 品牌 / 动效 / 头像）
│   └── styles/                  4 层样式：shell / captcha / oauth / design-system
├── public/                      静态资源（css / img / favicon，Vite 原样复制）
├── dist/client/                 Vite 构建产物，由 wrangler [assets] 托管
├── schema.sql                   D1 表结构
└── wrangler.toml                配置
```

---

## 三、部署步骤

### 1. 获取 Cloudflare 凭据

**第一步：先建 Token。** 用下面这条预填链接，不用自己逐项勾权限：

**一键创建（推荐）**：

👉 [创建 Noxc Deploy Token（用户 Token）](https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_kv_storage%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_r2%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22dns%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_routes%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_settings%22%2C%22type%22%3A%22read%22%7D%5D&accountId=%2A&zoneId=all&name=Noxc%20Deploy%20Token)

打开即是 Create Custom Token 表单，7 项权限与名称 `Noxc Deploy Token` 已预填；
确认 Account / Zone 范围后 `Continue to summary` → `Create Token`，
**token 只显示一次，立刻复制**，别贴到聊天或日志里。
CI 场景若不想依赖个人账号，可用 [Account-owned Token](https://dash.cloudflare.com/?to=/:account/api-tokens&permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_kv_storage%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_r2%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22dns%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_routes%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_settings%22%2C%22type%22%3A%22read%22%7D%5D&name=Noxc%20Deploy%20Token)（需 Super/Administrator）。

| 需要什么 | 去哪里拿 |
|---|---|
| **API Token** | 用上方「一键创建 Noxc Deploy Token」链接，7 项权限与名称已预填 |
| **Account ID** | <https://dash.cloudflare.com/?to=/:account/workers-and-pages> 右侧栏 |
| **Zone ID** | 选中根域名 → Overview → 右下角 API 区块 |

API Token 需要的权限（**缺 KV / R2 时部署照样成功，但绑定会静默降级**）：

| 权限 | 资源 | 作用 |
|---|---|---|
| `Account` → `Workers Scripts` → `Edit` | 账户 | 部署 Worker、写 Secret |
| `Account` → `D1` → `Edit` | 账户 | 自动建库 / 执行 schema |
| `Account` → `Workers KV Storage` → `Edit` | 账户 | 自动创建 KV namespace |
| `Account` → `R2` → `Edit` | 账户 | 自动创建头像桶 |
| `Account` → `Workers Routes` → `Edit` | 账户 | 路由 / 自定义域 |
| `Account` → `Account Settings` → `Read` | 账户 | 读取账号信息 |
| `Zone` → `DNS` → `Edit` | 根域名 | 读写 DNS 记录 |

> 也可直接用官方模板 **Edit Cloudflare Workers**（含 Workers / KV / R2 / Routes），
> 再补 `D1 : Edit` 与 `Zone DNS : Edit` 两项。链接只预填表单，不会自动创建 token。

### 2. 填 Secrets，推一次就完事

仓库 **Settings → Secrets and variables → Actions → Secrets**：

**必需**（3 项；两个 Token 二选一，缺任一项部署会直接报错并提示缺谁）

| 名称 | 必需 | 说明 |
|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | 必需 | 账户 ID |
| `CF_ZONE_ID` | 必需 | 根域名的 Zone ID |
| `CLOUDFLARE_API_TOKEN` | **二选一** | Cloudflare API Token，用于 CI 部署（建 D1、建表、发布） |
| `CF_API_TOKEN` | **二选一** | 同上，Worker 运行期调 DNS API 用 |

**关于两个 Token**：它们是同一个东西的两种用途，**填一个就行** ——

- 只填 `CLOUDFLARE_API_TOKEN` → 部署和 DNS 都用它
- 只填 `CF_API_TOKEN` → 部署和 DNS 都用它
- 两个都填 → 各用各的（可以给不同最小权限，更安全）
- 两个都不填 → 工作流第一步就报错退出

**可选**

| 名称 | 说明 |
|---|---|
| `D1_DATABASE_ID` | 一般不填：CI 会自动建库。只有你想用已有的另一个库时才填 |

然后 `git push origin main`，Actions 自动完成全流程（20 步，分组如下）：

1. **检查配置** —— 缺哪个必需项直接报出名字，不用猜
2. **校验** —— 类型检查、静态健康巡检，GitHub OAuth / 注册次数 / 首页 i18n /
   邮箱规则 / 用户案例持久化等回归，再跑 `npm run build`
3. **准备资源** —— D1 按名查找、已存在就复用；KV namespace 与 R2 桶同理，
   创建成功后写入 `wrangler.toml` 绑定（失败则移除绑定降级，见「速览 → 3」）
4. **注入** —— 把 Variables 写进 `wrangler.toml`，把 Token / Zone ID 加密写入 Worker
   （等同 `wrangler secret put`）
5. **建表**（幂等，只建不存在的表）→ **6. `wrangler deploy`**

全程不需要 `wrangler login`、不需要手动改配置文件、不需要手动建库。
绑定状态以 **Job Summary** 与 `/api/config` 的 `kvBound` / `avatarUpload` 为准；
CI 对 `wrangler.toml` 的改动只在本次部署生效，**不会提交回仓库**。

**可选调整**（Settings → Variables，明文即可）：

| 名称 | 说明 | 默认 |
|---|---|---|
| `ROOT_DOMAIN` | 根域名 | `meoy.top` |
| `DEFAULT_QUOTA` | 每用户子域名数 | `5` |
| `ALLOW_SIGNUP` | `1` 开放注册 / `0` 关闭 | `1` |
| `REQUIRE_APPROVAL` | `1` 需审核 / `0` 即时开通 | `1` |
| `RESERVED_LABELS` | 保留子域名（逗号分隔） | www/mail/admin… |
| `D1_DATABASE_NAME` | D1 数据库名 | `subdomain-hub-db` |
| `CF_MOCK` | `1` = 不调真实 Cloudflare | `0` |

改完 Variables 后手动 **Actions → Run workflow** 一次即可生效。

> 如果你不想让 CI 建库，也可以本地 `npx wrangler d1 create subdomain-hub-db` 后把真实 `database_id` 填进 `wrangler.toml`；此时 CI 检测到已填写就直接用，不会重复创建。

### 3. 本地命令行部署（不想用 Actions 时）

```bash
npx wrangler secret put CF_API_TOKEN
npx wrangler secret put CF_ZONE_ID
npm run db:init
npm run deploy
```

部署后访问分配的 `*.workers.dev` 域名，第一个注册的用户即管理员。
如需绑定自己的域名：Workers → Settings → Domains & Routes 添加自定义域，然后在 Cloudflare DNS 里给它加一条 CNAME（会自动创建）。

### 4. 常用运维命令

```bash
npm run dev          # 本地开发（会用 .dev.vars）
npm run tail         # 查看线上日志
npm run admin a@b.com        # 把某用户设为管理员
npm run admin a@b.com --unban  # 解封用户
```

手动 SQL（如重置某人为管理员）：

```bash
npx wrangler d1 execute subdomain-hub-db --remote \
  --command "UPDATE users SET role='admin' WHERE email='a@b.com'"
```

---

## 四、本地调试（不碰真实 DNS）

```bash
cp .dev.vars.example .dev.vars   # 里面 CF_MOCK=1
npx wrangler d1 execute subdomain-hub-db --local --file=./schema.sql
npm run dev
```

`CF_MOCK=1` 时所有 DNS 写操作只在内存里模拟（返回 `mock1001` 这类假 ID），可以完整跑通注册 → 申请 → 审核 → 加记录 → 验证解锁的全部流程而不会影响线上 Zone。
上线前把 `CF_MOCK` 设为 `0` 并填写真实 Token / Zone ID。

---

## 五、接口一览

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | 注册（首位用户自动 admin） |
| POST | `/api/auth/login` `/logout` | 登录 / 登出 |
| GET | `/api/auth/me` | 当前用户与已用配额 |
| POST | `/api/auth/password/send-code` | 给当前账号邮箱发修改密码验证码（登录态，60 秒节流） |
| POST | `/api/auth/password` | 校验邮箱验证码并写入新密码（不再要原密码） |
| GET | `/api/config` | 记录类型、TTL、验证预设（前端初始化） |
| GET | `/api/subdomains/check?label=` | 可用性检查 |
| GET/POST | `/api/subdomains` | 我的列表 / 申请 |
| GET/PATCH/DELETE | `/api/subdomains/:id` | 详情（含记录）/ 改备注 / 释放 |
| GET/POST | `/api/subdomains/:id/records` | 记录列表 / 添加 |
| PATCH/DELETE | `/api/records/:id` | 编辑 / 删除（锁定记录拒绝） |
| POST | `/api/subdomains/:id/verify` | 写入并锁定验证 TXT |
| POST | `/api/records/:id/verify-confirm` | **确认认证完成**（唯一解锁入口） |
| POST | `/api/records/:id/force-unlock` | 管理员强制解锁 |
| GET | `/api/soa` | 区域 SOA（只读） |
| GET | `/api/admin/stats` `/subdomains` `/users` `/locks` `/audit` | 后台数据 |
| POST | `/api/admin/subdomains/:id/approve\|reject\|suspend\|restore` | 审核操作 |
| POST | `/api/admin/users/:id/ban\|unban\|quota` | 封禁 / 解封 / 配额角色 |

---

## 六、安全设计

- 记录名强制拼接在用户自己的子域名之下，`host` 无论填什么都只会生成 `xxx.子域名.根域名`，**无法越权改到根域或他人子域**
- 所有写操作先落 Cloudflare 再落库；Cloudflare 失败则不写库，避免脏数据
- 会话 token 32 字节随机，HttpOnly + SameSite=Lax，改密后踢掉其它会话
- 单子域名最多 50 条记录，用户配额、保留字、标签格式均在前后端双重校验
- 关键操作（注册/登录/建删记录/审核/封禁/解锁）全部写入 `audit_log`
- 密码 PBKDF2-SHA256 60000 轮 + 16 字节随机盐

---

## 附录 · 功能与实现细节

> 以下按主题归档单项功能的实现细节与沿革，均为**当前有效配置**的补充说明。
> 部署与 Token 权限看「三、部署步骤」，功能总览看「一、核心特性」。

### 开发语言：全量 TypeScript + React

前后端与运维脚本**全部 TypeScript**，无存量 `.js` / `.mjs` / `.html`：

- 前端：React 18 + Vite，`src/app/pages/*.tsx` 共 14 个页面组件；全站只有一个
  SPA 壳由 `src/html/spa.ts` 导出，`npm run build` 前生成 `index.html`（不入库），再由 `src/app/main.tsx` 渲染。旧的 14 个静态 HTML 页面已删除。
- 后端：Hono on Workers，`src/**/*.ts`，Wrangler 内置 esbuild 直接打包。
- 页面壳与落地页：`src/html/*.ts` 导出模板字符串；`scripts/*.ts` 由 `tsx` 执行。
- 全局类型在 `src/types.d.ts`：`Env`（D1/R2/ASSETS/Secrets/Vars）、数据行类型、`SessionUser`。
- `tsconfig.json` 用 `moduleResolution: Bundler`、`jsx: react-jsx`、`allowJs: false`。

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build       # Vite → dist/client
npm run deploy      # build + wrangler deploy
```

**部署顺序**：CI 先 `npm install` → `npm run build`（Vite SPA **＋ VitePress 文档**）→ `wrangler deploy`。
文档源在 `docs-src/`，`vitepress build docs-src` 的产物由 `scripts/copy-docs.ts`
并入 `dist/client/docs/`；Worker 把 `/docs` 显式改写为 `/docs/index.html` 交给
ASSETS，`/docs/*` 的页面与图片原样回落，`/docs.html` 老书签 302 到 `/docs/`。
**`/docs` 不要再自己改写路径**：Cloudflare ASSETS 的 `html_handling` 会把
`/docs/index.html` 规范化 301 到 `/docs/`，而 `/docs/` 进 Worker 后尾斜杠被去掉又成
`/docs`；若 Worker 把 `/docs` 改写成 `/docs/index.html` 并把 3xx 直接交给浏览器，
就会形成 Safari 报的「太多重新导向」无限循环。现在统一经 `src/index.ts` 的
`docsAsset()` 在 Worker 内部跟随这些 3xx，只把最终 200/404 返回浏览器，并检测自指循环。
`docs-redirect-regression.ts` 专门守着这条（含病态 ASSETS 与反向对照）。

文档图片放在 `docs-src/img/`，中文页用 `./img/figN.png`、英文页用 `../img/figN.png` 相对引用，由 Vite 打包成带 hash 的静态资源。写成 `/img/...` 或 `/docs/img/...` 这类根绝对路径，会被 Vite 当成模块去 resolve 而直接构建失败。
文档为**中英双语各 8 页**，含 DNSHE 托管的 8 张截图；站点公告通过 VitePress 的
`layout-top` 插槽显示（纯文本、不解析 HTML），与站内其余页面同源。
仓库不提交 `package-lock.json`，所以 CI 用 `npm install`（不能用 `npm ci`），
`actions/setup-node` 也不启用 npm 缓存选项。

**域名详情页切换与重复记录**：顶部「切换域名」下拉会整页重载（fqdn / 概览 / DNS 记录 / NS 委派 / 展示设置一起更新，并保留当前标签页）；「自助验证」卡片里原来的局部「① 选择域名」下拉已移除，改成只读的「当前操作域名」——它以前只改验证写入目标却不切页，用户切到别的后缀后下方记录仍是旧的，再点「添加记录」又写回原域名，看起来像凭空多出重复记录。保存按钮加了点击即禁用的锁，后端对同名 / 同类型 / 同值记录幂等返回；同类型不同值（多个 AAAA）与不同主机名仍允许多条。`loadAll()` 的五个串行请求改并行，委派的两个接口也并行。

**暂停后缀：可申请处灰显、统计处照常可见、自动切主推**。`src/app/lib/applyPause.ts` 分两类列表：`availableRoots()` / `sortPreferred()` 供**可申请入口**使用（首页后缀卡片与查询下拉、WHOIS、落地页），剔除暂停项并把主推 `noxc.uk` 排第一；`rootsForPicker()` 供**注册页后缀选择器**使用，保留全部生效后缀，暂停项渲染成 `data-paused="1" + disabled`，CSS 灰显且 `pointer-events:none` —— **看得见、点不动**，而不是从菜单里删掉。首页**统计展开与「最热后缀 HOT」按真实数据全量展示**：暂停只影响新申请，不影响「已有多少已开通域名」，暂停行仅加一个灰色「暂停申请」标注。

默认值、URL `?root=` 自动切换与后台中途暂停的自动切换一律取 `preferredRoot()`（只认开放后缀）并 `replaceState` 改写 URL；后缀选择器在暂停态**永远可点**，不会「切过去就切不回来」，全部后缀暂停时保持提交硬锁。上一轮「提交注册硬锁」与后端 403 均保留。

**暂停后无法点击提交注册**：按后缀暂停时，注册页「提交注册」按钮是硬锁——`disabled` + `aria-disabled` + CSS `pointer-events:none` 兜底；点击入口、滑块验证回调、`doSubmit()`、待审核列表异步回来共四处复用 `src/app/lib/applyPause.ts` 的同一份判定，任何解锁都必须 `unlockApplyButton(el, allowed)`，`allowed=false` 绝不解锁（修掉旧 `onCapPass` 无条件 `btn.disabled=false` 冲掉暂停锁的真 bug）。验证弹窗暂停态不打开、已打开立即关闭；前端不区分管理员一律锁，后端 403 作最后一道，管理员自建仍豁免。WHOIS 结果也不再给「申请这个域名」入口。切回开放后缀自动解锁。

**按后缀单独暂停新申请**：后台「站点设置 → 按后缀单独暂停新申请」可只停某一个根域名，
其余后缀照常开放。只拦「新建子域名」这一个动作：首页卡片标「暂停申请」、注册页切到该后缀会锁定，
WHOIS 仍可查询；**已注册域名的 DNS 记录 / 续期 / 转移 / 展示 / 签到全部不受影响**，管理员仍可自建。
名单存 `settings.root_apply_paused`（逗号分隔），`applyGate()` 是全局与按后缀开关的唯一来源；
环境变量 `ROOT_APPLY_PAUSED` 可强制暂停且后台不可取消。与「按根域名每人注册次数」是两个独立维度。

**首页公开统计**：`/api/config` 与 `/api/stats` 同源，除注册人数、已开通域名两个总数外，
还下发 `publicStats.roots`（按根域名拆分的「已开通域名数 / 去重注册人数」，
含当前为 0 的生效后缀）与 `publicStats.hottest`（已开通最多的后缀）。
首页点「已开通域名」可展开清单，最热后缀在后缀卡片与统计条旁标 **HOT**；
全部为 0 时不标。展开表头与空态由 `startI18n()` 补挂，英文模式不会冒中文。

**SPA 路由**：站内链接为 `/dashboard`、`/register` 这类干净路径；`App.tsx` 仍保留
`/xxx.html` 别名，老书签与 `whois.` 子域的服务端重定向继续可用。
Worker 的 `SPA_PATHS` 把这些路径统一回落到 SPA 外壳，由 React 接管；清单由
`src/lib/spaRoutes.ts` 的 `SPA_PAGE_NAMES` **唯一生成**，新增页面只改这一处。

以前这里和 `App.tsx` 的 `ROUTES` 是两份手写清单，`/report`、`/abuse` 只加在前端、
漏了 Worker 侧：站内点击由 React 接管所以正常，但**直接打开 / 刷新 / 从根域名
落地页外链跳过去**会被 ASSETS 当成不存在的静态文件返回 404 空 body，整页白屏。
`spa-routes-regression.ts` 会逐个核对前端路由都被清单覆盖，并真跑 Hono 验证
`/report`、`/report.html`、`/abuse`、`/report?domain=…` 都回落到 `index.html`，
同时确认未知路径与静态资源仍原样交给 ASSETS、`/docs` 仍由模板直出。


---

### 多个根域名

一个站点可以同时分发多个根域名下的子域名（如 `meoy.top` 与 `foo.com`）。

**配置**（仓库 Settings → Variables，或 `wrangler.toml` 的 `[vars]`）：

| 变量 | 示例 | 说明 |
|---|---|---|
| `ROOT_DOMAINS` | `meoy.top,foo.com` | 允许的根域名列表，逗号分隔 |
| `CF_ZONE_IDS` | `meoy.top:aaa...,foo.com:bbb...` | 每个根域名对应的 Zone ID |
| `ROOT_DOMAIN` | `meoy.top` | 默认根域名（向后兼容，必须保留） |
| `CF_ZONE_ID` | `aaa...` | 默认 Zone（向后兼容） |

**向后兼容**：只填 `ROOT_DOMAIN` / `CF_ZONE_ID` 时，行为与单根域名完全一致。

**配额口径**：跨根域名**共享**。配额 5 就是总共 5 个，不按根域名分别计算 —— 避免通过多根域名绕过限制。

**使用**：控制台申请框在配置了多个根域名时会自动把静态后缀换成下拉选择，切换后实时重新查询可用性。

**数据结构**：`subdomains` 表新增 `root_domain` 列，同时**去掉了 `label` 的 UNIQUE 约束** ——
否则 `mail.meoy.top` 与 `mail.foo.com` 会互斥。唯一性改由 `fqdn` 承担（fqdn 已包含根域名）。
迁移在 `schema.sql` 里自动完成，`root_domain` 由 `fqdn` 反推，可重复执行。
旧表会保留为 `subdomains_old_mr`，确认无误后可自行删除。


---

> **界面章节说明**：现行视觉以「一、核心特性 → 6. 界面风格」为准（Zerexa、
> 4 层 CSS、纯黑白灰、Redaction 35）。随后数节记录的是沿革：CYBER/TERMINAL 霓虹、
> v2「Nyan」蓝粉毛玻璃、蓝色后台面板骨架三套配色均已废弃，绿色毛玻璃元素已移除；
> **仍生效**的只有双皮肤令牌切换、云层背景、壁纸和内置头像库。

### 主题：浅色 / 深色双皮肤

顶栏右侧有切换按钮（月亮 ⇄ 太阳），**全站通用**。

| 皮肤 | 参考 |
|---|---|
| 浅色（默认） | 纯白底 + 墨黑文字，冷灰发丝线 |
| 深色 | 墨黑底 + 浅墨文字，同一套令牌反相 |

**实现**：只切 `documentElement[data-theme]`，颜色全部由 CSS 令牌接管，
组件样式不写死颜色 —— 因此两套皮肤共用同一套结构，新增页面自动支持。

**记忆**：选择存 `localStorage.meoy_theme`；未手动选过则跟随系统
`prefers-color-scheme`，系统切换时实时响应。

**防闪屏**：每个页面 `<head>` 里有一段同步脚本，在渲染前就把 `data-theme`
写好，避免深色模式刷新时先白一下。


---

### 天空蓝云层背景（Cloud Shader）

落地页 Hero 用了 WebGL 云层着色器（`src/app/lib/cloudShader.ts`，纯原生无依赖，由 `App.tsx` 按需动态挂载）。

> **历史记录**：早期是原生 HTML/CSS/JS，现已迁移到 React + TypeScript；
> 「手写着色器」的结论保留，但「无 React」的前提已不成立。

早期同名 `.sidebar` 被定义 16 次、两套手写 CSS 叠加，现已收敛为 4 层
（`shell.css` 结构层 + `captcha.css` / `oauth.css` 组件层 + `design-system.css` 唯一视觉源），
颜色全量令牌化，主题令牌由 `vite.config.ts` 内联配置映射，深色跟随 `data-theme`。
详见「一、核心特性 → 6. 界面风格」。

第三方云层组件当年因 registry 被网络策略挡住、且需要 React + Tailwind 运行时而未采用，
改为自绘 WebGL 体积云（FBM 噪声 + 时间动画，深浅主题各一套配色）。

**在任意页面启用**：加一个容器即可

```html
<div class="cloud-bg" data-cloud-speed="0.9"></div>
```

**特性**：无 WebGL 自动降级为 CSS 天空渐变（`.cloud-fallback`）；
标签切到后台暂停渲染；`prefers-reduced-motion` 下只画静态一帧；
DPR 上限 1.75 以照顾移动端性能；主题切换后自动重取配色。

### 壁纸

切换器里有 4 张：樱花喵 1/2、Miku、GUMI。想换回 Miku 主题直接选即可，
壁纸与深/浅主题互相独立。


---

### 界面骨架（参照后台面板模板）· 已废弃

控制台骨架按后台面板模板重做：

- **侧栏** 204px，白底；顶部品牌头，导航按「控制台 / 资源管理 / 用户中心 / 系统」分组；
  图标为线性风格（stroke 1.8），激活项实心主色 + 彩色投影
- **顶栏** 54px：面包屑（首页 / 当前页）+ 搜索框（Ctrl+K 聚焦域名输入）+ 通知铃铛（带未读数）+ 头像
- **内容区** 卡片圆角 16px + 柔和阴影；表格表头浅蓝底
- **新增组件** 分组标题、公告条、提示条（info/blue/red/warn）、开关、筛选胶囊、
  分段器、步骤条、空状态、底部页脚（此处「公告条」是旧皮肤卡片组件；现行全站
  公告条为 `.site-announcement`，见「站点品牌」一节）
- **个人资料页** 封面 + 浮起大头像 + 标签 + 签名 + 信息行

配色改为模板蓝：`--primary: #3b82f6`、`--background: #f3f7fd`、`--radius: 16px`，
全部走 CSS 令牌，深色主题自动适配。

公告条内容可在后台「站点设置 → 公告」配置，留空则不显示。


---

### v2「Nyan」皮肤 · 已废弃

控制台采用蓝粉渐变 + 毛玻璃 + 二次元猫娘风格的 v2 皮肤。

- **背景**：粉蓝径向渐变 + 等高线 SVG 纹理 + 5 处闪光装饰
- **侧栏** 224px 毛玻璃；品牌名渐变文字；分组标题带渐变圆点；激活项蓝渐变 + 彩色投影
- **顶栏** 64px 毛玻璃；面包屑 + 搜索 + 图标按钮 + **内置角色头像**（默认初音未来 Q版，与个人资料页同源）
- **卡片** 白色毛玻璃 + 2px 白边；**统计卡** 四色实心渐变
- **按钮** 胶囊形（圆角 30px）+ 渐变
- **表格** 行间距 8px + 圆角行；**筛选胶囊** 圆角 30px
- **吉祥物** 右下角猫娘（自绘 SVG），点击会冒对话气泡

配色变量：`--blue #4f9bff`、`--pink #ff8fbf`、`--lav #b6a6ff`、
`--glass rgba(255,255,255,.82)`、`--radius 22px`、`--shadow`。
深色主题下玻璃转暗、渐变降饱和。


---

### 注册域名独立页

申请入口已独立为 `/register.html`（侧栏「控制台 → 注册域名」）：

- 输入前缀后**自动检查可用性**，实时显示积分消耗（默认普通 60 分 / 单字 300 分，随后台设置变）
- 多根域名时后缀为下拉选择
- 已有待审核申请时提交按钮锁定（同一时间只能有一个）
- 支持 `/register.html?label=xxx` 从落地页 / WHOIS 页带名称跳入
- 底部「注册须知」含命名规则、积分配额、有效期与续期说明；积分与有效期两组数字都由 `/api/config` 实时填充，后台改设置后无需重新部署

`/dashboard.html` 的申请表单已移除，改为引导卡；带 `?apply=`/`?label=` 访问时自动跳转注册页。

### 内置角色头像库

20 张，按角色分组，在「个人资料 → 选择头像」里可切换筛选：

| 分组 | 数量 | 角色 |
|---|---|---|
| Miku | 5 | 初音未来（Q版 / 剪影 / 徽章 / 趴趴 / 双马尾） |
| GUMI | 3 | GUMI（14周年 / Q版 / V4） |
| VOCALOID | 4 | 镜音铃、镜音连、巡音流歌 ×2 |
| Ave Mujica | 8 | 三角初音、丰川祥子 ×2、若叶睦 ×3、祐天寺若麦 ×2 |

- 清单：`src/lib/avatars.ts`（后端白名单）/ `src/lib/avatars.json`
- 图片：`public/img/avatar/*.webp`，256×256，共约 220 KB
- 默认头像 `/img/avatar/miku-headset.webp`；顶栏、资料卡、下拉菜单共用同一地址
- 图片加载失败会回落旧版自绘猫脸 SVG（`_default.svg` 等仍保留）
- 老用户资料里保存的 `_default.svg` 会在读写时自动归一化为新默认图

> 这些是网络检索到的角色图片，仅供站内头像用途；**公开商用请替换为已授权素材**。

### 自定义头像上传（绑定即启用）

`scripts/ensure-r2.ts` 会寻找/创建桶并**自动写入 `[[r2_buckets]]` 绑定**；
只要绑定存在，`/api/config` 就返回 `avatarUpload: true`，前端显示上传按钮，
**不再需要 `AVATAR_ENABLED=1` 这类手工开关**。
桶创建失败（Token 缺 R2 权限）时脚本移除绑定并降级，不阻断部署 —— 排查见「速览 → 3」。
未启用时用户仍可用内置头像库或填写外链头像。


---

### 站内通知（铃铛）

顶栏铃铛展示两类通知，点击展开下拉面板：

- **域名审核** —— 申请被批准 / 被驳回 / 被停用，均通知申请人并说明原因
- **安全提醒** —— 账号在**新 IP** 登录时提醒（同一 IP 不重复刷屏）

表：`notifications`。接口：`GET /api/notifications`、`/unread`、`POST /read`、`/read-all`、`DELETE /:id`。

### 邮箱验证码（Resend / Brevo）

后台 → 站点设置 → **邮件服务与验证码**：

| 项 | 说明 |
|---|---|
| 服务商 | `resend` 或 `brevo` |
| 发件人 | 建议 `verify@你的域名`（需先在服务商完成域名验证） |
| API Key | 只存数据库，后台只回显掩码 |
| 注册需要验证码 | 开关，默认关闭 |

用途：
- **忘记密码** —— 登录页「忘记密码？」用验证码重置，重置后踢掉所有会话
- **修改密码** —— 已登录用户在「个人资料 → 安全设置」或控制台点「修改密码」，
  向**当前账号邮箱**发码（`password_change` 场景），确认后写入新密码并踢掉其它会话
- **注册** —— 开启后注册需先验证邮箱
- **更换邮箱** —— 个人资料里向**新邮箱**发码（`email_change` 场景），确认后写回账号

四个场景互相隔离，共用同一套 `email_verifications` 表，码不能跨场景套用。
**发码地址从会话里的 `u.email` 取，绝不信任前端传参**；公开的 `/api/auth/verify/send`
只接受 `register` / `reset`，避免未登录者拿任意地址触发邮件。NodeLoc 占位邮箱与
`.local` / `.test` 等保留 TLD 会明确提示「先更换邮箱」，不假装发送成功。

验证码 6 位、10 分钟有效、错误 5 次作废、**只存哈希不存明文**。
未配置邮件服务时接口返回 503 并提示联系管理员，绝不假装发送成功。

### R2 头像公网地址

后台 → 站点设置 → **R2 头像公网地址**。留空则头像走 `/api/avatar/<key>` 由 Worker 代理读取
（桶无需开启公开访问）。填写后头像直接外链，省 Worker 流量。
绑定与降级行为见上一节。

---

### Spaceship 域名注册商（自动发现根域名）

后台 → 站点设置 → **Spaceship 域名注册商**，填入后即可自动发现账号下的域名：

| 项 | 说明 |
|---|---|
| API 地址 | 默认 `https://spaceship.dev/api`，可改成代理地址 |
| API Key | Spaceship → API Manager 创建，需 **domains 读取权限** |
| API Secret | 同上 |

流程：**保存 → 测试连接 → 拉取我的域名 → 弹窗列出账号下全部域名 → 勾选要添加的 → 添加选中**。
拉取是只读的，**不注册、不续费、不改 NS**，避免误触资金操作。

配置也可用环境变量覆盖（优先级更高）：
`SPACESHIP_API_URL` / `SPACESHIP_API_KEY` / `SPACESHIP_API_SECRET`。
Key 与 Secret 只存服务端，后台只回显掩码。

添加后的根域名存进 `settings` 表的 `root_domains_extra` / `cf_zone_ids_extra`，
每个请求由中间件合并进 `ROOT_DOMAINS` / `CF_ZONE_IDS`，因此**无需改环境变量、无需重新部署**。
接口：

```
POST /api/admin/spaceship/test     测试连通性
GET  /api/admin/spaceship/domains 拉取域名（标注已添加 / Zone 状态）
POST /api/admin/spaceship/add     勾选添加（可附带 Cloudflare Zone ID）
DELETE /api/admin/spaceship/roots/:domain  移除动态根域名
GET  /api/admin/roots             当前全部根域名（含来源）
```

> 官方规范：`GET /v1/domains?take=100&skip=0`，Header `X-Api-Key` + `X-Api-Secret`，
> 响应 `{ items, total }`。列表限流 300 次 / 300 秒，`take` 最大 100，本项目自动翻页（最多 5 页）。
> 若新域名要用 Cloudflare 做 DNS 解析，需把该域名 NS 指向 Cloudflare 并填写对应 Zone ID。


---

### AI 自动审核 + 按根域名的 DNS 限额

后台 → **站点设置 → AI 自动审核**（`src/lib/aiReview.ts`）。

| 配置 | 默认值 | 说明 |
|---|---|---|
| 启用自动审核 | 开 | 关掉后所有申请回到人工审核 |
| 接口地址 | `https://apihub.agnes-ai.com/v1` | 任何 OpenAI 兼容网关 |
| 模型 | 留空 | 自动探测 `/models` 取第一个，失败回落 `gpt-4o-mini` |
| 自动审核的根域名 | `v-1.top` | 逗号分隔；只对这些后缀生效 |
| 不限 DNS 记录数的根域名 | `v-1.top` | 逗号分隔；豁免「单域名最多 50 条」 |
| API Key | 空 | **只存数据库或 Worker Secret，绝不写进代码库** |

配置 Key 两种方式（二选一）：

```bash
# 方式 A：Worker Secret（推荐，后台只读不改）
npx wrangler secret put AI_API_KEY
```

方式 B：后台设置页直接粘贴。后台 GET 只回 `keySet` + `keyMasked`（尾 4 位），
公开的 `/api/config` 只返回两份根域名名单，不含地址与密钥。

**审核流程**：申请落在名单内的根域名 → 把「域名 + 用途说明」发给模型，
要求只输出 `{"approve":true/false,"reason":"..."}` → 通过则直接 `approved`
（`reviewed_at` 写入、审计日志记录 AI 结论）；驳回则 `rejected` 且不扣积分，
前端保留输入让用户改写用途说明重新提交。

**失败即降级**：没配 Key、8 秒超时、模型报错、返回无法解析 —— 一律回落为
`pending` 人工审核，不会卡住申请，也不会因为 AI 故障误批准。

**根域名归属**：域名列表的「根域名」列取库里的 `root_domain`，缺失时从
`fqdn` 去掉首段反推（`lol.v-1.top` → `v-1.top`），不再写死默认根域名。


---

### 中英文切换（全站）

`src/app/lib/i18n.ts`。顶栏有 **中 / EN** 切换器，控制台、落地页、登录页三种
顶栏都会自动注入；也可按 `Alt + L` 快速切换。

**为什么是运行时 DOM 翻译**：项目里有 14 个 React 页面加上一批用
`innerHTML` 动态渲染的 legacy 控制器。逐个组件改 `t()` 会漏掉异步表格、
弹窗、Toast 和后端返回的中文提示。现在在 DOM 层统一拦截：

- `translateText()` 纯函数：精确短语匹配 → 带数字句式（正则）→ 长键优先子串替换
- 340 条词典覆盖导航、表单、表格、状态、按钮、落地页与登录页
- `MutationObserver` 监听 `childList` / `characterData`：异步表格、Toast、
  SPA 切页后的新节点自动翻译
- 原文按 `WeakMap<Text, string>` 保存，切回中文是精确还原，不靠反向字典
- 邮箱、URL、纯域名、代码块、`<kbd>`、`data-no-i18n` 区域一律跳过

**默认中文**：不会跟随浏览器语言自动变英文，只有用户点过切换才生效；
选择存 `localStorage.terradata_lang`，`<html lang>` / `data-lang` 由
`src/html/spa.ts` 里的同步预置脚本预置，刷新不闪。

### 登录页与落地页版式

- 登录页改为「左侧品牌陈述 + 右侧表单卡片」，移除原先右侧四块堆砌的说明模块，
  顶栏也不再放壁纸切换器；登录 / 注册 / 找回密码三个面板的全部 DOM id 保留
- 落地页 Hero 移除 Miku 插画（`public/img/neko.jpg`、`neko.svg` 已删除），
  改为纯文字标题 + 细线指标条；`nk-hero-in` 收成单列
- 落地页进一步改为 Zerexa Domains 风格：超大标题、整行搜索框（前缀 + 根域名
  下拉 + 查询按钮）、三个胶囊入口、四张指标卡；搜索按所选后缀查询

### 注册页四步向导与后缀选择器

`/register` 参考 DnsNeko 改为四步：使用须知 → 选择域名 → 确认信息 → 提交注册。
后缀按钮**嵌在同一个输入框里**，点开浮层按「`.后缀` … `Free`」列出全部根域名。

- 深色模式下浮层曾有白块：`.root-opt` 是 `<button>` 却没显式背景，落到浏览器
  默认 `buttonface`。现在深浅两套都写死实心背景，并给浮层加层级与锚点
- `data-no-i18n` 标在选择器上：域名字符串不参与翻译，避免任何动态文本被回退
- 支持 `/register?label=foo&root=v-1.top`，从 WHOIS / 落地页跳转时保持后缀选中

### WHOIS 查询其它根域名

WHOIS 页与落地页搜索框都加了根域名下拉。只写前缀时按选中的根域名拼成完整
FQDN 再查；输入完整域名仍走外部 WHOIS / RDAP。

### AI 自动审核诊断

`aiReview()` 现在：12 秒超时、`/models` 探测失败时逐个回退候选模型、
`max_tokens` 被网关拒绝时自动去掉参数重试、兼容 `approved` / `pass` / 纯文本等
返回格式。后台 → 站点设置新增 **测试 AI 连接**，会真实调用一次并回报模型名、
延迟与具体失败点（不回传密钥）。`/api/config` 增加 `aiStatus`（只给标志位）；
申请结果增加 `aiSkip`，用于区分「管理员免审核」「全局免审核」「AI 不可用」。
管理员账号本身免审核，**不会触发 AI**，这是设计行为，后台自检按钮可用于验证配置

---

## 附录 Z · 故障排查与已知错误（固定放在文末）

> **编排约定**：本 README 的所有错误、故障复盘、限制与排查步骤**只写在这一章**。
> 正文各章节只描述能力与配置；以后新增故障记录一律追加到文末，不要插回中间，
> 避免同一问题在「速览 / 部署 / 核心特性」里出现互相矛盾的多个版本。

### Z.1 D1 读取额度被打满导致站点 500（2026-11-23）

**现象**：Cloudflare D1 免费版每日 **5M rows read** 被打满，站点一段时间内返回
内部服务器错误；在后台看指标时「读取的列」仍在持续上涨（连续输入时一次涨几千）。

**根因（多个放大器叠在一起）**

1. `/api/config` 是**每个页面挂载、每次切页**都要请求的公开接口；`loadBranding()`
   又是 stale-while-revalidate，缓存命中仍在后台再发一次。
2. 一次 `/api/config` 内部要跑十几个 `settings` 单点 `SELECT`，外加
   `publicStats()` 的 `SELECT COUNT(*) FROM users`、`COUNT(*) FROM subdomains`、
   以及按根域名拆分的 `GROUP BY` —— 后者**全表扫描 subdomains**，
   N 个已开通域名就是 N rows read。
3. `publicStats()` 旧版只有 **30 秒 isolate 内缓存**：Cloudflare 每次请求可能落到
   不同 isolate，每个 isolate 过期后都各自扫一次全表；几千域名时每几十秒就吃掉
   几千读取。注册页输入框 350ms 防抖也会在连续打字时打出十几次
   `/api/subdomains/check`（每次内部多点查库），是另一个放大器。

**已上线的修复**

| 层 | 做法 |
|---|---|
| 公开统计 | 聚合结果写进 `settings` 表一行 JSON 快照，**读取只花 1 row read**；10 分钟才重算一次，多个 isolate 共享同一行；域名开通 / 审核 / 删除 / 新用户注册由全局 middleware 主动失效 |
| `/api/config` | 整响应 isolate 缓存 30 秒 + `Cache-Control: private, max-age=30` 浏览器缓存；后台保存后前端带 `?_=<ts>` 绕过两层缓存，保证「保存即生效」 |
| 前端 SWR | `loadBranding()` 后台刷新节流到 60 秒一次，切页不再重复打接口 |
| 注册页输入 | 600ms 防抖 + 同值 15 秒结果缓存 + 过期响应序号丢弃，连续打字最多一两次请求 |
| 写操作 | 全局 middleware 在任何非 GET 成功后统一失效 config 缓存，一处覆盖全部写路径 |
| `/api/external-domains` | 即将上线：所有方法返回 503 + comingSoon，暂不可用 |
| `/api/stats` | 加 `Cache-Control: public, max-age=60`，第三方页面拉取不再重复打库 |

**可调参数**：`PUBLIC_STATS_TTL`（秒，默认 600，最小 30）。调大更省读取，
数字刷新更慢；写路径会主动失效，正常开通 / 审核仍是即时的。

**排查顺序**：先看 Cloudflare D1 指标里「读取的列」曲线是否随页面切动阶梯上涨 →
检查 `/api/config` 响应是否带 `Cache-Control: private` → 查 `settings` 表里
`public_stats_snapshot` 是否存在且 `at` 在有效期内 → 最后看是否有新写的页面
绕开缓存直连 `/api/config` 或在轮询里反复打接口。

**第二轮（同日，指标仍到 1.52M/5M 时继续）**：第一轮只压住了 `/api/config`
与统计，漏的是**中间件层**。原来 4 个 `app.use('*')` 对**每一个请求**生效，
包括 `/assets/*.js`、`/img/*`、`/docs/*`；`mergeRootEnv` 每请求跑 4 次
`settings` 单点查询，带 Cookie 时 `attachUser` 再跑一次 `sessions JOIN`。
静态资源恰恰是请求量最大的那一类，一个页面加载十几个资源就是几十次 D1 读取。
另外 `buildConfigData` 内部散着十几个单点 `SELECT`，`ensureCoreColumns` 每遇到
新 isolate 冷启动还要跑一次 `PRAGMA` + **全表 `UPDATE` 回填**。

| 层 | 第二轮做法 |
|---|---|
| 请求引导 | 4 个中间件收成唯一 `middleware/bootstrap.ts`；`isStaticAsset()` 命中即整段跳过，静态资源 **0 次 D1**；`/api/health`、`/api/config`、`/api/stats`、头像等纯公开接口不查登录态 |
| 配置读取 | 唯一 `settingsCache.ts`：一次 `SELECT key, value FROM settings` 拿全表，按 D1 binding 做 30 秒 isolate 缓存；11 个模块的逐 key 查询全部改走它。`Promise.all` 并发读取加 in-flight 去重，4 个并发只查 1 次，不击穿 |
| 写操作 | 全局 middleware 同时失效 config 与 settings 缓存；`?_=` 请求强制 fresh，跨 isolate 也不会卡住「保存即生效」 |
| 凭据 | OAuth secret / 邮件 key 走 `readSettingFresh` 直查 D1，不受 30 秒缓存影响，管理员改密钥立即生效 |
| 运行时补列 | `runtimeMigrations.ts` 用 `settings.runtime_migrations_v3` 一行 marker 做**跨 isolate** 幂等；新 isolate 冷启动只读 1 行，不再每 isolate 跑 PRAGMA / CREATE TABLE。`root_domain` 全表回填只在真的补出新列的老库执行，正常库 0 次 |

量化（专项回归 `scripts/d1-read-phase2-regression.ts` 真跑内存 D1 计数）：
6 个带 Cookie 的静态资源请求 **0 次 D1**（旧写法 ≥24 次）；稳态首个页面请求
**2 次**（marker 1 行 + 配置全表 1 次），之后 3 个页面请求 **0 次**；
10 次单点 + 1 次批量读取命中缓存 **0 次**；冷缓存下 4 个并发读取 **1 次**全表。

**第二轮排查顺序**：D1 指标若仍随静态资源加载阶梯上涨 → 查
`src/middleware/bootstrap.ts` 的 `isStaticAsset()` 是否覆盖了新加的资源前缀 →
查是否又有模块直接写 `SELECT value FROM settings WHERE key = ?`（应走
`readSetting`）→ 查写操作后 `invalidateSettings()` 是否被调用 → 最后看
`runtime_migrations_v3` marker 是否存在（不存在会每次冷启动补列）。

### Z.2 KV / R2 没有自动绑定

CI 会尝试自动创建并绑定 Workers KV（`KV`）与 R2（`AVATARS`）。绑定成功会写进
**Job Summary**，站点 `/api/config` 的 `kvBound` / `avatarUpload` 也能查。

若 Summary 显示「未自动绑定」、或这两个布尔值都是 `false`，原因基本都是
**API Token 对这两个资源没有权限**：Cloudflare 对「token 有效但越权」也返回
`Authentication error (code 10000)`，所以部署与 D1 仍然成功，只有 KV / R2 的
接口被拒。脚本为保证部署不中断会移除绑定并降级 —— **步骤是绿的，但绑定确实没挂上**，
这也是最容易误判的地方。

推荐修法（一次配置，之后全自动；新部署直接用「三、部署步骤 → 1」的
**一键创建**链接，7 项权限已预填，不必逐条勾）：

1. Cloudflare Dashboard → My Profile → API Tokens → 编辑部署用的 Token；
2. Permissions 增加两项：`Account → Workers KV Storage → Edit`、`Account → R2 → Edit`
   （保留原有的 Workers Scripts / D1 / DNS 权限）；
3. 重新跑一次 Actions，脚本会自动创建 `noxc-kv` namespace 与 `meoy-avatars` 桶。

不想动 Token，也可以在控制台手动创建后填仓库 Variables 绕过 API：

| 资源 | 控制台操作 | Variables |
|---|---|---|
| KV | 建 namespace `noxc-kv`，复制 id | `KV_NAMESPACE_ID=<id>`（脚本直接写绑定，不调 API） |
| R2 | 建桶 `meoy-avatars` | `R2_BUCKET_NAME=meoy-avatars` + `R2_ASSUME_EXISTS=1` |

> CI 对 `wrangler.toml` 的绑定修改只在本次部署生效，**不会提交回仓库**。
> 请以 Job Summary 和 `/api/config` 为准。

### Z.3 Safari 报「太多重新导向」

`/docs` 曾被改写成 `/docs/index.html`，ASSETS 规范化又 301 回 `/docs/`，
形成自指循环。现在 Worker 内部跟随这些 3xx，只把最终 200/404 交给浏览器，
并带自指检测。旧书签 `/docs/dnshe` 零重定向直达。

### Z.4 已知限制

- **SOA**：Cloudflare 不允许通过 API 增删改区域 SOA，页面只提供查看；如需自定义需走 Cloudflare 工单
- **PTR**：只有在 Cloudflare 托管反向区域（in-addr.arpa）时才真正生效，正向域中创建仅作占位
- **NS**：Cloudflare 区域的根域 NS 不可修改，但子域委派（如 `sub.xxx.meoy.top` 的 NS）可以正常添加
- TXT 单条最长 2048 字符（Cloudflare 限制），超出需分段
- **外部域名**：DNS 记录写在用户自己的 Cloudflare / DNSHE zone，本站只代调用 API，
  不托管、不写本站解析；每账号最多 5 个，API key 不落库
- Redaction 35 等外部字体异步加载，访问环境拉不到时回退系统字体

### Z.5 外部域名：加了 TXT、也写了记录，但解析不生效

> 状态说明：第三方域名接入当前为「**即将上线**」，接口统一返回 503，以下内容是
> **开放后**的排错参考，不是现在能在站点上触发的问题。实现代码完整保留待启用。

**现象**：第三方域名接入里 TXT 验证通过了、也用 API key 成功写入 A / CNAME 记录，
但 `dig` 或浏览器访问还是旧的 IP / 完全不解析。

**根因**：TXT 只是**所有权证明**。DNS 记录真正生效的前提是父区域把域名委派给
那家供应商 —— 也就是在**域名注册商**把 NS 改成供应商分配的两台主机名。
Cloudflare 会分配 `xxx.ns.cloudflare.com` / `yyy.ns.cloudflare.com`，
在 zone 状态变成 **Active** 之前写入的记录不会被全球 DNS 查询；
DNSHE 同理要等委派检查通过。改 NS 前还常要先在注册商**关掉 DNSSEC**，
否则切换期间域名可能整体不可达。（Cloudflare 官方文档：Full zone setup / Change nameservers）

**排查顺序**

1. 接口返回的 `ns` / `nsWarning` 有没有照抄到注册商，是否两台都填、用的是主机名不是 IP
2. Cloudflare 面板 zone 是否 Active（Pending Nameserver Update 就是还没改对）
3. 用 `dig NS example.com @1.1.1.1` 看权威 NS 是不是供应商那两台
4. 注册商是否还开着 DNSSEC（有就先关，激活后再在新供应商侧重开）
5. 旧 DNS 服务商里的记录改了没用 —— 它已经不是权威了，要去**当前委派指向的那家**改

**另一个易混点**：本站 API key 不落库，所以每次「连接供应商」「添加记录」都要重新填。
若 Cloudflare 报 Token 权限错误，检查 Token 是否含 `Zone Read + DNS Write`；
若 DNSHE 记录接口返回 4xx/5xx，接口会明确提示到 `my.dnshe.org` 面板手动添加，
不会假装写入成功。

### Z.6 数据备份 / 汇入的常见错误

> 按「错误只放文末」的约定，备份功能的限制与排查集中在这里，正文只描述能力。

- **`汇入失败：缺少必需列 fqdn / email`**：拿错了文件类型。用户 CSV 必需列是 `email`，
  子域名 CSV 是 `fqdn`，站点设置是带 `format: noxc-settings-backup` 的 JSON。
  在「数据类型」里手动指定即可，别依赖自动识别。
- **子域名大量跳过「找不到所属用户」**：汇入顺序错了。**先汇入用户 CSV，再汇入子域名 CSV**；
  跨库时靠 `owner_email` 映射，原 `id` 变了也能对上。
- **`replace` 后密码没变回备份里的旧值**：这是刻意设计。覆盖模式只恢复状态 / 配额 /
  有效期等字段，**密码哈希与角色永不覆盖**，避免把当前管理员账号冲掉。
- **JSON 里某些 API key 是空的**：区分两种情况。① 默认导出已是完整备份，不该出现空凭据；
  若仍看到空值，看 JSON 的 `emptyKeys` —— 那是**库里本来就没配置**，不是导出丢值，
  去后台把对应服务填上即可。② 只有勾选了「生成脱敏副本」（`maskSecrets=1`）才会把
  凭据置空，这种文件**不能用于完整恢复**；里面的空密钥汇入时会被主动跳过，
  不会把当前正在用的密钥清成空串。
- **`文件超过 2MB 上限` / `行数超过上限`**：拆成多份分别汇入；或只导出需要的类型。
- **CSV 单元格在 Excel 里显示成公式 / 少了负号**：导出时对 `= + - @` 开头的单元格做了
  防公式注入处理（前置单引号），汇入端会精确还原；请用本站的汇入功能，不要手改后另存。
- **汇入后首页统计数字没变**：用户 / 子域名汇入会主动失效公开统计快照；若仍滞后，
  稍等快照周期或做一次域名写操作触发失效。配置类汇入由写操作中间件统一失效缓存，
  前台最多滞后 30 秒，后台保存也可强制刷新。

### Z.7 界面风格与形态层的常见错误

> 按「错误只放文末」的约定，风格改造的限制与排查集中在这里，正文只描述能力。

- **颜色被改了 / 明暗主题不对**：形态层按约定**不定义任何色值**，颜色只来自
  `design-system.css` 的 `--zx-*`。若发现色值异常，先查有没有别的 CSS 重定义了
  `--zx-paper` / `--zx-blue` 等令牌；`scripts/nodeloc-skin-regression.ts` 会扫描形态层，
  出现 `#hex` / `rgb()` / `hsl()` 字面量或重定义颜色令牌即判失败。
- **想回到旧版胶囊按钮 / 超粗标题**：删掉 `src/app/main.tsx` 最后一行
  `import './styles/nodeloc-skin.css'`，重新构建即可；历史层样式一行未删。
  **注意**：首屏的左右分栏与查询卡是 `Home.tsx` 的 DOM 结构，不是纯 CSS 皮肤；
  要完全回到旧的单列查询条，需要同时还原该文件的 Hero 区块。
- **为什么没有深色星空 / 青绿强调色**：用户明确要求「颜色保持现在的」。
  抄的是结构（左标题、右卡、卡内顺序、悬浮开关）与 NodeLoc 3.0 的全圆角语言，
  不抄深色背景与品牌色，颜色令牌一个没动；
  明/暗主题仍走 `--zx-*` 现行色板。
- **示例域名后缀显示不对**：卡片里的 `.noxc.uk` 由 `qRoot` 下拉自动同步；
  若后台根域名列表还没返回（首帧），会先显示占位，列表落地后自动更新。
- **暂停动效后某个元素位置歪了 / 内容看不见**：形态层刻意不清全局 `transform`，
  并给 `.rv-reveal` 补了 `opacity:1` 兜底。若仍有异常，多半是第三方样式用了
  `transform` 做定位，把该元素加进 `html[data-motion="paused"]` 的兜底清单。
- **点「Try: hello-world」没反应 / 没有发起查询**：这是设计如此 —— 示例只填输入框并聚焦，
  要查可用性得自己点「查询」。这样是为了不增加 D1 读取次数。
- **手机端看不到「暂停动效」按钮**：窄屏会收起该按钮，但系统
  `prefers-reduced-motion` 仍自动降级；在宽屏或用桌面浏览器可手动切换。
- **新加的页面没跟上新形态**：形态层主要靠 `--radius` / `--rv-r` / `--zx-mono`
  等变量全局生效；若某组件硬编码了 `border-radius: 999px`，在形态层补一条覆盖即可，
  别去改 `shell.css` 的历史层。

### Z.8 NodeLoc 3.0 全圆角改版的常见错误

- **「全都做成圆角」却留了直角**：`shell.css` 历史层有 15 处 `border-radius: 0 !important`，
  只靠形态层覆盖会跨层互压。本版在源头全部改成 `var(--nl-r-sm)`，形态层只做统一收口。
  回归会扫描 4 层 CSS，出现 `border-radius: 0 !important` 即失败。
- **拼接直角**：首页查询条原来把输入框的右圆角、后缀选择器的左圆角都设成 0 来拼成一条。
  现在合成一条完整胶囊（`999px 0 0 999px` / `0 999px 999px 0`），不要再改回 0。
- **骨架漏圆角**：`topbar` / `sidebar` / `side-in` 若写成 `0 0 24px 24px`，左上角仍是直角。
  本版四角统一 `var(--nl-r-lg)`，浏览器回归逐元素读 `borderTopLeftRadius`。
- **误改颜色**：形态层铁律是不定义任何色值。若为了「像截图」直接写 `#1c1c1e` 之类的
  深色，明/暗主题会双双跑偏，且皮肤回归立即失败。要调层次只能引用既有 `--zx-*` 令牌。
- **A/B 对照图不更新**：`scripts/nodeloc-skin-render.py` 会输出 5 张对照图到
  `/data/workspace/_preview/`，改形态后记得重跑，别拿旧图当验收依据。

### Z.9 效果层与参考站抓取的常见错误

- **抓不到 `yunamo.com` 的真实 CSS**：它是 Vue 3 + Vite 的 SPA，`web_fetch` 只返回
  `<title>`，没有 `<link>` / `<style>` / `<script src>`；沙盒直连被网关 403，
  文本渲染代理被安全审核拒绝。因此本版效果是按其公开 README 的技术栈
  （Vue 3 + Vite + Tailwind + DaisyUI）与 DaisyUI 主题层次概念落地，**不是逐像素复刻**，
  也没有引用任何抓不到的样式文件。
- **「效果」不是恢复旧动效**：切页过渡、整屏就绪门、毛玻璃都保持删除状态。
  为更炫把 `pageTransition` / `backdrop-filter` 加回来，皮肤回归与性能回归会同时失败。
- **别写死颜色**：柔光 / 点阵全部用 `var(--zx-*)` 令牌；直接写 `#hex` 或 `rgba(...)`
  会破坏明暗双主题，形态层「零颜色字面量」断言会立即拦下。
- **循环动画别加第三条**：`nl-glow` / `nl-dot` 是上限，浏览器回归会数
  `@keyframes nl-` 的数量（必须恰好 2）；再加会与「暂停动效」和响应速度口径冲突。
- **壁纸盖住点阵**：`#bg` 壁纸层 z-index 为负且在 body 背景之上，所以点阵同时
  叠在 `.rv-hero` / `.main-in` 内容层上；只改 body 背景在首页是看不见的。
- **对照图**：改效果后重跑 `scripts/nodeloc-skin-render.py`，看
  `/data/workspace/_preview/nodeloc_skin_after_*.png`，别用旧图验收。

### Z.9 编辑兑换码的常见错误

- **改了「总使用量」却比已用量小**：前端允许填，但后端会拒绝；并发下读取后
  又被兑换一次时由 `AND used_count <= ?` 挡住并返回 409，刷新列表再改即可。
- **把「已用量」当普通字段随手改**：它本应只由兑换链路自增。编辑框里的
  「已用量（管理员修正）」仅用于对账偏差，改动会写审计日志，且用
  `AND used_count = 读取值` 乐观锁；若期间有人兑换，会提示刷新而不是覆盖。
- **以为删了重发就行**：`redeem_logs` 按券码记账，删掉旧券后旧兑换记录仍在，
  同一个账号领过的新码还能再领一次。要调参请用「编辑」，不要删券重发。
- **改完没生效**：列表刷新一次即可；`/preview`、奖励中心兑换、注册页 DC 抵扣
  都读同一张 `redeem_codes`，不另设缓存。若填了过去时间，券会立刻判过期。
- **英文模式提示仍是中文**：`src/lib/i18nServer.ts` 的 `SERVER_DICT` /
  `SERVER_PATTERNS` 已收录本接口全部固定与动态文案，新增提示记得同步补词条。

### Z.9 「网站太卡 / 动画效果太多」的排查与口径

社区回帖反馈「注册三个了。就是网站太卡了。能优化吗美化一下吧……而且动画效果太多」。
对应处理分三条，改动都已上线：

- **卡（数据层）**：D1 免费版 5M rows read/天 曾被 `/api/config` 的全表 GROUP BY
  打爆，站点整体 500。已改持久化快照（读 1 行 / 10 分钟重算）、静态资源请求
  0 次 D1、settings 统一缓存、注册输入 600ms 防抖。排查先看 Cloudflare D1
  「读取的行」曲线，再看 Job Summary 的 KV/R2 绑定状态。
- **卡（渲染层）**：上一轮只删了 Miku 切页过渡，历史 `shell.css` 仍常驻
  `petalFall` / `pawWave` / `bl-petals` 等 infinite 动画与 90+ 条 hover 过渡。
  现在入口默认 `data-motion="paused"`，形态层 8.5–8.7 分三级特异性把它们归零，
  不要再靠「再叠一层收口」去压，优先在源头改。
- **动画太多 / 太花**：默认全停；用户主动点「恢复动效」才放开。若把默认值改回
  不设 `paused`，`scripts/perf-regression.ts` 会失败。
- **美化**：见第 15 节 NodeLoc 3.0 全圆角改版，颜色保持现行色板。

常见错误：以为 `html[data-motion="paused"] * { transition: none }` 就够——
`8.4` 的 `transition` 带 `!important` 且选择器特异性更高，shell.css 里还有不带
`!important` 的 `.16s` 长属性过渡，必须按 8.5 / 8.6 / 8.7 三级收口。
浏览器回归会逐项读 `transitionDuration`，默认态必须是 `0s`。

### Z.10 AnyNS 管理 API 接入的常见错误

- **把 `public_ns` 当成该域名的 NS**：官方明确 `zone.ns` 才是「应到注册商填的
  NS」，`public_ns` 只是平台默认。只在没返回 `zone.ns` 时才回落，并标记
  `nsSource: public_ns`，不要静默替换。
- **重复点「连接供应商」把配额吃满**：`anynsEnsureZone` 必须先 `GET /zones`
  按归一化域名找，命中就直接用；只有不存在才 `POST`。回归里断言
  「已存在时零 POST」。
- **拿 DDNS / ACME 令牌调管理接口**：三种 scope 都是 `nhtdns_` 开头，但
  服务端返回 `403 token_scope_mismatch`。错误文案会提示去面板建「管理令牌」，
  不要靠换前缀硬试。
- **`name` 传完整 FQDN**：AnyNS 记录名是相对名，根域用官方口径 `@`，
  子域只传前缀标签；`anynsRelativeName` 会拒绝越域名称。
- **修改记录时覆盖 ttl / line**：`POST /records` 带 `id>0` 是修改，
  官方「未传的字段保持原值」；只在新建时补 `ttl=300` / `line=default`。
- **以为「检查委派」验证了 NS**：官方没有独立委派校验端点，这里只查 zone
  存在与它记录的 NS。注册商 NS 是否生效必须用 `dig NS` 或面板确认，
  接口返回里带 `warning`，不要删掉。
- **以为接入 API 就自动开放第三方域名接入**：`EXTERNAL_DOMAINS_COMING_SOON`
  仍为 `true`，所有接口返回 503 `comingSoon`。要开放需显式改回 `false`
  并恢复前端表单，回归会拦住误改。
- **限流**：管理接口每令牌 60 次/分、1000 次/时，导入导出另限 3 次/分、
  30 次/时；429 时客户端给出明确提示，别用无限重试打满。

### Z.11 SEUS DNS 接入的常见错误

- **把 MCP 当裸 REST 猜路径**：官方只公开 `https://s.eus/api/mcp`，
  工具名与 schema 由服务器 `tools/list` 暴露；擅自拼 `/v1/zones` 必然 404。
- **只解析 JSON 不解析 SSE**：Streamable HTTP 可能回 `text/event-stream`，
  要逐行取 `data:` 里最后一条带 `result` / `error` 的 JSON。
- **会话没复用**：`initialize` 返回的 `Mcp-Session-Id` 必须带回后续请求。
- **填了账户 Token 之外的字符串**：凭据是 `mbt_` 开头；DDNS / AnyNS 的
  `nhtdns_` 令牌不能混用。
- **误以为接入即开放**：闸门仍为 `EXTERNAL_DOMAINS_COMING_SOON = true`，
  前端只显示状态卡片。

### Z.12 meoy.top 暂停解析 / AnyNS 站点级后端的常见错误

- **把 `subdomains.status` 批量改成新状态**：公开统计、续期、配额、用户案例
  展示都会失真。只叠加 `dnsPaused`，库里 `status` 保持 `approved`。
- **把站点级令牌做成「用户自带 key」**：本节是 Worker Secret 里的
  `ANYNS_API_TOKEN`，用户页面不填任何凭据；第 19 节的 BYOS 是另一条链路，
  两者不要混。`src/lib/anynsDns.ts`（客户端）与
  `src/lib/anynsBackend.ts`（站点后端）分工不同。
- **忘了 CI 也要传 Secret**：只在本机 `wrangler secret put` 而没在 GitHub
  Actions 的 Secrets 里加同名项，下次自动部署会被覆盖。CI 步骤会打印
  「已写入 / 未配置 ANYNS_API_TOKEN」，看 Job 日志即可确认。
- **拿 DDNS / ACME 令牌当管理令牌**：三种 scope 都是 `nhtdns_` 开头，
  服务端返回 `403 token_scope_mismatch`，错误文案会提示去面板建「管理令牌」。
- **以为暂停解析会清掉已有记录**：只是冻结编辑，读取与已有解析不受影响；
  迁移完成清空 `dns_paused_roots` 即恢复。
- **以为「检查委派」验证了注册商 NS**：AnyNS 官方没有独立委派校验端点，
  记录写进 zone 也不等于解析生效，请用 `dig NS` 或面板确认（见 Z.10）。
- **管理员被闸门误拦**：写闸门对 `role='admin'` 豁免，迁移记录必须能补；
  若管理员也 403，先看 `dns_paused_roots` 是否配错成了 `*` 之类。
- **迁移后旧 Cloudflare 记录改不了**：`cf_record_id` 是旧的非数字 id，
  接口会明确提示「删除后重新添加」，不要把它当 AnyNS 记录 id 传出去。
- **以为令牌只能走 Worker Secret**：后台「站点设置 → AnyNS」现在可以直接填，
  保存即生效；Secret 只是优先级更高的可选项，不是唯一入口。
- **后台填完令牌却「没反应」**：确认没开 Worker Secret（后台会标 `fromEnv`、
  令牌框只读），或 CI 重新部署把 Secret 覆盖了。保存时三层缓存已统一失效，
  正常情况下不用等 30 秒、不用重新部署。
- **把令牌写进公开配置或备份发给别人**：后台只回掩码、`/api/config` 只有布尔值；
  要把备份发给别人排查时勾「生成脱敏副本」，`anyns_api_token` 会被置空。
- **迁移完忘了恢复**：在「站点设置 → AnyNS」把「暂停解析根域名」清空保存，
  不用去数据库改 `dns_paused_roots`。
- **以为「选项 AnyNS」只是显示用**：下拉写入 `root_dns_backends`，立即改变
  DNS 记录下发后端；切换后列表会显示 `ANYNS DNS · #<zone id>`。
- **切回 Cloudflare 没反应**：以前 `ANYNS_ROOTS` 的自动推断压过了显式选择，
  现已改成显式优先。若仍无变化，强清浏览器缓存并确认没有 Worker Secret
  里的 `ANYNS_ROOTS` 与之冲突。
- **在站点设置填了令牌却没去「拉取域名」**：令牌只让后端可用，域名与 Zone ID
  要点「从 AnyNS 拉取域名」勾选后才会登记；否则写记录时会按域名现查 `/zones`，
  查不到就明确报错。
- **从 AnyNS 拉到的域名 NS 没改**：拉取只登记本站配置，**不会**替你到注册商
  改 NS。请按弹窗里显示的 NS 到注册商处修改，否则记录写进 AnyNS 也不生效
  （见 Z.10）。
- **批量勾选只生效最后一个**：`addExtraRoots` 与 `setDnsBackend` 之间必须失效
  settings 统一缓存，否则第二次写入会用旧快照覆盖第一次的后端映射。回归已锁死。
