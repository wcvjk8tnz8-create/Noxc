-- ============================================================
--  二级域名分发系统 · D1 (SQLite) 表结构
--  初始化： npx wrangler d1 execute subdomain-hub-db --remote --file=./schema.sql
-- ============================================================

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'user',      -- user | admin
  status        TEXT    NOT NULL DEFAULT 'active',    -- active | banned
  ban_reason    TEXT,
  quota         INTEGER NOT NULL DEFAULT 5,           -- 最多可持有的子域名数
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);

-- 注册登记表：记录注册 IP、UA 与条款同意情况（独立表，避免改动 users 结构）
CREATE TABLE IF NOT EXISTS registrations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,
  ip           TEXT,
  ua           TEXT,
  agreed_terms INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reg_ip    ON registrations(ip);
CREATE INDEX IF NOT EXISTS idx_reg_user  ON registrations(user_id);

-- 外部域名 WHOIS 结果缓存（避免触发 DNSHE 2次/分钟、RDAP 注册局限流）
CREATE TABLE IF NOT EXISTS whois_cache (
  domain     TEXT    PRIMARY KEY,
  data       TEXT    NOT NULL,
  fetched_at INTEGER NOT NULL
);

-- NS 委派：把子域名托管到第三方 DNS（anyns.io / DNSHE / Cloudflare / 自定义）
CREATE TABLE IF NOT EXISTS delegations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  subdomain_id  INTEGER NOT NULL UNIQUE,
  provider      TEXT    NOT NULL,            -- anyns | dnshe | cloudflare | custom
  zone_name     TEXT    NOT NULL,
  ns_list       TEXT    NOT NULL,            -- JSON 数组
  provider_zone TEXT,                        -- 服务商侧的 zone id（若通过 API 创建）
  created_by    INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_delegations_sub ON delegations(subdomain_id);

