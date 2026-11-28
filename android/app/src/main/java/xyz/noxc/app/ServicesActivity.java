package xyz.noxc.app;

import android.os.Bundle;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 用户端「服务」· 全部原生操控。
 *
 * 通知、工单（新建 / 回复 / 关闭）、兑换码、域名转让、滥用举报、
 * 第三方域名接入（新增 / 验证 / 连接 / 检查 NS / 删除）、账号资料与改密、
 * NS 委派、社区帖子 —— 全部是 App 内 M3 表单与列表，没有一项要跳浏览器。
 */
public class ServicesActivity extends OpsActivity {

    private int section = 0;

    public interface ItemsAction { void on(JSONArray items); }

    private String[] labels() {
        return new String[]{
                getString(R.string.services_notifications), getString(R.string.services_tickets),
                getString(R.string.services_redeem), getString(R.string.services_transfer),
                getString(R.string.services_abuse), getString(R.string.services_external),
                getString(R.string.services_profile), getString(R.string.services_delegation),
                getString(R.string.services_community)};
    }

    private static final String[] ABUSE_TYPES = {
            "phishing", "malware", "spam", "illegal", "trademark", "fraud", "other"};

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setTitle(R.string.services_title);
        refresh();
    }

    @Override
    protected void refresh() {
        clear();
        headline(R.string.services_title);
        card(null, getString(R.string.admin_section),
                button(labels()[section], v -> pick(getString(R.string.admin_section),
                        labels(), i -> { section = i; refresh(); })));
        switch (section) {
            case 0: notifications(); break;
            case 1: tickets(); break;
            case 2: redeem(); break;
            case 3: transfer(); break;
            case 4: abuse(); break;
            case 5: external(); break;
            case 6: profile(); break;
            case 7: delegation(); break;
            case 8: chat(); break;
            default: notifications();
        }
    }

    private JSONArray items(Api.Reply r, String... keys) {
        if (!r.ok) return null;
        for (String k : keys) {
            JSONArray a = arr(r.data, k);
            if (a != null) return a;
        }
        return null;
    }

    private void load(String key, ItemsAction cb, String... vars) {
        epGet(key, r -> {
            if (!r.ok) { card(null, r.message.length() > 0 ? r.message : getString(R.string.common_error)); return; }
            cb.on(items(r, "items", "notifications", "posts", "records"));
        }, vars);
    }

    /* ── 通知 ── */
    private void notifications() {
        card(null, null,
                button(R.string.services_mark_read, v -> epPost("notificationsReadAll")));
        load("notifications", items -> {
            if (items == null || items.length() == 0) { empty(); return; }
            for (int i = 0; i < items.length(); i++) {
                JSONObject o = items.optJSONObject(i);
                if (o == null) continue;
                final String id = String.valueOf(n(o, "id"));
                card(s(o, "title"), s(o, "body") + "  ·  " + s(o, "created_at"),
                        button(R.string.admin_delete, v ->
                                epDelete("notificationDelete", "id", id)));
            }
        });
    }

    /* ── 工单 ── */
    private void tickets() {
        card(null, null,
                button(R.string.services_ticket_new, v ->
                        prompt(getString(R.string.services_subject),
                                getString(R.string.common_input), "", subject ->
                                prompt(getString(R.string.services_message),
                                        getString(R.string.common_input), "", content -> {
                                            JSONObject b = new JSONObject();
                                            try { b.put("subject", subject); b.put("content", content); }
                                            catch (Exception ignored) { }
                                            epPost("ticketCreate", b);
                                        }))));
        load("tickets", items -> {
            if (items == null || items.length() == 0) { empty(); return; }
            for (int i = 0; i < items.length(); i++) {
                JSONObject o = items.optJSONObject(i);
                if (o == null) continue;
                final String id = String.valueOf(n(o, "id"));
                card(s(o, "subject"), s(o, "status") + "  ·  #" + id,
                        button(R.string.services_ticket_reply, v ->
                                prompt(getString(R.string.services_ticket_reply),
                                        getString(R.string.common_input), "", content -> {
                                            JSONObject b = new JSONObject();
                                            try { b.put("content", content); } catch (Exception ignored) { }
                                            epPost("ticketReply", b, "id", id);
                                        })),
                        button(R.string.ticket_close, v -> epPost("ticketClose", "id", id)));
            }
        });
    }

    /* ── 兑换码 ── */
    private void redeem() {
        card(getString(R.string.services_redeem), null,
                button(R.string.services_redeem, v ->
                        prompt(getString(R.string.services_code),
                                getString(R.string.common_input), "", code -> {
                                    JSONObject b = new JSONObject();
                                    try { b.put("code", code); } catch (Exception ignored) { }
                                    epPost("redeem", b);
                                })));
        load("redeemMine", items -> {
            if (items == null || items.length() == 0) return;
            for (int i = 0; i < items.length(); i++) {
                JSONObject o = items.optJSONObject(i);
                if (o == null) continue;
                card(s(o, "code"), s(o, "created_at") + "  ·  " + s(o, "delta"));
            }
        });
    }

    /* ── 域名转让 ── */
    private void transfer() {
        card(getString(R.string.services_transfer), null,
                button(R.string.services_transfer, v ->
                        prompt(getString(R.string.services_domain), "id", "", sid ->
                                prompt(getString(R.string.services_target), "a@b.com", "", email ->
                                        confirm(getString(R.string.services_transfer),
                                                getString(R.string.admin_confirm), () -> {
                                                    JSONObject b = new JSONObject();
                                                    try {
                                                        b.put("subdomainId", Integer.parseInt(sid));
                                                        b.put("toEmail", email);
                                                        b.put("agreed", true);
                                                    } catch (Exception ignored) { return; }
                                                    epPost("transferCommit", b);
                                                })))));
        load("transferMine", items -> {
            if (items == null || items.length() == 0) return;
            for (int i = 0; i < items.length(); i++) {
                JSONObject o = items.optJSONObject(i);
                if (o == null) continue;
                card(s(o, "fqdn"), s(o, "status") + "  ·  " + s(o, "to_email"));
            }
        });
    }

    /* ── 滥用举报 ── */
    private void abuse() {
        card(getString(R.string.services_abuse), null,
                button(R.string.services_abuse, v ->
                        pick(getString(R.string.services_abuse), ABUSE_TYPES, w ->
                                prompt(getString(R.string.services_domain), "a.example.com", "", domain ->
                                        prompt(getString(R.string.services_message),
                                                getString(R.string.common_input), "", desc -> {
                                                    JSONObject b = new JSONObject();
                                                    try {
                                                        b.put("domain", domain);
                                                        b.put("type", ABUSE_TYPES[w]);
                                                        b.put("description", desc);
                                                    } catch (Exception ignored) { }
                                                    epPost("abuse", b);
                                                })))));
        load("abuseMine", items -> {
            if (items == null || items.length() == 0) return;
            for (int i = 0; i < items.length(); i++) {
                JSONObject o = items.optJSONObject(i);
                if (o == null) continue;
                card(s(o, "domain"), s(o, "type") + "  ·  " + s(o, "status"));
            }
        });
    }

    /* ── 第三方域名 ── */
    private void external() {
        card(getString(R.string.services_external), null,
                button(R.string.services_external_add, v ->
                        prompt(getString(R.string.services_domain), "example.com", "", domain -> {
                            JSONObject b = new JSONObject();
                            try { b.put("domain", domain); } catch (Exception ignored) { }
                            epPost("externalDomains", b);
                        })));
        load("externalDomains", items -> {
            if (items == null || items.length() == 0) { empty(); return; }
            for (int i = 0; i < items.length(); i++) {
                JSONObject o = items.optJSONObject(i);
                if (o == null) continue;
                final String id = String.valueOf(n(o, "id"));
                card(s(o, "fqdn"), s(o, "status") + "  ·  " + s(o, "verify_status")
                                + "  ·  NS " + s(o, "ns1") + " / " + s(o, "ns2"),
                        button(R.string.services_external_verify, v ->
                                epPost("externalDomainVerify", "id", id)),
                        button(R.string.services_external_connect, v ->
                                epPost("externalDomainConnect", "id", id)),
                        button(R.string.services_external_check_ns, v ->
                                epPost("externalDomainCheckNs", "id", id)),
                        button(R.string.admin_delete, v ->
                                confirm(getString(R.string.admin_delete), s(o, "fqdn"),
                                        () -> epDelete("externalDomainDelete", "id", id))));
            }
        });
    }

    /* ── 账号资料 / 改密 ── */
    private void profile() {
        card(getString(R.string.services_profile), null,
                button(getString(R.string.services_profile), v ->
                        prompt("nickname", getString(R.string.common_input), "", nick -> {
                            JSONObject b = new JSONObject();
                            try { b.put("nickname", nick); } catch (Exception ignored) { }
                            epPut("profile", b);
                        })),
                button(R.string.password_send_code, v ->
                        epPost("passwordSendCode")),
                button(R.string.password_change, v ->
                        prompt(getString(R.string.register_code),
                                getString(R.string.common_input), "", code ->
                                prompt(getString(R.string.forgot_new_password),
                                        getString(R.string.common_input), "", fresh -> {
                                            JSONObject b = new JSONObject();
                                            try { b.put("code", code); b.put("newPassword", fresh); }
                                            catch (Exception ignored) { }
                                            epPost("passwordChange", b);
                                        }))));
        epGet("profile", r -> {
            if (!r.ok) return;
            JSONObject p = obj(r.data, "profile");
            if (p == null) p = r.data;
            card(s(p, "nickname"), s(p, "bio") + "  ·  " + s(p, "email"));
        });
    }

    /* ── NS 委派 ── */
    private void delegation() {
        card(getString(R.string.services_delegation), null,
                button(getString(R.string.delegationProviders), v ->
                        epGet("delegationProviders", r -> {
                            JSONArray a = items(r, "items");
                            if (a == null) return;
                            String[] names = new String[a.length()];
                            for (int i = 0; i < a.length(); i++) {
                                JSONObject o = a.optJSONObject(i);
                                names[i] = o == null ? "" : s(o, "key") + " " + s(o, "name");
                            }
                            pick(getString(R.string.delegationProviders), names, w -> {
                                JSONObject o = a.optJSONObject(w);
                                prompt(getString(R.string.services_domain), "id", "", sid -> {
                                    JSONObject b = new JSONObject();
                                    try { b.put("provider", o == null ? "" : s(o, "key")); }
                                    catch (Exception ignored) { }
                                    epPost("delegation", b, "id", sid);
                                });
                            });
                        })));
    }

    /* ── 社区帖子 ── */
    private void chat() {
        card(getString(R.string.services_community), null,
                button(R.string.services_ticket_new, v ->
                        prompt(getString(R.string.services_subject),
                                getString(R.string.common_input), "", title ->
                                prompt(getString(R.string.services_message),
                                        getString(R.string.common_input), "", content -> {
                                            JSONObject b = new JSONObject();
                                            try { b.put("title", title); b.put("content", content); }
                                            catch (Exception ignored) { }
                                            epPost("chatPosts", b);
                                        }))));
        load("chatPosts", items -> {
            if (items == null || items.length() == 0) { empty(); return; }
            for (int i = 0; i < items.length(); i++) {
                JSONObject o = items.optJSONObject(i);
                if (o == null) continue;
                final String id = String.valueOf(n(o, "id"));
                card(s(o, "title"), s(o, "content"),
                        button(R.string.services_ticket_reply, v ->
                                prompt(getString(R.string.services_message),
                                        getString(R.string.common_input), "", content -> {
                                            JSONObject b = new JSONObject();
                                            try { b.put("content", content); } catch (Exception ignored) { }
                                            epPost("chatReply", b, "id", id);
                                        })));
            }
        });
    }
}
