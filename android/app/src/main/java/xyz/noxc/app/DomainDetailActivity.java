package xyz.noxc.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

/** 原生 DNS 记录列表：直接读 /api/records/subdomains/{id}/records。 */
public class DomainDetailActivity extends Activity {

    public static final String EXTRA_ID = "id";
    public static final String EXTRA_FQDN = "fqdn";

    private Api api;
    private LinearLayout list;
    private int id;
    private String fqdn;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_domain_detail);
        api = new Api(this);
        list = findViewById(R.id.detail_list);
        id = getIntent().getIntExtra(EXTRA_ID, 0);
        fqdn = getIntent().getStringExtra(EXTRA_FQDN);
        if (fqdn == null) fqdn = "";

        TextView t = findViewById(R.id.detail_title);
        t.setText(fqdn.length() > 0 ? fqdn : getString(R.string.detail_title));
        findViewById(R.id.detail_back).setOnClickListener(v -> finish());
        findViewById(R.id.detail_manage).setOnClickListener(v -> {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW,
                        Uri.parse(api.web("domain?id=" + id + "&tab=records"))));
            } catch (Exception e) {
                Toast.makeText(this, R.string.no_browser, Toast.LENGTH_SHORT).show();
            }
        });
        load();
    }

    private void load() {
        list.removeAllViews();
        list.addView(Ui.title(this, getString(R.string.detail_records)));
        api.get("/api/records/subdomains/" + id + "/records", r -> {
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