-- 积分余额（独立表，不动 users 结构；-1 表示不限，仅管理员）
CREATE TABLE IF NOT EXISTS user_points (
  user_id    INTEGER PRIMARY KEY,
  points     INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- 积分流水：签到获得，申请/兑换子域名消耗（单字域名更贵）
CREATE TABLE IF NOT EXISTS point_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  delta      INTEGER NOT NULL,               -- 正数为获得，负数为消耗
  balance    INTEGER NOT NULL,               -- 变动后的余额
  reason     TEXT    NOT NULL,               -- checkin | apply | admin_adjust | ...
  detail     TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_point_logs_user ON point_logs(user_id, created_at DESC);

-- 每日签到（同一天只能领一次，按站点时区计）
CREATE TABLE IF NOT EXISTS checkins (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  day        TEXT    NOT NULL,               -- YYYY-MM-DD
  points     INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_checkins_user_day ON checkins(user_id, day);

-- IP 封禁名单（某 IP 下的账号超限时由管理员一键封禁）
CREATE TABLE IF NOT EXISTS ip_bans (
  ip         TEXT PRIMARY KEY,
  reason     TEXT,
  created_by INTEGER,
  created_at INTEGER NOT NULL
);

-- 会话表
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  ip         TEXT,
  ua         TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- 子域名表
CREATE TABLE IF NOT EXISTS subdomains (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  label         TEXT    NOT NULL,             -- 二级部分，如 mail（唯一性由 fqdn 承担）
  root_domain   TEXT    NOT NULL DEFAULT '', -- 根域名，如 meoy.top（由 fqdn 反推）
  fqdn          TEXT    NOT NULL UNIQUE,      -- 完整域名，如 mail.meoy.top
  user_id       INTEGER NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | suspended | expired
  reason        TEXT,                          -- 驳回 / 停用原因
  note          TEXT,                          -- 用户申请时填写的用途说明
  -- 有效期：NULL = 永久（迁移前已注册的域名）；有值 = 到期时间戳
  expires_at    INTEGER,
  renewed_at    INTEGER,                       -- 最近一次续期时间
  perpetual     INTEGER NOT NULL DEFAULT 0,    -- 1 = 永久有效（老域名 / 管理员设置）
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  reviewed_at   INTEGER,
  reviewed_by   INTEGER,
  -- AI 批量审核（每小时 cron + 新申请触发）：本次扣分、失败计数、并发领取锁
  apply_cost    INTEGER,
  ai_attempts   INTEGER NOT NULL DEFAULT 0,
  ai_last_error TEXT,
  ai_last_try_at INTEGER,
  ai_claim_at   INTEGER,
  -- 用户案例展示：默认不展示（0），由域名详情页自行开启
  showcase       INTEGER NOT NULL DEFAULT 0,
  showcase_title TEXT,
  showcase_desc  TEXT,
  showcase_emoji TEXT
);
CREATE INDEX IF NOT EXISTS idx_subdomains_user    ON subdomains(user_id);
CREATE INDEX IF NOT EXISTS idx_subdomains_status  ON subdomains(status);
-- 注意：旧库没有 expires_at 列，CREATE TABLE IF NOT EXISTS 不会补列，
-- 因此 expires_at 相关索引放到「列补齐」步骤之后再建（见文件末尾）。
-- 这里先尝试建，失败会被忽略，末尾会重试。

-- 一次性迁移：迁移前已注册（approved）的域名设为永久，不追溯 1 年有效期。
-- 用 INSERT OR IGNORE 记录迁移标记，重复执行不会覆盖管理员后来的改动。
CREATE TABLE IF NOT EXISTS migrations (
  name       TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO migrations (name, applied_at) VALUES ('legacy_perpetual', 0);

-- DNS 记录表
CREATE TABLE IF NOT EXISTS dns_records (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  subdomain_id  INTEGER NOT NULL,
  cf_record_id  TEXT,                          -- Cloudflare 侧的 record id
  type          TEXT    NOT NULL,              -- A/AAAA/CNAME/MX/TXT/NS/PTR/SRV/CAA/NAPTR/DS
  host          TEXT    NOT NULL,              -- 用户填写的相对主机名，@ 表示子域名本身
  name          TEXT    NOT NULL,              -- 最终写入 Cloudflare 的完整记录名
  content       TEXT    NOT NULL DEFAULT '',   -- 主值（A/AAAA/CNAME/MX/TXT/NS/PTR）
  data          TEXT,                          -- 结构化字段 JSON（SRV/CAA/NAPTR/DS）
  ttl           INTEGER NOT NULL DEFAULT 1,    -- 1 = 自动
  proxied       INTEGER NOT NULL DEFAULT 0,    -- 仅 A/AAAA/CNAME
  priority      INTEGER,                       -- MX / SRV
  comment       TEXT,
  -- 根域名验证锁：1 = 已锁定，任何人都不能改/删，只有发起人点“确认认证完成”或管理员强制解锁
  verify_lock   INTEGER NOT NULL DEFAULT 0,
  verify_preset TEXT,                          -- vercel / netlify / dnspod / custom
  locked_at     INTEGER,
  locked_by     INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_records_sub ON dns_records(subdomain_id);
CREATE INDEX IF NOT EXISTS idx_records_cf  ON dns_records(cf_record_id);
-- 同一完整记录名下，只允许存在一条处于锁定状态的记录（防抢占）
CREATE UNIQUE INDEX IF NOT EXISTS idx_records_lock_unique
  ON dns_records(name, type) WHERE verify_lock = 1;

-- 审计日志
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  action     TEXT    NOT NULL,
  target     TEXT,
  detail     TEXT,
  ip         TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at);

-- 站点配置（可选，用于运行时开关）
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO settings(key, value) VALUES ('signup_open', '1');
INSERT OR IGNORE INTO settings(key, value) VALUES ('approval_required', '1');
-- 站点公告：后台「站点设置 → 站点公告」填纯文本，留空则不显示。
-- 以前默认写死旧品牌欢迎语，且 /api/config 没查这个 key，导致公告条从未出现。
-- 全新库默认留空，由管理员自行决定是否展示；已有值不受 INSERT OR IGNORE 影响。
INSERT OR IGNORE INTO settings(key, value) VALUES ('announcement', '');
-- 同 IP 可注册的账号数上限（管理员可在后台调整）
INSERT OR IGNORE INTO settings(key, value) VALUES ('max_accounts_per_ip', '2');
-- 新用户默认子域名配额：-1 = 不限量，0 = 不允许申请；后台「站点设置」可改
INSERT OR IGNORE INTO settings(key, value) VALUES ('default_quota', '5');
-- 积分规则（新默认与 src/lib/pointDefaults.ts 逐项一致，由健康巡检断言）
INSERT OR IGNORE INTO settings(key, value) VALUES ('checkin_points', '30');     -- 每日签到奖励
INSERT OR IGNORE INTO settings(key, value) VALUES ('domain_cost', '60');        -- 申请一个子域名消耗
INSERT OR IGNORE INTO settings(key, value) VALUES ('short_domain_cost', '300'); -- 单字域名消耗
INSERT OR IGNORE INTO settings(key, value) VALUES ('short_domain_len', '1');    -- 长度 <= 该值视为单字域名
INSERT OR IGNORE INTO settings(key, value) VALUES ('initial_points', '100');    -- 新用户初始积分

-- 老库升级：只把「仍是旧默认、且从未升级过」的库刷成新默认。
-- 管理员后来手动改过的值（含故意设成 5 / 10 / 35）一律保留，不覆盖。
-- points_defaults_v2 是一次性标记，避免每次部署反复改写自定义值。
UPDATE settings SET value = '30'  WHERE key = 'checkin_points'    AND value = '5'
  AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'points_defaults_v2');
UPDATE settings SET value = '60'  WHERE key = 'domain_cost'       AND value = '5'
  AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'points_defaults_v2');
UPDATE settings SET value = '300' WHERE key = 'short_domain_cost' AND value = '35'
  AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'points_defaults_v2');
