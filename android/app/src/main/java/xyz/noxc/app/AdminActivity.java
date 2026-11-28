package xyz.noxc.app;

import android.os.Bundle;
import android.view.View;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 管理后台 · 完全原生。
 *
 * 覆盖后台全部高频写操作：待审 / 全部域名审核与删除、用户积分 / 配额 / 角色 /
 * 封禁解封、验证锁强制解锁、DNS 对账、IP 聚合封禁、审计日志、站点设置、
 * 第三方域名与邮箱申请审核、根域名后端切换。所有路径来自 bootstrap 契约，
 * 服务端 requireAdmin 照常生效（App 里显示管理 tab 只是 UI 显隐）。
 */
public class AdminActivity extends OpsActivity {

    private static final String[] SECTION_KEYS = {
            "stats", "pending", "subdomains", "users", "locks", "audit",
            "ips", "settings", "externalDomains", "emailRequests", "roots"};

    private int section = 0;
    private JSONObject sections = new JSONObject();

    private String[] sectionLabels() {
        return new String[]{
                getString(R.string.admin_overview), getString(R.string.admin_pending),
                getString(R.string.admin_all_domains), getString(R.string.admin_users),
                getString(R.string.admin_locks), getString(R.string.admin_audit),
                getString(R.string.admin_ips), getString(R.string.admin_settings),
                getString(R.string.admin_external), getString(R.string.admin_email_requests),
                getString(R.string.admin_roots)};
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setTitle(R.string.admin_title);
        refresh();
    }

    @Override
    protected void refresh() {
        epGet("adminOverview", r -> {
            if (!r.ok) {
                clear();
                headline(R.string.admin_title);
                card(null, r.message.length() > 0 ? r.message : getString(R.string.common_error));
                return;
            }
            JSONObject s = obj(r.data, "sections");
            sections = s == null ? new JSONObject() : s;
            render();
        });
    }

    private void render() {
        clear();
        headline(R.string.admin_title);
        card(null, getString(R.string.admin_section),
                button(sectionLabels()[section], v ->
                        pick(getString(R.string.admin_section), sectionLabels(),
                                i -> { section = i; render(); })),
                button(R.string.menu_change_site, v -> showSiteDialog()));
        switch (section) {
            case 0: overview(); break;
            case 1: domains("pending", true); break;
            case 2: domains("subdomains", false); break;
            case 3: users(); break;
            case 4: locks(); break;
            case 5: audit(); break;
            case 6: ips(); break;
            case 7: settings(); break;
            case 8: reviews("externalDomains", "adminExternalApprove", "adminExternalReject"); break;
            case 9: reviews("emailRequests", "adminEmailApprove", "adminEmailReject"); break;
            case 10: roots(); break;
            default: overview();
        }
        card(null, null,
                button(R.string.admin_ai_run, v ->
                        confirm(getString(R.string.admin_ai_run),
                                getString(R.string.admin_confirm),
                                () -> epPost("adminAiReviewRun"))),
                button(R.string.admin_export, v ->
                        api.openInApp(this, api.endpoint("adminBackupExport", "/api/admin/backup/export"))));
    }

    /* ── 概览 ── */
    private void overview() {
        JSONObject st = obj(sections, "stats");
        if (st == null) { card(null, getString(R.string.common_empty)); return; }
        card(getString(R.string.admin_overview),
                "users=" + n(st, "users") + "  domains=" + n(st, "subdomains")
                        + "  pending=" + n(st, "pending")
                        + "  records=" + n(st, "records") + "  locked=" + n(st, "locked"));
        for (int i = 1; i < SECTION_KEYS.length; i++) {
            final int idx = i;
            card(null, sectionLabels()[i] + "  ·  " + countLabel(SECTION_KEYS[i]),
                    button(sectionLabels()[idx], v -> { section = idx; render(); }));
        }
    }

    private String countLabel(String key) {
        JSONObject o = obj(sections, key);
        if (o == null) return "-";
        JSONArray a = arr(o, "items");
        return a == null ? "-" : String.valueOf(a.length());
    }

