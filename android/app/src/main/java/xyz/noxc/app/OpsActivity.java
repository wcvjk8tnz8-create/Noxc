package xyz.noxc.app;

import android.os.Bundle;
import android.view.View;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.google.android.material.appbar.MaterialToolbar;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.android.material.progressindicator.LinearProgressIndicator;

import org.json.JSONObject;

/**
 * 所有「原生操控页」的通用骨架：管理后台、DNS 记录、申请域名、用户服务都继承它。
 *
 * 一套 M3 卡片列表 + 对话框，覆盖几十个写操作，避免每个功能复制一遍
 * Toolbar / 下拉刷新 / 错误提示 / 二次确认。所有请求走 Api 的 endpoints 契约。
 */
public abstract class OpsActivity extends AppCompatActivity {

    protected Api api;
    protected LinearLayout list;
    private SwipeRefreshLayout swipe;
    private LinearProgressIndicator progress;

    public interface Action { void run(); }
    public interface TextAction { void run(String value); }
    public interface IndexAction { void run(int index); }
    public interface ReplyAction { void on(Api.Reply r); }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_ops);
        api = new Api(this);
        list = findViewById(R.id.ops_list);
        swipe = findViewById(R.id.ops_swipe);
        progress = findViewById(R.id.ops_progress);
        MaterialToolbar toolbar = findViewById(R.id.toolbar);
        toolbar.setNavigationOnClickListener(v -> finish());
        swipe.setOnRefreshListener(this::refresh);
    }

    /* 必须是 public：Activity.setTitle(int) 是 public，
       protected 会以「降低访问权限」被 javac 拒绝编译（CI 真跑踩过）。 */
    public void setTitle(String s) {
        ((MaterialToolbar) findViewById(R.id.toolbar)).setTitle(s);
    }

    @Override
    public void setTitle(int resId) {
        ((MaterialToolbar) findViewById(R.id.toolbar)).setTitle(resId);
    }

    protected void clear() { list.removeAllViews(); }

    /** 页面渲染完成后调用：字体统一为内置 OFL 字体，卡片错落入场。 */
    protected void animatePage() {
        Motion.applyFont(list);
        Motion.stagger(list);
    }

    protected void busy(boolean on) {
        progress.setVisibility(on ? View.VISIBLE : View.GONE);
        if (!on) swipe.setRefreshing(false);
    }

    protected void toast(String s) {
        Toast.makeText(this, s == null || s.length() == 0
                ? getString(R.string.common_error) : s, Toast.LENGTH_SHORT).show();
    }

    protected void toast(int resId) { toast(getString(resId)); }

    /** 一张 M3 卡片：标题 + 正文 + 若干 M3 操作按钮。 */
    protected LinearLayout card(CharSequence title, CharSequence body, View... actions) {
        LinearLayout c = Ui.card(this);
        if (title != null) c.addView(Ui.title(this, title));
        if (body != null && String.valueOf(body).length() > 0) c.addView(Ui.body(this, body));
        for (int i = 0; i < actions.length; i++) {
            if (actions[i] == null) continue;
            c.addView(actions[i], i == 0 && (title != null || body != null)
                    ? topParams() : new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        }
        list.addView(c);
        Motion.applyFont(c);
        Motion.pop(c);
        return c;
    }

    protected LinearLayout.LayoutParams topParams() {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, Ui.dp(this, 10), 0, 0);
        return lp;
    }

    protected TextView button(int resId, View.OnClickListener click) {
        return Ui.pill(this, getString(resId), click);
    }

    protected TextView button(String text, View.OnClickListener click) {
        return Ui.pill(this, text, click);
    }

    protected void headline(int resId) { list.addView(Ui.headline(this, getString(resId))); }

    protected void empty() {
        LinearLayout c = Ui.card(this);
        c.addView(Ui.body(this, getString(R.string.common_empty)));
        list.addView(c);
    }

    /* ── 对话框：全部是 Material 3 ── */

    protected void confirm(String title, String msg, Action yes) {
        new MaterialAlertDialogBuilder(this)
                .setTitle(title)
                .setMessage(msg)
                .setNegativeButton(R.string.common_cancel, null)
                .setPositiveButton(R.string.common_ok, (d, w) -> yes.run())
                .show();
    }

    protected void prompt(String title, String hint, String preset, TextAction yes) {
        final EditText input = new EditText(this);
        input.setHint(hint);
        input.setSingleLine(true);
        input.setTextColor(getResources().getColor(R.color.bar_text));
        input.setHintTextColor(getResources().getColor(R.color.bar_dim));
        if (preset != null) {
            input.setText(preset);
            input.setSelection(preset.length());
        }
        LinearLayout box = new LinearLayout(this);
        box.setPadding(Ui.dp(this, 24), Ui.dp(this, 8), Ui.dp(this, 24), 0);
        box.addView(input, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        new MaterialAlertDialogBuilder(this)
                .setTitle(title)
                .setView(box)
                .setNegativeButton(R.string.common_cancel, null)
                .setPositiveButton(R.string.common_ok, (d, w) ->
                        yes.run(input.getText().toString().trim()))
                .show();
    }

    protected void pick(String title, String[] items, IndexAction yes) {
        new MaterialAlertDialogBuilder(this)
                .setTitle(title)
                .setItems(items, (d, w) -> yes.run(w))
                .setNegativeButton(R.string.common_cancel, null)
                .show();
    }

    /* ── 契约请求：统一 busy / 错误提示 / 成功后重刷 ── */

    protected void epPost(String key, JSONObject body, String... vars) {
        busy(true);
        api.epPost(key, body, r -> {
            busy(false);
            toast(r.ok ? getString(R.string.common_saved)
                    : (r.message.length() > 0 ? r.message : getString(R.string.common_error)));
            if (r.ok) refresh();
        }, vars);
    }

    protected void epPost(String key, String... vars) {
        epPost(key, new JSONObject(), vars);
    }

    protected void epPatch(String key, JSONObject body, String... vars) {
        busy(true);
        api.epPatch(key, body, r -> {
            busy(false);
            toast(r.ok ? getString(R.string.common_saved)
                    : (r.message.length() > 0 ? r.message : getString(R.string.common_error)));
            if (r.ok) refresh();
        }, vars);
    }

    protected void epPut(String key, JSONObject body, String... vars) {
        busy(true);
        api.epPut(key, body, r -> {
            busy(false);
            toast(r.ok ? getString(R.string.common_saved)
                    : (r.message.length() > 0 ? r.message : getString(R.string.common_error)));
            if (r.ok) refresh();
        }, vars);
    }

    protected void epDelete(String key, String... vars) {
        busy(true);
        api.epDelete(key, r -> {
            busy(false);
            toast(r.ok ? getString(R.string.common_saved)
                    : (r.message.length() > 0 ? r.message : getString(R.string.common_error)));
            if (r.ok) refresh();
        }, vars);
    }

    protected void epGet(String key, ReplyAction cb, String... vars) {
        busy(true);
        api.epGet(key, r -> { busy(false); cb.on(r); }, vars);
    }

    protected abstract void refresh();

    protected static String s(org.json.JSONObject o, String k) {
        String v = o == null ? "" : o.optString(k, "");
        return v == null || "null".equals(v) ? "" : v;
    }

    protected static int n(org.json.JSONObject o, String k) {
        return o == null ? 0 : o.optInt(k, 0);
    }

    protected static JSONObject obj(JSONObject o, String k) {
        return o == null ? null : o.optJSONObject(k);
    }

    protected static org.json.JSONArray arr(JSONObject o, String k) {
        return o == null ? null : o.optJSONArray(k);
    }
}