UPDATE settings SET value = '100' WHERE key = 'initial_points'    AND value = '10'
  AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'points_defaults_v2');
INSERT OR IGNORE INTO settings(key, value) VALUES ('points_defaults_v2', '1');
-- WHOIS 持有人邮箱显示方式：masked 脱敏（默认）| none 不显示 | full 完整
INSERT OR IGNORE INTO settings(key, value) VALUES ('whois_holder', 'masked');
-- 站点品牌（后台「站点设置」可改）
INSERT OR IGNORE INTO settings(key, value) VALUES ('site_name', 'Noxc');
-- 迁移：旧品牌统一更名为 Noxc（只改仍是旧默认值的库，不覆盖管理员自定义名称）
-- 注意：IN 列表里的旧品牌字面量是待迁移值，必须保留，否则线上库仍显示旧名。
UPDATE settings SET value = 'Noxc' WHERE key = 'site_name' AND value IN ('Meoy', 'MeoyDomain', 'TerraDomain');
INSERT OR IGNORE INTO settings(key, value) VALUES ('logo_url', '/img/logo.jpg');
INSERT OR IGNORE INTO settings(key, value) VALUES ('favicon_url', '/favicon.ico');

-- 迁移：早期默认 favicon 为 png，现统一为根目录的 .ico（仅改仍是旧默认值的库）
UPDATE settings SET value = '/favicon.ico' WHERE key = 'favicon_url' AND value = '/img/favicon.png';

-- ══════════════════════════════════════════════════════════
--  列补齐：CREATE TABLE IF NOT EXISTS 不会给已存在的表加列，
--  因此对旧库逐列检测后再 ALTER TABLE ADD COLUMN（SQLite 不支持 IF NOT EXISTS）。
--  wrangler d1 execute 执行整份文件时，每条语句独立提交，
--  失败会中断后续语句 —— 所以这些 ALTER 必须由应用层的幂等迁移承担。
--  这里保留注释说明，实际补齐逻辑见 src/lib/expiry.js 的 ensureExpiryColumns()。
-- ══════════════════════════════════════════════════════════

-- 有效期规则（管理员可在后台「站点设置」调整）
INSERT OR IGNORE INTO settings(key, value) VALUES ('domain_valid_days', '365');   -- 新申请域名有效期（天）
-- 续期窗口：留空 = 自动取「有效期的一半」（少于一半即可续期）；填数字 = 显式覆盖
INSERT OR IGNORE INTO settings(key, value) VALUES ('renew_window_days', '');

-- 老库升级：旧默认是固定 180 天，与「365 天的一半」口径不一致。
-- 只把仍等于旧默认、且尚未升级过的库清空一次；管理员后来自己填的值一律保留。
UPDATE settings SET value = '' WHERE key = 'renew_window_days' AND value = '180'
  AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'renew_window_half_v2');
INSERT OR IGNORE INTO settings(key, value) VALUES ('renew_window_half_v2', '1');

-- ══════════════════════════════════════════════════════════
--  兑换码：V-XXX 域名永久化 / PE-XXXXX 配额 / DC-XXXXXX 积分
-- ══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS redeem_codes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT    NOT NULL UNIQUE,   -- 形如 V-A1B2C3 / PE-XXXXXXX / DC-XXXXXX
  type         TEXT    NOT NULL,          -- permanent | quota | points
  value        INTEGER NOT NULL DEFAULT 1,-- quota=增加配额数量 / points=增加积分数
  max_uses     INTEGER NOT NULL DEFAULT 1,
  used_count   INTEGER NOT NULL DEFAULT 0,
  status       TEXT    NOT NULL DEFAULT 'active',  -- active | disabled
  note         TEXT,                       -- 备注（派发给谁）
  expires_at   INTEGER,                    -- 为空表示长期有效
  created_by   INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_redeem_status ON redeem_codes(status);
CREATE INDEX IF NOT EXISTS idx_redeem_type   ON redeem_codes(type);

-- 兑换记录（含 V 码兑换时绑定的域名）
CREATE TABLE IF NOT EXISTS redeem_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT    NOT NULL,
  user_id      INTEGER NOT NULL,
  type         TEXT    NOT NULL,
  subdomain_id INTEGER,                    -- permanent 类型：被永久化的域名
  value        INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_redeem_logs_user ON redeem_logs(user_id);

