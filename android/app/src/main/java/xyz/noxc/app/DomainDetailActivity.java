package xyz.noxc.app;

import android.os.Bundle;
import android.widget.EditText;
import android.widget.LinearLayout;

import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 域名详情 · DNS 记录完全原生操控。
 *
 * 增 / 改 / 删记录、根域名验证发起与确认、强制解锁、域名备注编辑、续期、
 * 释放域名，全部是 App 内 M3 表单，不再跳浏览器也不再只是只读列表。
 * 所有路径来自 bootstrap 的 endpoints 契约。
 */
public class DomainDetailActivity extends OpsActivity {

    public static final String EXTRA_ID = "id";
    public static final String EXTRA_FQDN = "fqdn";

    private static final String[] TYPES = {
            "A", "AAAA", "CNAME", "TXT", "MX", "NS", "SRV", "CAA", "PTR"};

    private int id;
    private String fqdn;

    public interface RecordAction { void onSubmit(String type, String host, String content,
                                                  int ttl, int priority, boolean proxied); }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        id = getIntent().getIntExtra(EXTRA_ID, 0);
        fqdn = getIntent().getStringExtra(EXTRA_FQDN);
        if (fqdn == null) fqdn = "";
        setTitle(fqdn.length() > 0 ? fqdn : getString(R.string.detail_title));
        refresh();
    }

    @Override
    protected void refresh() {
        epGet("records", r -> {
            clear();
            headline(R.string.detail_records);
            if (!r.ok) {
                card(null, r.message.length() > 0 ? r.message : getString(R.string.common_error));
                return;
            }
            renderActions();
            JSONArray items = arr(r.data, "records");
            if (items == null || items.length() == 0) { empty(); return; }
            for (int i = 0; i < items.length(); i++) {
                JSONObject o = items.optJSONObject(i);
                if (o == null) continue;
                renderRecord(o);
            }
        }, "id", String.valueOf(id));
    }

    private void renderActions() {
        card(fqdn, getString(R.string.detail_title),
                button(R.string.dns_add, v -> pick(getString(R.string.dns_type), TYPES,
                        w -> recordForm(TYPES[w], null, (type, host, content, ttl, priority, proxied) -> {
                            JSONObject b = recordBody(type, host, content, ttl, priority, proxied);
                            epPost("records", b, "id", String.valueOf(id));
                        }))),
                button(R.string.dns_verify_start, v ->
                        confirm(getString(R.string.dns_verify_start), fqdn,
                                () -> epPost("verifyStart", "id", String.valueOf(id)))),
                button(R.string.domain_edit, v ->
                        prompt(getString(R.string.domain_edit), getString(R.string.common_input), "",
                                note -> {
                                    JSONObject b = new JSONObject();
                                    try { b.put("note", note); } catch (Exception ignored) { }
                                    epPatch("subdomainUpdate", b, "id", String.valueOf(id));
                                })),
                button(R.string.domain_renew, v ->
                        confirm(getString(R.string.domain_renew), fqdn,
                                () -> epPost("renew", "id", String.valueOf(id)))),
                button(R.string.domain_delete, v ->
                        confirm(getString(R.string.domain_delete), fqdn,
                                () -> epDelete("subdomainDelete", "id", String.valueOf(id)))));
    }

    private void renderRecord(JSONObject o) {
        final String rid = String.valueOf(n(o, "id"));
        final String type = s(o, "type");
        final String host = s(o, "host");
        final String content = s(o, "content");
        boolean locked = o.optBoolean("verify_lock") || o.optInt("verify_lock", 0) == 1;
        String desc = host + "  →  " + content + "  ·  TTL " + n(o, "ttl");
        if (locked) desc += "  ·  " + getString(R.string.dns_locked);
        if (s(o, "comment").length() > 0) desc += "  ·  " + s(o, "comment");

        card(type + "  " + (host.length() > 0 ? host : "@"), desc,
                button(R.string.dns_edit, v -> {
                    if (locked) { toast(R.string.dns_locked); return; }
                    int ti = java.util.Arrays.asList(TYPES).indexOf(type);
                    recordForm(ti >= 0 ? type : "A", o,
                            (t, h, c, ttl, priority, proxied) -> {
                                JSONObject b = recordBody(t, h, c, ttl, priority, proxied);
                                epPatch("recordUpdate", b, "rid", rid);
                            });
                }),
                locked
                        ? button(R.string.dns_verify_confirm, v ->
                        confirm(getString(R.string.dns_verify_confirm), host,
                                () -> epPost("verifyConfirm", "rid", rid)))
                        : null,
                locked
                        ? button(R.string.admin_unlock, v ->
                        confirm(getString(R.string.admin_unlock), host,
                                () -> epPost("forceUnlock", "rid", rid)))
                        : null,
                button(R.string.dns_delete, v ->
                        confirm(getString(R.string.dns_delete), type + " " + host,
                                () -> epDelete("recordDelete", "rid", rid))));
    }

    private JSONObject recordBody(String type, String host, String content,
                                  int ttl, int priority, boolean proxied) {
        JSONObject b = new JSONObject();
        try {
            b.put("type", type);
            b.put("host", host);
            b.put("content", content);
            b.put("ttl", ttl);
            if ("MX".equals(type) || "SRV".equals(type)) b.put("priority", priority);
            b.put("proxied", proxied);
        } catch (Exception ignored) { }
        return b;
    }

    /** 多字段 M3 记录表单：类型固定（新增时先 pick），其余字段原生 EditText。 */
    private void recordForm(String type, JSONObject existing, RecordAction cb) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(Ui.dp(this, 24), Ui.dp(this, 8), Ui.dp(this, 24), 0);

        final EditText eHost = field(box, R.string.dns_host,
                existing == null ? "@" : s(existing, "host"));
        final EditText eContent = field(box, R.string.dns_content,
                existing == null ? "" : s(existing, "content"));
        final EditText eTtl = field(box, R.string.dns_ttl,
                existing == null ? "1" : String.valueOf(n(existing, "ttl") > 0
                        ? n(existing, "ttl") : 1));
        final EditText ePriority = field(box, R.string.dns_priority,
                existing == null ? "10" : String.valueOf(n(existing, "priority")));

        new MaterialAlertDialogBuilder(this)
                .setTitle(type + "  ·  " + (existing == null
                        ? getString(R.string.dns_add) : getString(R.string.dns_edit)))
                .setView(box)
                .setNegativeButton(R.string.common_cancel, null)
                .setPositiveButton(R.string.common_ok, (d, w) -> {
                    int ttl;
                    int priority;
                    try { ttl = Integer.parseInt(eTtl.getText().toString().trim()); }
                    catch (Exception e) { ttl = 1; }
                    try { priority = Integer.parseInt(ePriority.getText().toString().trim()); }
                    catch (Exception e) { priority = 10; }
                    cb.onSubmit(type,
                            eHost.getText().toString().trim(),
                            eContent.getText().toString().trim(),
                            ttl, priority, false);
                })
                .show();
    }

    private EditText field(LinearLayout box, int hint, String preset) {
        EditText e = new EditText(this);
        e.setHint(hint);
        e.setSingleLine(true);
        e.setText(preset);
        e.setSelection(preset.length());
        e.setTextColor(getResources().getColor(R.color.bar_text));
        e.setHintTextColor(getResources().getColor(R.color.bar_dim));
        box.addView(e, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        return e;
    }
}