    /* ── 域名审核 / 全部域名 ── */
    private void domains(String key, boolean pendingOnly) {
        JSONObject o = obj(sections, key);
        JSONArray items = o == null ? null : arr(o, "items");
        if (items == null || items.length() == 0) { empty(); return; }
        for (int i = 0; i < items.length(); i++) {
            JSONObject d = items.optJSONObject(i);
            if (d == null) continue;
            final String id = String.valueOf(n(d, "id"));
            final String fqdn = s(d, "fqdn");
            String desc = s(d, "status") + "  ·  " + s(d, "owner_email")
                    + "  ·  records " + n(d, "record_count");
            if (s(d, "reason").length() > 0) desc += "  ·  " + s(d, "reason");
            View approve = pendingOnly
                    ? button(R.string.admin_approve, v ->
                    confirm(getString(R.string.admin_approve), fqdn,
                            () -> epPost("adminApprove", "id", id))) : null;
            card(fqdn, desc,
                    approve,
                    button(R.string.admin_reject, v ->
                            prompt(getString(R.string.admin_reject),
                                    getString(R.string.admin_reason), "",
                                    reason -> {
                                        JSONObject b = new JSONObject();
                                        try { b.put("reason", reason); } catch (Exception ignored) { }
                                        epPost("adminReject", b, "id", id);
                                    })),
                    button(R.string.admin_suspend, v ->
                            prompt(getString(R.string.admin_suspend),
                                    getString(R.string.admin_reason), "",
                                    reason -> {
                                        JSONObject b = new JSONObject();
                                        try { b.put("reason", reason); } catch (Exception ignored) { }
                                        epPost("adminSuspend", b, "id", id);
                                    })),
                    button(R.string.admin_restore, v ->
                            epPost("adminRestore", "id", id)),
                    button(R.string.admin_reconcile, v ->
                            confirm(getString(R.string.admin_reconcile), fqdn,
                                    () -> epPost("adminReconcile", "id", id))),
                    button(R.string.admin_delete, v ->
                            confirm(getString(R.string.admin_delete), fqdn,
                                    () -> epDelete("adminSubdomainDelete", "id", id))));
        }
    }

    /* ── 用户 ── */
    private void users() {
        JSONObject o = obj(sections, "users");
        JSONArray items = o == null ? null : arr(o, "items");
        if (items == null || items.length() == 0) { empty(); return; }
        for (int i = 0; i < items.length(); i++) {
            JSONObject u = items.optJSONObject(i);
            if (u == null) continue;
            final String id = String.valueOf(n(u, "id"));
            final String email = s(u, "email");
            String desc = s(u, "role") + "  ·  " + s(u, "status")
                    + "  ·  quota " + n(u, "quota")
                    + "  ·  points " + s(u, "points")
                    + "  ·  domains " + n(u, "sub_count");
            card(email, desc,
                    button(R.string.admin_points, v ->
                            prompt(getString(R.string.admin_points),
                                    getString(R.string.common_input),
                                    String.valueOf(n(u, "points")),
                                    val -> {
                                        JSONObject b = new JSONObject();
                                        try { b.put("set", val); b.put("reason", "App 调整"); }
                                        catch (Exception ignored) { }
                                        epPost("adminUserPoints", b, "id", id);
                                    })),
                    button(R.string.admin_quota, v ->
                            prompt(getString(R.string.admin_quota), "-1 = ∞",
                                    String.valueOf(n(u, "quota")),
                                    val -> {
                                        JSONObject b = new JSONObject();
                                        try { b.put("quota", Integer.parseInt(val)); }
                                        catch (Exception ignored) { return; }
                                        epPost("adminUserQuota", b, "id", id);
                                    })),
                    button(R.string.admin_role, v ->
                            pick(getString(R.string.admin_role),
                                    new String[]{"user", "admin"},
                                    w -> {
                                        JSONObject b = new JSONObject();
                                        try { b.put("role", w == 1 ? "admin" : "user"); }
                                        catch (Exception ignored) { }
                                        epPost("adminUserQuota", b, "id", id);
                                    })),
                    button(R.string.admin_ban, v ->
                            prompt(getString(R.string.admin_ban),
                                    getString(R.string.admin_reason), "",
                                    reason -> confirm(getString(R.string.admin_ban), email, () -> {
                                        JSONObject b = new JSONObject();
                                        try { b.put("reason", reason); b.put("purgeDns", false); }
                                        catch (Exception ignored) { }
                                        epPost("adminUserBan", b, "id", id);
                                    }))),
                    button(R.string.admin_unban, v ->
                            epPost("adminUserUnban", "id", id)));
        }
    }