-- ══════════════════════════════════════════════════════════
--  聊天地（讨论区 / 博客）
-- ══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS chat_posts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  title      TEXT    NOT NULL,
  content    TEXT    NOT NULL,
  pinned     INTEGER NOT NULL DEFAULT 0,
  locked     INTEGER NOT NULL DEFAULT 0,
  views      INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_posts_user ON chat_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_posts_time ON chat_posts(created_at);

CREATE TABLE IF NOT EXISTS chat_replies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  content    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_replies_post ON chat_replies(post_id);

-- 全局中文字体（正文 / 标题）：system | noto | lxgw | zcool
INSERT OR IGNORE INTO settings(key, value) VALUES('font_body', 'zcool');
INSERT OR IGNORE INTO settings(key, value) VALUES('font_display', 'zcool');

-- 用户资料（独立表：不动 users 结构，避免已存在表补列失败）
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id     INTEGER PRIMARY KEY,
  uid         TEXT,                       -- 对外展示的 UID（不含敏感信息）
  avatar      TEXT,                       -- 头像地址（站内 /img/avatar/xx.svg 或外链）
  nickname    TEXT,                       -- 昵称
  bio         TEXT,                       -- 个人简介 / 签名
  updated_at  INTEGER
);

-- 工单系统
CREATE TABLE IF NOT EXISTS tickets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  subject    TEXT    NOT NULL,
  status     TEXT    NOT NULL DEFAULT 'open',   -- open=待处理 pending=处理中 answered=有回复 closed=已关闭
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ticket_replies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id  INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  is_admin   INTEGER NOT NULL DEFAULT 0,
  content    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_replies_ticket ON ticket_replies(ticket_id, id);

-- 域名转移记录（不可逆，留痕备查）
CREATE TABLE IF NOT EXISTS transfers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  subdomain_id INTEGER NOT NULL,
  fqdn         TEXT    NOT NULL,
  from_user    INTEGER NOT NULL,
  to_user      INTEGER NOT NULL,
  to_email     TEXT    NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transfers_fqdn ON transfers(fqdn, created_at DESC);

-- ══════════════════════════════════════════════════════════
-- 多根域名支持（幂等，可重复执行）
-- ══════════════════════════════════════════════════════════
-- 背景：原表 label 是 UNIQUE，导致同一 label 无法存在于不同根域名下
--      （如 mail.meoy.top 与 mail.foo.com 互斥）。
-- ⚠ 历史迁移已废弃（2026-11-21）：早期为了去掉 label 的 UNIQUE 重建过
--   subdomains 表（CREATE subdomains_mr → INSERT → RENAME）。那段「原子切换」
--   **每次 CI 部署都会重新执行一遍**：新表的 INSERT 列清单里没有
--   showcase / showcase_title / showcase_desc / showcase_emoji 四列，
--   于是用户开启的「用户案例展示」开关与标题描述每次更新都被抹掉。
--
--   现在主表由上面的 CREATE TABLE IF NOT EXISTS 直接建成最终结构；
--   老库缺列由 src/lib/showcase.ts 的 ensureCoreColumns() 在 Worker 首次
--   请求时 PRAGMA + ALTER 补齐并回填 root_domain，绝不再 RENAME / DROP 业务表。
--   索引仍然幂等创建，可重复执行。

-- 重建索引
CREATE INDEX IF NOT EXISTS idx_subdomains_user   ON subdomains(user_id);
CREATE INDEX IF NOT EXISTS idx_subdomains_status ON subdomains(status);
CREATE INDEX IF NOT EXISTS idx_subdomains_root   ON subdomains(root_domain, label);
CREATE INDEX IF NOT EXISTS idx_subdomains_fqdn   ON subdomains(fqdn);

-- ══════════════════════════════════════════════════════════
-- 管理员域名永久化（幂等，可重复执行）
-- ══════════════════════════════════════════════════════════
-- 管理员自身持有的域名一律永久有效（新申请时直接写 perpetual=1，
-- 这里负责回填历史数据）。
UPDATE subdomains
   SET perpetual = 1,
       expires_at = NULL
 WHERE perpetual = 0
   AND user_id IN (SELECT id FROM users WHERE role = 'admin');

-- ══════════════════════════════════════════════════════════
--  站内通知（铃铛）
--  类型：domain_approved 域名审核通过 / login_ip 账号登录提醒 / system 系统通知
-- ══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  type       TEXT NOT NULL,                -- domain_approved / login_ip / system
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  tag        TEXT NOT NULL DEFAULT '系统通知',
  link       TEXT,                          -- 可选：点击跳转
  read       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read, created_at DESC);

