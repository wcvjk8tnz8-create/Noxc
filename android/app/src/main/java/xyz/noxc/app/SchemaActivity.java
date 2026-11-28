package xyz.noxc.app;

import android.content.Intent;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.android.material.materialswitch.MaterialSwitch;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 全站功能通用渲染器 —— 「所有网站功能都在 App 里控制」的核心。
 *
 * 它不认识任何具体业务：从 /api/app/v1/schema 取到声明式描述后，按四种构件渲染：
 *   load        GET 一个接口，把对象 / 数组渲染成原生卡片列表
 *   forms       动态表单（text / num / bool / select / secret / area），提交到指定接口
 *   actions     独立动作按钮（可带确认、弹窗字段、常量参数）
 *   rowActions  数据行内动作，{id}/{rid}/{domain}/{email}/{kind} 从行数据取
 *
 * 路径全部走 Api 的 endpoints 契约 + 占位符替换，客户端零硬编码。
 * 等待用骨架屏、空结果用 Lottie 空状态、成功用弹簧脉冲 + 绘制动画，
 * 全部尊重「减少动画」。新增网站功能只改服务端 schema，不用发版。
 */
public class SchemaActivity extends OpsActivity {

    private int groupIndex;
    private int screenIndex;
    private boolean admin;
    private JSONObject screen;
    private LinearLayout resultBox;
    private FxView skeleton;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Motion.enter(this);
        groupIndex = getIntent().getIntExtra("group", 0);
        screenIndex = getIntent().getIntExtra("screen", 0);
        admin = getIntent().getBooleanExtra("admin", false);
        skeleton = new FxView(this, FxView.Kind.SHIMMER);
        skeleton.setBlocks(5);
        refresh();
    }

    @Override
    public void finish() {
        super.finish();
        Motion.exit(this);
    }

    @Override
    protected void refresh() {
        clear();
        showSkeleton();
        epGet("schema", r -> {
            if (!r.ok) {
                hideSkeleton();
                card(null, r.message.length() > 0 ? r.message : getString(R.string.common_error));
                return;
            }
            JSONArray gs = r.data.optJSONArray("groups");
            JSONObject g = gs == null ? null : gs.optJSONObject(groupIndex);
            JSONArray ss = g == null ? null : g.optJSONArray("screens");
            screen = ss == null ? null : ss.optJSONObject(screenIndex);
            hideSkeleton();
            if (screen == null) { empty(); return; }
            setTitle(HubActivity.label(screen));
            render();
        });
    }

    private void showSkeleton() {
        if (skeleton.getParent() == null) {
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, Ui.dp(this, 180));
            list.addView(skeleton, lp);
        }
        skeleton.setVisibility(View.VISIBLE);
    }

    private void hideSkeleton() {
        if (skeleton != null) skeleton.setVisibility(View.GONE);
    }

    private void render() {
        clear();
        if (skeleton.getParent() == null) {
            list.addView(skeleton, new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, Ui.dp(this, 180)));
        }
        skeleton.setVisibility(View.GONE);

        // 结果区：所有动作的返回都在这里展示，带成功动画
        resultBox = Ui.card(this);
        resultBox.setVisibility(View.GONE);
        list.addView(resultBox);

        // 1) 已有精修原生页：给一个直达入口，同时仍保留 schema 的数据视图
        String nativeKey = screen.optString("native", "");
        if (nativeKey.length() > 0) {
            card(getString(R.string.hub_enter), null,
                    Ui.pill(this, getString(R.string.hub_enter), v -> openNative(nativeKey)));
        }

        // 2) 表单
        JSONArray forms = screen.optJSONArray("forms");
        if (forms != null) {
            for (int i = 0; i < forms.length(); i++) {
                JSONObject f = forms.optJSONObject(i);
                if (f != null) renderForm(f);
            }
        }

        // 3) 独立动作
        JSONArray acts = screen.optJSONArray("actions");
        if (acts != null && acts.length() > 0) {
            LinearLayout c = Ui.card(this);
            c.addView(Ui.title(this, getString(R.string.schema_run)));
            for (int i = 0; i < acts.length(); i++) {
                JSONObject a = acts.optJSONObject(i);
                if (a == null) continue;
                final JSONObject action = a;
                View b = Ui.pill(this, HubActivity.label(a), v -> runAction(action, null, null));
                Motion.press(b);
                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
                lp.setMargins(0, Ui.dp(this, 8), 0, 0);
                c.addView(b, lp);
            }
            list.addView(c);
        }

        // 4) 数据加载 + 行内动作
        JSONObject load = screen.optJSONObject("load");
        if (load == null && (forms == null || forms.length() == 0)
                && (acts == null || acts.length() == 0)) {
            empty();
        }
        if (load != null && nativeKey.length() == 0) loadData(load);
        Motion.stagger(list);
    }

    /* ───────── 动态表单 ───────── */

    private void renderForm(JSONObject f) {
        LinearLayout c = Ui.card(this);
        TextView t = Ui.title(this, HubActivity.label(f));
        t.setTypeface(Motion.display(this));
        c.addView(t);

        final Map<String, View> views = new HashMap<>();
        JSONArray fs = f.optJSONArray("fields");
        if (fs != null) {
            for (int i = 0; i < fs.length(); i++) {
                JSONObject fd = fs.optJSONObject(i);
                if (fd == null) continue;
                View v = fieldView(fd);
                views.put(fd.optString("k", ""), v);
                c.addView(v);
            }
        }
        final JSONObject form = f;
        View submit = Ui.pill(this, getString(R.string.schema_save), v -> {
            JSONObject body = collect(views, fs);
            if (body == null) return;
            submitForm(form, body);
        });
        Motion.press(submit);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, Ui.dp(this, 10), 0, 0);
        c.addView(submit, lp);
        list.addView(c);
    }

    private View fieldView(JSONObject f) {
        String type = f.optString("t", "text");
        String hint = HubActivity.label(f);
        if ("bool".equals(type)) {
            MaterialSwitch sw = new MaterialSwitch(this);
            sw.setText(hint);
            sw.setTextColor(getResources().getColor(R.color.bar_text));
            sw.setTextSize(13);
            sw.setTypeface(Motion.body(this));
            sw.setTag(type);
            return sw;
        }
        if ("select".equals(type)) {
            final TextView btn = Ui.pill(this, hint, v -> { });
            btn.setTag("");
            final JSONArray opts = f.optJSONArray("opt");
            final String[] names = new String[opts == null ? 0 : opts.length()];
            for (int i = 0; i < names.length; i++) names[i] = opts.optJSONArray(i).optString(1, "");
            btn.setOnClickListener(v -> pick(hint, names, w -> {
                JSONArray row = opts.optJSONArray(w);
                btn.setText(names[w]);
                btn.setTag(row == null ? "" : row.optString(0, ""));
            }));
            btn.setText(hint);
            btn.setTag("");   // 未选择值
            return btn;
        }
        EditText e = new EditText(this);
        e.setHint(hint);
        e.setSingleLine(!"area".equals(type));
        if ("area".equals(type)) e.setMinLines(3);
        e.setTextColor(getResources().getColor(R.color.bar_text));
        e.setHintTextColor(getResources().getColor(R.color.bar_dim));
        e.setTextSize(13);
        e.setTypeface(Motion.body(this));
        e.setBackgroundResource(R.drawable.bg_input);
        e.setPadding(Ui.dp(this, 12), Ui.dp(this, 8), Ui.dp(this, 12), Ui.dp(this, 8));
        if ("num".equals(type)) e.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_SIGNED);
        if ("secret".equals(type)) e.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        e.setTag(type);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, Ui.dp(this, 8), 0, 0);
        e.setLayoutParams(lp);
        return e;
    }

    /** 读回动态表单：空值不提交（避免把站点设置清成空串）。 */
    private JSONObject collect(Map<String, View> views, JSONArray fs) {
        JSONObject body = new JSONObject();
        if (fs == null) return body;
        for (int i = 0; i < fs.length(); i++) {
            JSONObject f = fs.optJSONObject(i);
            if (f == null) continue;
            String key = f.optString("k", "");
            String type = f.optString("t", "text");
            View v = views.get(key);
            if (v == null) continue;
            try {
                if ("bool".equals(type) && v instanceof MaterialSwitch) {
                    body.put(key, ((MaterialSwitch) v).isChecked());
                } else if ("select".equals(type) && v instanceof TextView) {
                    String val = String.valueOf(v.getTag());
                    if (!"null".equals(val) && val.length() > 0) body.put(key, val);
                } else if (v instanceof EditText) {
                    String val = ((EditText) v).getText().toString().trim();
                    if (val.length() == 0) continue;
                    if ("num".equals(type)) body.put(key, Long.parseLong(val));
                    else body.put(key, val);
                }
            } catch (Exception ignored) { }
        }
        return body;
    }

    private void submitForm(JSONObject f, JSONObject body) {
        String ep = f.optString("ep", "");
        String method = f.optString("m", "POST");
        if (ep.length() == 0) return;
        if ("GET".equals(method)) {
            String q = queryOf(body);
            String path = api.endpoint(ep, "");
            if (path.length() == 0) { toast(R.string.common_error); return; }
            busy(true);
            api.get(path + (q.length() > 0 ? (path.contains("?") ? "&" : "?") + q : ""),
                    r -> onResult(r, HubActivity.label(f)));
            return;
        }
        execute(ep, method, body, null, HubActivity.label(f), null);
    }

    /* ───────── 动作执行 ───────── */

    private void runAction(JSONObject a, JSONObject row, Map<String, View> extra) {
        /* 已有精修原生页的动作：直接跳原生 Activity，不重复发一次只读请求。 */
        String nativeKey = a.optString("native", "");
        if (nativeKey.length() > 0) {
            if ("apply".equals(nativeKey)) { openNative("apply"); return; }
            if ("domain".equals(nativeKey)) {
                String id = row == null ? "" : row.optString("id", "");
                if (id.length() == 0) { openNative("domain"); return; }
                Intent it = new Intent(this, DomainDetailActivity.class);
                it.putExtra(DomainDetailActivity.EXTRA_ID, parseInt(id));
                it.putExtra(DomainDetailActivity.EXTRA_FQDN,
                        row == null ? "" : row.optString("fqdn", ""));
                startActivity(it);
                Motion.enter(this);
                return;
            }
        }
        JSONArray promptFields = a.optJSONArray("fields");
        if (promptFields != null && promptFields.length() > 0) {
            promptForm(a, row, promptFields);
            return;
        }
        if (a.optBoolean("confirm", false)) {
            confirm(HubActivity.label(a), a.optBoolean("danger", false)
                    ? getString(R.string.schema_danger) : getString(R.string.schema_confirm),
                    () -> executeAction(a, row, null));
            return;
        }
        executeAction(a, row, null);
    }

    private void promptForm(JSONObject a, JSONObject row, JSONArray fs) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(Ui.dp(this, 20), Ui.dp(this, 8), Ui.dp(this, 20), 0);
        final Map<String, View> views = new HashMap<>();
        for (int i = 0; i < fs.length(); i++) {
            JSONObject fd = fs.optJSONObject(i);
            if (fd == null) continue;
            View v = fieldView(fd);
            views.put(fd.optString("k", ""), v);
            box.addView(v);
        }
        final JSONObject action = a;
        final JSONObject rowFinal = row;
        new MaterialAlertDialogBuilder(this)
                .setTitle(HubActivity.label(a))
                .setView(box)
                .setNegativeButton(R.string.common_cancel, null)
                .setPositiveButton(R.string.schema_run, (d, w) ->
                        executeAction(action, rowFinal, collect(views, fs)))
                .show();
    }

    private void executeAction(JSONObject a, JSONObject row, JSONObject body) {
        String ep = a.optString("ep", "");
        String method = a.optString("m", "POST");
        if (ep.length() == 0) return;
        JSONObject b = body == null ? new JSONObject() : body;
        JSONObject cnst = a.optJSONObject("const");
        if (cnst != null) {
            java.util.Iterator<String> it = cnst.keys();
            while (it.hasNext()) {
                String k = it.next();
                try { b.put(k, cnst.get(k)); } catch (Exception ignored) { }
            }
        }
        execute(ep, method, b, row, HubActivity.label(a), a);
    }

    /** 统一请求：路径占位符从 const → 行数据 → 表单值里取；GET 表单转 query。 */
    private void execute(String ep, String method, JSONObject body, JSONObject row,
                         String label, JSONObject action) {
        String path = api.endpoint(ep, "");
        if (path.length() == 0) { toast(R.string.common_error); return; }
        List<String> vars = new ArrayList<>();
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("\\{(\\w+)\\}").matcher(path);
        java.util.Set<String> seen = new java.util.HashSet<>();
        while (m.find()) {
            String k = m.group(1);
            if (seen.contains(k)) continue;
            seen.add(k);
            String v = valueFor(k, body, row);
            vars.add(k);
            vars.add(v == null ? "" : v);
        }
        if ("GET".equals(method)) {
            String q = queryOf(body);
            String full = path;
            for (int i = 0; i + 1 < vars.size(); i += 2)
                full = full.replace("{" + vars.get(i) + "}", vars.get(i + 1));
            if (q.length() > 0) full += (full.contains("?") ? "&" : "?") + q;
            busy(true);
            api.get(full, r -> onResult(r, label));
            return;
        }
        busy(true);
        String[] arr = vars.toArray(new String[0]);
        api.endpointCall(ep, method, body, r -> onResult(r, label), arr);
    }

    private String valueFor(String k, JSONObject body, JSONObject row) {
        if (body != null && body.has(k)) {
            String v = body.optString(k, "");
            if (v.length() > 0) return v;
        }
        if (row != null) {
            String v = row.optString(k, "");
            if (v.length() == 0) v = String.valueOf(row.optInt(k, 0));
            if (!"0".equals(v) && v.length() > 0) return v;
            if ("domain".equals(k)) {
                String f = row.optString("fqdn", row.optString("domain", ""));
                if (f.length() > 0) return f;
            }
            if ("rid".equals(k)) {
                String id = row.optString("id", "");
                if (id.length() > 0) return id;
            }
        }
        return "";
    }

    private String queryOf(JSONObject body) {
        StringBuilder sb = new StringBuilder();
        if (body == null) return "";
        java.util.Iterator<String> it = body.keys();
        while (it.hasNext()) {
            String k = it.next();
            String v = body.optString(k, "");
            if (v.length() == 0) continue;
            try {
                if (sb.length() > 0) sb.append('&');
                sb.append(URLEncoder.encode(k, "UTF-8")).append('=')
                        .append(URLEncoder.encode(v, "UTF-8"));
            } catch (Exception ignored) { }
        }
        return sb.toString();
    }

    private void onResult(Api.Reply r, String label) {
        busy(false);
        if (resultBox == null) return;
        resultBox.removeAllViews();
        resultBox.setVisibility(View.VISIBLE);
        TextView h = Ui.title(this, label + "  ·  " + (r.ok
                ? getString(R.string.schema_success) : getString(R.string.common_error)));
        resultBox.addView(h);
        String text = r.ok ? pretty(r.data) : (r.message.length() > 0 ? r.message : "HTTP " + r.code);
        if (text.length() > 4000) text = text.substring(0, 4000) + "\n…";
        TextView body = Ui.body(this, text);
        body.setTextColor(getResources().getColor(r.ok ? R.color.bar_text : R.color.danger));
        resultBox.addView(body);
        if (r.ok) {
            com.airbnb.lottie.LottieAnimationView lv = new com.airbnb.lottie.LottieAnimationView(this);
            lv.setAnimation(R.raw.anim_success);
            if (!Motion.reduced(this)) lv.playAnimation();
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    Ui.dp(this, 56), Ui.dp(this, 56));
            resultBox.addView(lv, lp);
            Motion.success(resultBox);
        }
        if (r.data != null && r.data.optBoolean("needLogin", false)) toast(R.string.schema_need_login);
    }

    private String pretty(JSONObject o) {
        if (o == null) return "";
        try { return o.toString(2); } catch (Exception e) { return o.toString(); }
    }

    /* ───────── 数据列表 ───────── */

    private void loadData(JSONObject load) {
        String ep = load.optString("ep", "");
        if (ep.length() == 0) return;
        busy(true);
        api.epGet(ep, r -> {
            busy(false);
            if (!r.ok) {
                card(getString(R.string.schema_result),
                        r.message.length() > 0 ? r.message : getString(R.string.common_error));
                return;
            }
            String key = load.optString("items", "");
            Object picked = key.length() > 0 ? r.data.opt(key) : r.data;
            if (picked == null) picked = r.data;   // 键不存在时展示整包，而不是空
            JSONArray items = null;
            if (picked instanceof JSONArray) items = (JSONArray) picked;
            else if (picked instanceof JSONObject) {
                JSONObject j = (JSONObject) picked;
                for (String guess : new String[]{"items", "records", "sections", "data"}) {
                    if (j.optJSONArray(guess) != null) { items = j.optJSONArray(guess); break; }
                }
            }
            LinearLayout box = Ui.card(this);
            box.addView(Ui.title(this, getString(R.string.schema_result)));
            if (items == null) {
                box.addView(Ui.body(this, picked == null ? "" : prettySafe(picked)));
            } else if (items.length() == 0) {
                emptyState(box);
            } else {
                JSONArray rowActions = screen.optJSONArray("rowActions");
                int lim = Math.min(items.length(), 60);
                for (int i = 0; i < lim; i++) {
                    JSONObject row = items.optJSONObject(i);
                    if (row == null) {
                        box.addView(Ui.body(this, items.optString(i, "")));
                        continue;
                    }
                    LinearLayout c = Ui.card(this);
                    c.addView(Ui.title(this, rowTitle(row)));
                    c.addView(Ui.body(this, rowSummary(row)));
                    if (rowActions != null) {
                        for (int k = 0; k < rowActions.length(); k++) {
                            final JSONObject a = rowActions.optJSONObject(k);
                            if (a == null) continue;
                            final JSONObject rw = row;
                            View b = Ui.pill(this, HubActivity.label(a), v -> runAction(a, rw, null));
                            Motion.press(b);
                            c.addView(b);
                        }
                    }
                    box.addView(c);
                }
                if (items.length() > lim)
                    box.addView(Ui.body(this, "… " + (items.length() - lim) + " more"));
            }
            list.addView(box);
            Motion.stagger(list);
        });
    }

    private String prettySafe(Object o) {
        if (o instanceof JSONObject) {
            String s = pretty((JSONObject) o);
            return s.length() > 2500 ? s.substring(0, 2500) + "…" : s;
        }
        return String.valueOf(o);
    }

    private String rowTitle(JSONObject row) {
        for (String k : new String[]{"fqdn", "domain", "email", "subject", "title", "name",
                "ip", "code", "label", "key", "action"}) {
            String v = row.optString(k, "");
            if (v.length() > 0) return v;
        }
        return "#" + row.optInt("id", 0);
    }

    private String rowSummary(JSONObject row) {
        StringBuilder sb = new StringBuilder();
        java.util.Iterator<String> it = row.keys();
        int n = 0;
        while (it.hasNext() && n < 7) {
            String k = it.next();
            String v = row.optString(k, "");
            if (v.length() == 0 || v.length() > 120) continue;
            if (sb.length() > 0) sb.append("  ·  ");
            sb.append(k).append('=').append(v);
            n++;
        }
        return sb.toString();
    }

    private void emptyState(LinearLayout box) {
        TextView t = Ui.body(this, getString(R.string.schema_empty));
        box.addView(t);
        com.airbnb.lottie.LottieAnimationView lv = new com.airbnb.lottie.LottieAnimationView(this);
        lv.setAnimation(R.raw.anim_empty);
        if (!Motion.reduced(this)) lv.playAnimation();
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                Ui.dp(this, 110), Ui.dp(this, 110));
        box.addView(lv, lp);
    }

    private void openNative(String key) {
        if ("apply".equals(key)) {
            startActivity(new Intent(this, ApplyActivity.class));
            Motion.enter(this);
            return;
        }
        if ("domain".equals(key)) {
            toast(R.string.hub_enter);
            prompt(getString(R.string.services_domain), "id", "", id -> {
                Intent it = new Intent(this, DomainDetailActivity.class);
                it.putExtra(DomainDetailActivity.EXTRA_ID, parseInt(id));
                startActivity(it);
                Motion.enter(this);
            });
        }
    }

    private int parseInt(String s) {
        try { return Integer.parseInt(s.trim()); } catch (Exception e) { return 0; }
    }
}