    /* ── 验证锁 ── */
    private void locks() {
        JSONObject o = obj(sections, "locks");
        JSONArray items = o == null ? null : arr(o, "items");
        if (items == null || items.length() == 0) { empty(); return; }
        for (int i = 0; i < items.length(); i++) {
            JSONObject l = items.optJSONObject(i);
            if (l == null) continue;
            final String rid = String.valueOf(n(l, "id"));
            card(s(l, "name"), s(l, "fqdn") + "  ·  " + s(l, "owner_email")
                            + "  ·  " + s(l, "type"),
                    button(R.string.admin_unlock, v ->
                            confirm(getString(R.string.admin_unlock), s(l, "name"),
                                    () -> epPost("forceUnlock", "rid", rid))));
        }
    }

    /* ── 审计日志 ── */
    private void audit() {
        JSONObject o = obj(sections, "audit");
        JSONArray items = o == null ? null : arr(o, "items");
        if (items == null || items.length() == 0) { empty(); return; }
        int lim = Math.min(items.length(), 60);
        for (int i = 0; i < lim; i++) {
            JSONObject a = items.optJSONObject(i);
            if (a == null) continue;
            card(s(a, "action") + "  ·  " + s(a, "email"),
                    s(a, "target") + "  ·  " + s(a, "detail"));
        }
    }

    /* ── IP 聚合 ── */
    private void ips() {
        JSONObject o = obj(sections, "ips");
        JSONArray items = o == null ? null : arr(o, "items");
        card(null, getString(R.string.admin_ips),
                button(R.string.admin_ban, v ->
                        prompt(getString(R.string.admin_ban), "1.2.3.4", "",
                                ip -> prompt(getString(R.string.admin_ban),
                                        getString(R.string.admin_reason), "",
                                        reason -> {
                                            JSONObject b = new JSONObject();
                                            try { b.put("ip", ip); b.put("reason", reason);
                                                b.put("banIp", true); b.put("purgeDns", false); }
                                            catch (Exception ignored) { }
                                            epPost("adminIpBan", b);
                                        }))),
                button(R.string.admin_unban, v ->
                        prompt(getString(R.string.admin_unban), "1.2.3.4", "",
                                ip -> {
                                    JSONObject b = new JSONObject();
                                    try { b.put("ip", ip); } catch (Exception ignored) { }
                                    epPost("adminIpUnban", b);
                                })));
        if (items == null || items.length() == 0) return;
        for (int i = 0; i < items.length(); i++) {
            JSONObject p = items.optJSONObject(i);
            if (p == null) continue;
            card(s(p, "ip"), "accounts=" + n(p, "count") + "  ·  " + s(p, "emails"));
        }
    }

    /* ── 站点设置：常用开关直接改，全部走 POST /api/admin/settings ── */
    private void settings() {
        JSONObject o = obj(sections, "settings");
        JSONObject it = o == null ? null : obj(o, "items");
        if (it == null) it = o == null ? new JSONObject() : o;
        final JSONObject cfg = it;

        card(getString(R.string.admin_settings), null,
                setting(cfg, "site_name", "siteName", R.string.admin_site_name, false),
                setting(cfg, "announcement", "announcement", R.string.admin_announcement, false),
                setting(cfg, "default_quota", "defaultQuota", R.string.admin_default_quota, true),
                setting(cfg, "domain_valid_days", "domainValidDays", R.string.admin_valid_days, true),
                setting(cfg, "renew_window_days", "renewWindowDays", R.string.admin_renew_window, true),
                setting(cfg, "max_accounts_per_ip", "maxAccountsPerIp", R.string.admin_max_per_ip, true),
                setting(cfg, "apply_paused_message", "applyPausedMessage", R.string.admin_apply_paused_msg, false));

        card(null, null,
                toggle("apply_paused", "applyPaused", R.string.admin_apply_paused, cfg),
                toggle("mail_verify_required", "mailVerifyRequired", R.string.admin_verify_required, cfg),
                toggle("ai_review_enabled", "aiEnabled", R.string.admin_ai_enabled, cfg),
                toggle("captcha_enabled", "captchaEnabled", R.string.admin_captcha, cfg),
                toggle("dns_paused_roots", "dnsPausedRoots", R.string.dns_paused, cfg));
    }