-- ══════════════════════════════════════════════════════════
--  邮箱验证码（注册 / 忘记密码）
--  场景：register / reset
--  发送渠道由 mail_provider 决定（resend / brevo）
-- ══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS email_verifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  scene      TEXT NOT NULL,                -- register / reset / email_change
  code_hash  TEXT NOT NULL,                -- 验证码只存哈希，不存明文
  ip         TEXT,
  expires_at TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  tries      INTEGER NOT NULL DEFAULT 0,   -- 错误尝试次数，超过即作废
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ev_email ON email_verifications(email, scene, used);

-- 邮件服务配置（后台「站点设置 → 邮件与验证码」）
INSERT OR IGNORE INTO settings(key, value) VALUES ('mail_provider', '');      -- resend / brevo（留空=不启用验证码）
INSERT OR IGNORE INTO settings(key, value) VALUES ('mail_from', '');          -- 例：verify@meoy.top
INSERT OR IGNORE INTO settings(key, value) VALUES ('mail_api_key', '');       -- 敏感：后台只回显掩码
INSERT OR IGNORE INTO settings(key, value) VALUES ('mail_verify_required', '0'); -- 注册是否需要验证码（1=需要）
-- R2 头像公网地址（留空则用 Worker 代理 /api/avatar/<key>）
INSERT OR IGNORE INTO settings(key, value) VALUES ('r2_public_url', '');

-- ══════════════════════════════════════════════════════════
--  Spaceship 域名注册商（只读：拉取账号下域名并添加为根域名）
--  后台「站点设置 → Spaceship」可填；也可用环境变量
--  SPACESHIP_API_URL / SPACESHIP_API_KEY / SPACESHIP_API_SECRET 覆盖
-- ══════════════════════════════════════════════════════════
INSERT OR IGNORE INTO settings(key, value) VALUES ('spaceship_api_url', 'https://spaceship.dev/api');
INSERT OR IGNORE INTO settings(key, value) VALUES ('spaceship_api_key', '');
INSERT OR IGNORE INTO settings(key, value) VALUES ('spaceship_api_secret', '');

-- ══════════════════════════════════════════════════════════
--  滥用举报（公开提交 / 管理员处理）
--  由 src/routes/abuse.ts 首次请求时幂等建表，这里同步写入基准 schema
--  状态：open 待处理 / investigating 处理中 / resolved 已处理 / dismissed 已驳回
-- ══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS abuse_reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  domain        TEXT NOT NULL,
  type          TEXT NOT NULL,
  description   TEXT NOT NULL,
  evidence_url  TEXT,
  contact_email TEXT,
  user_id       INTEGER,
  ip            TEXT,
  status        TEXT NOT NULL DEFAULT 'open',
  admin_note    TEXT,
  handled_by    INTEGER,
  local_match   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_abuse_status ON abuse_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_abuse_domain ON abuse_reports(domain);
CREATE INDEX IF NOT EXISTS idx_abuse_user ON abuse_reports(user_id, created_at DESC);

-- 举报渠道展示（外部域名 WHOIS 与举报页共用），已在站点设置中配置
INSERT OR IGNORE INTO settings(key, value) VALUES ('abuse_email', '');
INSERT OR IGNORE INTO settings(key, value) VALUES ('abuse_report_url', '');

-- 后台导入的根域名（无需改环境变量；中间件会合并进 ROOT_DOMAINS）
-- 格式：逗号分隔域名 / "域名:ZoneID" 对
INSERT OR IGNORE INTO settings(key, value) VALUES ('root_domains_extra', '');
INSERT OR IGNORE INTO settings(key, value) VALUES ('cf_zone_ids_extra', '');

-- AI 自动审核（Agnes AI 等 OpenAI 兼容网关）
-- 注意：API Key 只存 settings.ai_api_key 或 Worker Secret AI_API_KEY，
--       绝不写进代码库；后台 GET 只回显掩码，公开 /api/config 不含任何密钥。
INSERT OR IGNORE INTO settings(key, value) VALUES ('ai_review_enabled', '1');
INSERT OR IGNORE INTO settings(key, value) VALUES ('ai_review_roots', 'v-1.top');
INSERT OR IGNORE INTO settings(key, value) VALUES ('ai_api_url', 'https://apihub.agnes-ai.com/v1');
INSERT OR IGNORE INTO settings(key, value) VALUES ('ai_api_key', '');
INSERT OR IGNORE INTO settings(key, value) VALUES ('ai_model', '');

-- 不限制「单个子域名最多 50 条 DNS 记录」的根域名（逗号分隔）
INSERT OR IGNORE INTO settings(key, value) VALUES ('dns_unlimited_roots', 'v-1.top');

-- 「暂停解析」与维护提示（通用开关；meoy.top 迁移已完成，默认全部恢复）
-- dns_paused_roots：逗号分隔根域名；留空即解析正常，不用逐行改数据。
-- 注意：这里只加展示状态，不把 subdomains.status 从 approved 改掉，
--       公开统计 / 续期 / 配额 / 用户案例展示一律不受影响。
INSERT OR IGNORE INTO settings(key, value) VALUES ('dns_paused_roots', '');
INSERT OR IGNORE INTO settings(key, value) VALUES ('dns_migration_notice', '');

