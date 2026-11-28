package xyz.noxc.app;

import android.net.Uri;
import android.os.Bundle;
import android.widget.EditText;
import android.widget.LinearLayout;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 申请子域名 · 完全原生。
 *
 * 查名 / 查价 → 原生滑块拼图（后台开启时才出现）→ 提交申请，全部在 App 内完成，
 * 不跳浏览器。滑块票据是服务端签发的一次性 passToken，App 不绕过任何校验。
 */
public class ApplyActivity extends OpsActivity {

    private EditText labelInput, noteInput;
    private String root = "";
    private LinearLayout result;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setTitle(R.string.apply_title);
        String pre = getIntent().getStringExtra("label");
        String preRoot = getIntent().getStringExtra("root");
        render();
        if (pre != null && pre.length() > 0) labelInput.setText(pre);
        if (preRoot != null && preRoot.length() > 0) root = preRoot;
    }

    @Override
    protected void refresh() { render(); }

    private void render() {
        clear();
        headline(R.string.apply_title);

        LinearLayout form = Ui.card(this);
        labelInput = new EditText(this);
        labelInput.setHint(R.string.apply_label);
        labelInput.setSingleLine(true);
        labelInput.setTextColor(getResources().getColor(R.color.bar_text));
        labelInput.setHintTextColor(getResources().getColor(R.color.bar_dim));
        labelInput.setBackground(Ui.shape(this,
                getResources().getColor(R.color.input_bg),
                getResources().getColor(R.color.bar_hair), 14));
        labelInput.setPadding(Ui.dp(this, 14), Ui.dp(this, 10), Ui.dp(this, 14), Ui.dp(this, 10));
        form.addView(labelInput, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        noteInput = new EditText(this);
        noteInput.setHint(R.string.apply_note);
        noteInput.setSingleLine(true);
        noteInput.setTextColor(getResources().getColor(R.color.bar_text));
        noteInput.setHintTextColor(getResources().getColor(R.color.bar_dim));
        noteInput.setBackground(Ui.shape(this,
                getResources().getColor(R.color.input_bg),
                getResources().getColor(R.color.bar_hair), 14));
        noteInput.setPadding(Ui.dp(this, 14), Ui.dp(this, 10), Ui.dp(this, 14), Ui.dp(this, 10));
        LinearLayout.LayoutParams np = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        np.setMargins(0, Ui.dp(this, 10), 0, 0);
        form.addView(noteInput, np);

        form.addView(button(R.string.apply_root, v -> pickRoots()), topParams());
        form.addView(button(R.string.lookup_button, v -> check()), topParams());
        form.addView(button(R.string.apply_submit, v -> submit()), topParams());
        list.addView(form);

        result = new LinearLayout(this);
        result.setOrientation(LinearLayout.VERTICAL);
        list.addView(result);

        api.bootstrap(false, b -> {
            if (!b.ok) return;
            JSONObject s = obj(b.data, "site");
            JSONArray roots = s == null ? null : arr(s, "rootDomains");
            if (roots != null && roots.length() > 0) root = roots.optString(0, "");
        });
    }

    private void pickRoots() {
        api.bootstrap(false, b -> {
            JSONObject s = b.ok ? obj(b.data, "site") : null;
            JSONArray roots = s == null ? null : arr(s, "rootDomains");
            if (roots == null || roots.length() == 0) { toast(R.string.common_error); return; }
            String[] names = new String[roots.length()];
            for (int i = 0; i < roots.length(); i++) names[i] = roots.optString(i, "");
            pick(getString(R.string.apply_root), names, i -> { root = names[i]; renderResult(root); });
        });
    }

    private void renderResult(String text) {
        LinearLayout c = Ui.card(this);
        c.addView(Ui.body(this, text));
        result.removeAllViews();
        result.addView(c);
    }

    private String label() {
        return labelInput.getText().toString().trim().toLowerCase()
                .replaceAll("[^a-z0-9-]", "");
    }

    private void check() {
        final String l = label();
        if (l.length() == 0) { toast(R.string.lookup_empty); return; }
        if (root.length() == 0) { toast(R.string.apply_root); return; }
        busy(true);
        api.get(api.endpoint("check", "/api/subdomains/check") + "?label="
                + Uri.encode(l) + "&root=" + Uri.encode(root), r -> {
            busy(false);
            if (!r.ok) { renderResult(r.message); return; }
            JSONObject d = r.data;
            String msg = d.optString("fqdn", l + "." + root) + "\n"
                    + (d.optBoolean("available")
                    ? getString(R.string.lookup_available)
                    : getString(R.string.lookup_taken) + " " + d.optString("message", ""))
                    + "\n" + getString(R.string.apply_cost, String.valueOf(n(d, "cost")))
                    + "  ·  " + getString(R.string.lookup_points) + " " + d.optInt("points", 0);
            if (d.optBoolean("applyPaused")) msg += "\n" + d.optString("applyPausedMessage", "");
            renderResult(msg);
        });
    }

    private void submit() {
        final String l = label();
        if (l.length() == 0) { toast(R.string.lookup_empty); return; }
        if (root.length() == 0) { toast(R.string.apply_root); return; }
        CaptchaDialog.show(this, api, passToken -> {
            if (passToken == null) { toast(R.string.captcha_retry); return; }
            JSONObject b = new JSONObject();
            try {
                b.put("label", l);
                b.put("root", root);
                b.put("note", noteInput.getText().toString().trim());
                if (passToken.length() > 0) b.put("captchaToken", passToken);
            } catch (Exception ignored) { }
            busy(true);
            api.epPost("apply", b, r -> {
                busy(false);
                toast(r.ok ? getString(R.string.apply_success)
                        : (r.message.length() > 0 ? r.message : getString(R.string.common_error)));
                if (r.ok) {
                    setResult(RESULT_OK);
                    finish();
                }
            });
        });
    }
}