    private View setting(JSONObject cfg, String rawKey, String postKey, int label, boolean numeric) {
        String cur = cfg.optString(rawKey, "");
        return button(getString(label) + (cur.length() > 0 ? "  ·  " + cur : ""), v ->
                prompt(getString(label), getString(R.string.common_input), cur, val -> {
                    JSONObject b = new JSONObject();
                    try {
                        if (numeric && val.matches("-?\\d+")) b.put(postKey, Integer.parseInt(val));
                        else b.put(postKey, val);
                    } catch (Exception ignored) { return; }
                    epPost("adminSettings", b);
                }));
    }

    private View toggle(String rawKey, String postKey, int label, JSONObject cfg) {
        String cur = cfg.optString(rawKey, "");
        boolean on = "1".equals(cur) || "true".equals(cur);
        if ("dns_paused_roots".equals(rawKey)) {
            return button(getString(label) + "  ·  " + (cur.length() > 0 ? cur : "-"), v ->
                    prompt(getString(label), "a.com,b.com", cur, val -> {
                        JSONObject b = new JSONObject();
                        try { b.put(postKey, val); } catch (Exception ignored) { }
                        epPost("adminSettings", b);
                    }));
        }
        return button(getString(label) + (on ? "  ✓" : "  ○"), v -> {
            JSONObject b = new JSONObject();
            try { b.put(postKey, !on); } catch (Exception ignored) { }
            epPost("adminSettings", b);
        });
    }

    /* ── 通用审核列表（第三方域名 / 邮箱申请） ── */
    private void reviews(String key, String approveKey, String rejectKey) {
        JSONObject o = obj(sections, key);
        JSONArray items = o == null ? null : arr(o, "items");
        if (items == null || items.length() == 0) { empty(); return; }
        for (int i = 0; i < items.length(); i++) {
            JSONObject d = items.optJSONObject(i);
            if (d == null) continue;
            final String id = String.valueOf(n(d, "id"));
            String title = s(d, "domain");
            if (title.length() == 0) title = s(d, "email");
            if (title.length() == 0) title = s(d, "fqdn");
            card(title, s(d, "status") + "  ·  " + s(d, "owner_email")
                            + "  ·  " + s(d, "email"),
                    button(R.string.admin_approve, v ->
                            confirm(getString(R.string.admin_approve), title,
                                    () -> epPost(approveKey, "id", id))),
                    button(R.string.admin_reject, v ->
                            prompt(getString(R.string.admin_reject),
                                    getString(R.string.admin_reason), "",
                                    reason -> {
                                        JSONObject b = new JSONObject();
                                        try { b.put("reason", reason); } catch (Exception ignored) { }
                                        epPost(rejectKey, b, "id", id);
                                    })));
        }
    }

    /* ── 根域名 ── */
    private void roots() {
        JSONObject o = obj(sections, "roots");
        JSONArray items = o == null ? null : arr(o, "items");
        if (items == null || items.length() == 0) { empty(); return; }
        for (int i = 0; i < items.length(); i++) {
            JSONObject d = items.optJSONObject(i);
            if (d == null) continue;
            final String domain = s(d, "domain");
            if (domain.length() == 0) continue;
            card(domain, "backend=" + s(d, "backend") + "  ·  " + s(d, "status"),
                    button(R.string.admin_role, v ->
                            pick("backend", new String[]{"cloudflare", "anyns", "spaceship", "seus"},
                                    w -> {
                                        String[] bs = {"cloudflare", "anyns", "spaceship", "seus"};
                                        JSONObject b = new JSONObject();
                                        try { b.put("backend", bs[w]); } catch (Exception ignored) { }
                                        epPost("adminRootBackend", b, "domain", domain);
                                    })),
                    button(R.string.admin_restore, v ->
                            epPost("adminRootRestore", "domain", domain)));
        }
    }

    private void showSiteDialog() {
        // 站点切换仍复用主界面入口；这里只提示去「我的 → 长按 Logo」
        toast(R.string.site_body);
    }
}