-- 迁移收尾（一次性）：meoy.top 已迁到 AnyNS，把迁移期间预置在**线上库**里的
-- 暂停名单与提示清掉，重新开启该后缀的解析。
--   · 只清「仍等于迁移期默认值」的项；管理员后来主动暂停的其它后缀不动
--   · INSERT OR IGNORE 不会覆盖已有行，所以老库里的 'meoy.top' 要靠这里清
--   · marker 保证只执行一次：以后管理员若再次主动暂停 meoy.top，不会被重复清掉
--   · runtime_migrations_* 属于内部运行态，备份导出不带、汇入忽略
INSERT OR IGNORE INTO settings(key, value) VALUES ('runtime_migrations_dns_pause_anyns_done', '0');
UPDATE settings SET value = ''
  WHERE key = 'dns_paused_roots'
    AND value = 'meoy.top'
    AND (SELECT value FROM settings WHERE key = 'runtime_migrations_dns_pause_anyns_done') = '0';
UPDATE settings SET value = ''
  WHERE key = 'dns_migration_notice'
    AND value = 'meoy.top 正在迁移至 anyns，期间该后缀下的域名暂停解析'
    AND (SELECT value FROM settings WHERE key = 'runtime_migrations_dns_pause_anyns_done') = '0';
UPDATE settings SET value = '1'
  WHERE key = 'runtime_migrations_dns_pause_anyns_done' AND value = '0';

-- AnyNS（n.ht 社区）站点级管理令牌：后台「站点设置 → AnyNS」可填，
-- 不填则回落 Worker Secret ANYNS_API_TOKEN，都没有就走原 DNS 后端。
-- 令牌是敏感项：后台只回掩码，公开 /api/config 不下发，脱敏备份会置空。
INSERT OR IGNORE INTO settings(key, value) VALUES ('anyns_api_token', '');
INSERT OR IGNORE INTO settings(key, value) VALUES ('anyns_roots', '');
INSERT OR IGNORE INTO settings(key, value) VALUES ('anyns_zone_id', '');
INSERT OR IGNORE INTO settings(key, value) VALUES ('anyns_zone_ids', '');

-- 第三方邮箱注册：精确白名单（命中即在任何规则模式下都放行）
CREATE TABLE IF NOT EXISTS email_allowlist (
  email      TEXT PRIMARY KEY,
  note       TEXT NOT NULL DEFAULT '',
  source     TEXT NOT NULL DEFAULT 'manual',
  created_at INTEGER NOT NULL
);
-- SEUS 社区申请：me@stanimir.cn（OP 已答应给白名单）
INSERT OR IGNORE INTO email_allowlist(email, note, source, created_at)
  VALUES ('me@stanimir.cn', 'SEUS 社区白名单申请', 'seed', CAST(strftime('%s','now') AS INTEGER) * 1000);

