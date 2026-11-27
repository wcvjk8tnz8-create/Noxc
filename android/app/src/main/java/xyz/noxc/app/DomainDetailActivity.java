package xyz.noxc.app;

import android.os.Bundle;
import android.widget.LinearLayout;

import com.google.android.material.appbar.MaterialToolbar;

import org.json.JSONArray;
import org.json.JSONObject;

/** 原生 DNS 记录列表：MaterialToolbar + M3 卡片，路径来自 bootstrap 的 endpoints 契约。 */
public class DomainDetailActivity extends FormActivity {

    public static final String EXTRA_ID = "id";
    public static final String EXTRA_FQDN = "fqdn";

    private LinearLayout list;
    private int id;
    private String fqdn;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_domain_detail);
        bindForm();
        list = findViewById(R.id.detail_list);
        id = getIntent().getIntExtra(EXTRA_ID, 0);
        fqdn = getIntent().getStringExtra(EXTRA_FQDN);
        if (fqdn == null) fqdn = "";

        MaterialToolbar toolbar = findViewById(R.id.toolbar);
        toolbar.setTitle(fqdn.length() > 0 ? fqdn : getString(R.string.detail_title));
        toolbar.setNavigationOnClickListener(v -> finish());
        findViewById(R.id.detail_manage).setOnClickListener(v ->
                api.openInApp(this, "domain?id=" + id + "&tab=records"));
        load();
    }

    private void load() {
        list.removeAllViews();
        list.addView(Ui.title(this, getString(R.string.detail_records)));
        String path = api.endpoint("records", "/api/records/subdomains/{id}/records")
                .replace("{id}", String.valueOf(id));
        api.get(path, r -> {
            list.removeAllViews();
            list.addView(Ui.title(this, getString(R.string.detail_records)));
            LinearLayout hint = Ui.card(this);
            if (!r.ok) {
                hint.addView(Ui.body(this, r.message.length() > 0
                        ? r.message : getString(R.string.err_api)));
                list.addView(hint);
                return;
            }
            JSONArray arr = r.data.optJSONArray("records");
            if (arr == null || arr.length() == 0) {
                hint.addView(Ui.body(this, getString(R.string.detail_empty)));
                list.addView(hint);
                return;
            }
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                LinearLayout c = Ui.card(this);
                c.addView(Ui.title(this, str(o, "type") + "  " + str(o, "host")));
                c.addView(Ui.body(this, str(o, "value")));
                String ttl = o.optString("ttl", "");
                if (ttl.length() > 0) c.addView(Ui.row(this, "TTL", ttl));
                list.addView(c);
            }
        });
    }

    private static String str(JSONObject o, String k) {
        String v = o.optString(k, "");
        return v == null || "null".equals(v) ? "" : v;
    }
}
