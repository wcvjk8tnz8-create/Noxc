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
| KV / R2 没自动绑上 | 速览 → 3，附录 → 自定义头像上传 |
| 接口 / 安全 / 限制 | 五 ~ 七 |
| 单项功能实现细节与沿革 | 附录 · 功能与实现细节 |

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

### 3. KV / R2 自动绑定排查

CI 会尝试自动创建并绑定 Workers KV（`KV`）与 R2（`AVATARS`）。绑定成功会写进 **Job Summary**，站点 `/api/config` 的 `kvBound` / `avatarUpload` 也能查。

若 Summary 显示「未自动绑定」、或这两个布尔值都是 `false`，原因基本都是 **API Token 对这两个资源没有权限**：Cloudflare 对「token 有效但越权」也返回 `Authentication error (code 10000)`，所以部署与 D1 仍然成功，只有 KV / R2 的接口被拒。脚本为保证部署不中断会移除绑定并降级 —— **步骤是绿的，但绑定确实没挂上**，这也是最容易误判的地方。

推荐修法（一次配置，之后全自动；新部署直接用「三、部署步骤 → 1」的
**一键创建**链接，7 项权限已预填，不必逐条勾）：

1. Cloudflare Dashboard → My Profile → API Tokens → 编辑部署用的 Token；
2. Permissions 增加两项：`Account → Workers KV Storage → Edit`、`Account → R2 → Edit`（保留原有的 Workers Scripts / D1 / DNS 权限）；
3. 重新跑一次 Actions，脚本会自动创建 `noxc-kv` namespace 与 `meoy-avatars` 桶并写入绑定。

不想动 Token，也可以在控制台手动创建后填仓库 Variables 绕过 API：

| 资源 | 控制台操作 | Variables |
|---|---|---|
| KV | 建 namespace `noxc-kv`，复制 id | `KV_NAMESPACE_ID=<id>`（脚本直接写绑定，不调 API） |
| R2 | 建桶 `meoy-avatars` | `R2_BUCKET_NAME=meoy-avatars` + `R2_ASSUME_EXISTS=1`（跳过 API 校验直写绑定；桶不存在时部署会明确报错） |

> CI 对 `wrangler.toml` 的绑定修改只在本次部署生效，**不会提交回仓库**。请以 Job Summary 和 `/api/config` 为准，不要只看仓库里的 `wrangler.toml`。

### 4. 其它已上线能力（速查）

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
| 站点公告 | 空 | 预留 |

改完点保存，导航 Logo 立即刷新，其它页面刷新一次生效。另有「恢复默认 Logo」按钮。

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

## 二、项目结构

```
subdomain-hub/
├── src/
│   ├── index.ts                 入口：路由挂载、公开配置、SPA 回落
│   ├── lib/
│   │   ├── records.ts           12 种记录类型的字段定义与校验
│   │   ├── cf.ts                DNS API 封装（自动选 Cloudflare / Spaceship / 自定义）
│   │   ├── spaceshipDns.ts      Spaceship DNS 记录读写适配
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

| 需要什么 | 去哪里拿 |
|---|---|
| **API Token** | 用下方「一键创建」链接，权限与名称已预填 |
| **Account ID** | <https://dash.cloudflare.com/?to=/:account/workers-and-pages> 右侧栏 |
| **Zone ID** | 选中根域名 → Overview → 右下角 API 区块 |

**一键创建（推荐）**：

👉 [创建 Noxc Deploy Token（用户 Token）](https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_kv_storage%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_r2%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22dns%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_routes%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_settings%22%2C%22type%22%3A%22read%22%7D%5D&accountId=%2A&zoneId=all&name=Noxc%20Deploy%20Token)

打开即是 Create Custom Token 表单，7 项权限与名称已勾好；确认 Account / Zone 范围后
`Continue to summary` → `Create Token`，**token 只显示一次，立刻复制**。
CI 场景若不想依赖个人账号，可用 [Account-owned Token](https://dash.cloudflare.com/?to=/:account/api-tokens&permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_kv_storage%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_r2%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22dns%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_routes%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_settings%22%2C%22type%22%3A%22read%22%7D%5D&name=Noxc%20Deploy%20Token)（需 Super/Administrator）。

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
| POST | `/api/auth/password` | 修改密码 |
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

## 七、已知限制

- **SOA**：Cloudflare 不允许通过 API 增删改区域 SOA，页面只提供查看；如需自定义需走 Cloudflare 工单
- **PTR**：只有在 Cloudflare 托管反向区域（in-addr.arpa）时才真正生效，正向域中创建仅作占位
- **NS**：Cloudflare 区域的根域 NS 不可修改，但子域委派（如 `sub.xxx.meoy.top` 的 NS）可以正常添加
- TXT 单条最长 2048 字符（Cloudflare 限制），超出需分段


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

**部署顺序**：CI 先 `npm install` → `npm run build` → `wrangler deploy`。
仓库不提交 `package-lock.json`，所以 CI 用 `npm install`（不能用 `npm ci`），
`actions/setup-node` 也不启用 npm 缓存选项。

**SPA 路由**：站内链接为 `/dashboard`、`/register` 这类干净路径；`App.tsx` 仍保留
`/xxx.html` 别名，老书签与 `whois.` 子域的服务端重定向继续可用。
Worker 的 `SPA_PATHS` 白名单把这些路径统一回落到 SPA 外壳，由 React 接管。


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
  分段器、步骤条、空状态、底部页脚
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
- **注册** —— 开启后注册需先验证邮箱
- **更换邮箱** —— 个人资料里向**新邮箱**发码，确认后写回账号；沿用同一套
  `email_verifications` 表（`email_change` 场景），不套注册邮箱白名单规则

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