-- 第三方邮箱注册申请（注册页公开提交 → 后台审批）
CREATE TABLE IF NOT EXISTS email_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL,
  reason      TEXT NOT NULL DEFAULT '',
  contact     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending / approved / rejected
  ip          TEXT NOT NULL DEFAULT '',
  ua          TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  reviewed_at INTEGER,
  reviewed_by TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_email_requests_email ON email_requests(email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_requests_status ON email_requests(status, created_at DESC);

-- 注册滑块验证：challenge / pass / 领取频控共用的防重放表。
-- id 为主键，重复 INSERT 即代表票据已被用过（不依赖 UPDATE 返回值）。
CREATE TABLE IF NOT EXISTS captcha_nonce (
  id   TEXT PRIMARY KEY,
  kind TEXT NOT NULL,      -- challenge / pass / issue
  exp  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_captcha_nonce_exp ON captcha_nonce(exp);

-- 默认开启；后台可关、可选图库子集。CI 用 Variable 覆盖也不会冲掉代码里的默认行为。
INSERT OR IGNORE INTO settings(key, value) VALUES ('captcha_enabled', '1');
INSERT OR IGNORE INTO settings(key, value) VALUES ('captcha_images', 'typhoon,meoy,miku,cloud');

-- ============================================================
--  NodeLoc OAuth 2.0 登录：第三方身份绑定 + 一次性 state
--  provider + sub 唯一：同一个 NodeLoc 账号不能绑到两个本地账号，
--  也不能被两个本地账号同时认领。
-- ============================================================
CREATE TABLE IF NOT EXISTS oauth_bindings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  provider    TEXT    NOT NULL,
  sub         TEXT    NOT NULL,
  user_id     INTEGER NOT NULL,
  username    TEXT,
  avatar_url  TEXT,
  /* GitHub access_token：仅 Worker 侧用于校验 Star 状态，绝不下发浏览器。
     NodeLoc 绑定此列为空。旧库由 src/lib/oauthStore.ts 运行时 ALTER 补齐。 */
  access_token TEXT,
  created_at  INTEGER NOT NULL,
  UNIQUE(provider, sub)
);
CREATE INDEX IF NOT EXISTS idx_oauth_bindings_user ON oauth_bindings(provider, user_id);

-- state 一次性领取（DELETE RETURNING），10 分钟过期，挡 CSRF 与重放
CREATE TABLE IF NOT EXISTS oauth_states (
  state       TEXT PRIMARY KEY,
  mode        TEXT    NOT NULL,       -- login | bind
  user_id     INTEGER,
  exp         INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_states_exp ON oauth_states(exp);

-- 绑定奖励领取记录：provider + user_id 唯一，保证 +5 只发一次
-- （解绑再绑、换 NodeLoc 账号、重复回调都不会再叠加）
CREATE TABLE IF NOT EXISTS oauth_quota_grants (
  provider    TEXT    NOT NULL,
  user_id     INTEGER NOT NULL,
  email       TEXT,
  amount      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  UNIQUE(provider, user_id)
);
CREATE INDEX IF NOT EXISTS idx_oauth_quota_grants_user ON oauth_quota_grants(user_id);

-- 默认关闭：管理员到 NodeLoc 创建应用、填入 Client ID / Secret 后再启用。
-- 应用管理页 https://www.nodeloc.com/oauth-provider/applications （需 TL2 及以上）。
INSERT OR IGNORE INTO settings(key, value) VALUES ('nodeloc_enabled', '0');
INSERT OR IGNORE INTO settings(key, value) VALUES ('nodeloc_client_id', '');
INSERT OR IGNORE INTO settings(key, value) VALUES ('nodeloc_client_secret', '');
-- 首次用 NodeLoc 登录时自动建号（1）；改为 0 则只允许绑定到已有账号
INSERT OR IGNORE INTO settings(key, value) VALUES ('nodeloc_auto_register', '1');
-- email 是唯一必需资料：默认申请（NodeLoc 应用需带 email 权限）
INSERT OR IGNORE INTO settings(key, value) VALUES ('nodeloc_scope_email', '1');
-- 旧库里系统初始写入的 '0' 一次性升级为 '1'；管理员之后手动关成 0 不会再被改回
UPDATE settings SET value = '1' WHERE key = 'nodeloc_scope_email' AND value = '0'
  AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'nodeloc_scope_email_v2');
INSERT OR IGNORE INTO settings(key, value) VALUES ('nodeloc_scope_email_v2', '1');
-- 留空 = 按当前站点 origin 生成 /oauth/nodeloc/callback；多域名部署可填固定绝对地址
INSERT OR IGNORE INTO settings(key, value) VALUES ('nodeloc_redirect_uri', '');

-- ============================================================
--  安全修订：封锁利用「邮箱任意位置含 edu」漏洞批量注册的一次性邮箱。
--  edu 判定已改为只看域名标签，漏洞根因已消除；oauth.local 是 NodeLoc
--  登录账号的占位域名，已解封，不在此封禁范围。
--  幂等：只处理尚未封禁的非管理员账号，管理员手动解封不受覆盖。
--  运行时另有兜底：登录时命中封禁域名会就地标记，见 routes/auth.ts。
-- ============================================================
UPDATE users SET status = 'banned',
                 ban_reason = '违规注册：一次性 / 非公开邮箱域名'
WHERE status <> 'banned' AND role <> 'admin' AND (
     lower(email) LIKE '%@mailinator.com'
  OR lower(email) LIKE '%@guerrillamail.com'
  OR lower(email) LIKE '%@10minutemail.com'
  OR lower(email) LIKE '%@temp-mail.org'
  OR lower(email) LIKE '%@yopmail.com'
  OR lower(email) LIKE '%@trashmail.com'
  OR lower(email) LIKE '%@dispostable.com'
  OR lower(email) LIKE '%@mailnesia.com'
  OR lower(email) LIKE '%@getnada.com'
  OR lower(email) LIKE '%@emailondeck.com'
);

-- 解封 @oauth.local：恢复上一版因「一次性 / 非公开邮箱域名」被误封的
-- NodeLoc 内部账号。只认这条 ban_reason，精确匹配，不动管理员手动封禁、
-- 也不放行 mailinator 等真临时邮箱。幂等，重复部署无副作用。
UPDATE users SET status = 'active', ban_reason = NULL
WHERE status = 'banned'
  AND ban_reason = '违规注册：一次性 / 非公开邮箱域名'
  AND (lower(email) LIKE '%@oauth.local' OR lower(email) LIKE '%@%.oauth.local');

-- ============================================================
--  按根域名「每人注册次数」累计表
--  与 subdomains 解耦：释放 / 删除域名都不退还次数，才是真正的「只能注册 N 次」。
--  记录从功能启用后开始累计，历史申请不回溯 —— 已注册用户不受影响。
-- ============================================================
CREATE TABLE IF NOT EXISTS root_reg_counts (
  user_id     INTEGER NOT NULL,
  root_domain TEXT    NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, root_domain)
);

-- 用户案例展示积分奖励：user_id 主键保证每账号只发一次，并发 INSERT OR IGNORE 天然去重。
-- 只建表、绝不 RENAME / DROP 业务表（展示开关曾因重建表被反复清空）。
CREATE TABLE IF NOT EXISTS showcase_rewards (
  user_id     INTEGER PRIMARY KEY,
  amount      INTEGER NOT NULL DEFAULT 0,
  fqdn        TEXT    NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);

-- 组合任务积分奖励：绑定 NodeLoc + Star 项目，两项都完成才一次性发放 3000 积分。
-- user_id 主键保证每账号只发一次；只建表、绝不 RENAME / DROP 业务表。
CREATE TABLE IF NOT EXISTS combo_rewards (
  user_id     INTEGER PRIMARY KEY,
  amount      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

-- ============================================================
--  站点设置默认值
-- ============================================================
-- 第三方登录 · GitHub：默认关闭，需管理员填 Client ID / Secret 并打开开关。
INSERT OR IGNORE INTO settings(key, value) VALUES ('github_enabled', '0');
INSERT OR IGNORE INTO settings(key, value) VALUES ('github_client_id', '');
INSERT OR IGNORE INTO settings(key, value) VALUES ('github_client_secret', '');
INSERT OR IGNORE INTO settings(key, value) VALUES ('github_auto_register', '1');
INSERT OR IGNORE INTO settings(key, value) VALUES ('github_redirect_uri', '');
INSERT OR IGNORE INTO settings(key, value) VALUES ('github_star_repo', 'wcvjk8tnz8-create/Noxc');
INSERT OR IGNORE INTO settings(key, value) VALUES ('github_star_bonus', '5');
-- 按根域名每人注册次数：留空 = 全部不限制。格式 "meoy.top:1,noxc.uk:-1"
-- -1 = 无限；0 = 禁止该后缀；正整数 = 累计次数上限。
INSERT OR IGNORE INTO settings(key, value) VALUES ('root_reg_limits', '');
-- 用户案例展示奖励：首次开启展示一次性发放，0 = 关闭奖励。与 SHOWCASE_REWARD_POINTS 一致。
INSERT OR IGNORE INTO settings(key, value) VALUES ('showcase_reward_points', '6000');

-- ============================================================
--  第三方域名接入（外部域名）
--  独立表，不并入 subdomains：不参与公开统计的全表聚合、不占注册配额、
--  不写 Cloudflare DNS（本站 zone 里没有这些域名）。
--  列表与 WHOIS 一律标「（外部域名）」，解析由域名注册商 / DNSHE 管理。
-- ============================================================
CREATE TABLE IF NOT EXISTS external_domains (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  fqdn        TEXT    NOT NULL UNIQUE,
  user_id     INTEGER NOT NULL,
  note        TEXT    NOT NULL DEFAULT '',
  provider    TEXT    NOT NULL DEFAULT 'dnshe',
  ns1         TEXT    NOT NULL DEFAULT '',
  ns2         TEXT    NOT NULL DEFAULT '',
  zone_id     TEXT    NOT NULL DEFAULT '',
  -- TXT 所有权验证：提交后 pending，DoH 查到 _noxc-verify.<domain> 才转 verified
  verify_token  TEXT  NOT NULL DEFAULT '',
  verify_status TEXT  NOT NULL DEFAULT 'pending',   -- pending | verified
  verified_at   INTEGER,
  -- 已连接的供应商（cloudflare / dnshe）；API key 绝不落库
  provider_key  TEXT  NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
-- 按用户查列表走索引，一次只扫描本人几行，不增加公开读取压力
CREATE INDEX IF NOT EXISTS idx_external_user ON external_domains(user_id);
-- 旧库补列由 src/routes/externalDomains.ts 的 ensureExternalColumns() 幂等完成
-- （CREATE TABLE IF NOT EXISTS 不会给已存在的表加列）

-- ============================================================
--  用户案例展示列：旧库由 src/lib/showcase.ts 的 PRAGMA + ALTER 补齐，
--  这里不写 ALTER（SQLite 无 IF NOT EXISTS，重复部署会直接报错）。
-- ============================================================
