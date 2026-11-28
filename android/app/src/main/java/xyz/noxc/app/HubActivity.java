package xyz.noxc.app;

import android.content.Intent;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.View;
import android.widget.EditText;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.airbnb.lottie.LottieAnimationView;
import com.google.android.material.materialswitch.MaterialSwitch;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 功能中心 · 「所有网站的功能」总入口。
 *
 * 参考主流 App 的 Bento 网格：大卡放主视觉与统计，功能分组按 2 列错落排布，
 * 每张卡带自绘渐变头图、页面数、管理员标记与 Lottie 点缀。搜索即时过滤；
 * 点卡片用共享元素转场进 {@link SchemaActivity}，元素连续形变而不是黑一下。
 *
 * 功能清单完全来自 /api/app/v1/schema，新增网站功能只改服务端生成脚本，
 * 不在这里硬编码任何页面名或路径。
 */
public class HubActivity extends AppCompatActivity {

    private Api api;
    private JSONObject schema = new JSONObject();
    private LinearLayout grid;
    private FxView skeleton;
    private SwipeRefreshLayout swipe;
    private String query = "";
    private boolean admin = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_hub);
        Motion.enter(this);
        api = new Api(this);
        grid = findViewById(R.id.hub_grid);
        skeleton = findViewById(R.id.hub_skeleton);
        swipe = findViewById(R.id.hub_swipe);

        ((TextView) findViewById(R.id.hub_title)).setTypeface(Motion.display(this));
        ((TextView) findViewById(R.id.hub_sub)).setTypeface(Motion.body(this));

        ImageButton back = findViewById(R.id.hub_back);
        back.setOnClickListener(v -> finish());
        Motion.press(back);

        LottieAnimationView lottie = findViewById(R.id.hub_lottie);
        if (Motion.reduced(this)) lottie.cancelAnimation();

        MaterialSwitch reduce = findViewById(R.id.hub_reduce);
        reduce.setChecked(Motion.isReduceSet());
        reduce.setOnCheckedChangeListener((b, on) -> {
            Motion.setReduce(on);
            if (on) lottie.cancelAnimation();
            else lottie.playAnimation();
            render();
        });

        EditText search = findViewById(R.id.hub_search);
        search.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int a, int b, int c) { }
            @Override public void onTextChanged(CharSequence s, int a, int b, int c) {
                query = s.toString().trim().toLowerCase();
                render();
            }
            @Override public void afterTextChanged(Editable s) { }
        });

        swipe.setOnRefreshListener(this::load);
        load();
    }

    @Override
    public void finish() {
        super.finish();
        Motion.exit(this);
    }

    private void load() {
        skeleton.setVisibility(View.VISIBLE);
        grid.setVisibility(View.GONE);
        api.bootstrap(true, b -> {
            if (b.ok) {
                JSONObject s = b.data.optJSONObject("site");
                admin = s != null && s.optBoolean("isAdmin", false);
            }
            api.epGet("schema", r -> {
                skeleton.setVisibility(View.GONE);
                grid.setVisibility(View.VISIBLE);
                swipe.setRefreshing(false);
                if (r.ok) {
                    schema = r.data;
                    countStats();
                    render();
                } else {
                    TextView t = new TextView(this);
                    t.setText(r.message.length() > 0 ? r.message : getString(R.string.common_error));
                    t.setTextColor(getResources().getColor(R.color.bar_text));
                    grid.removeAllViews();
                    grid.addView(t);
                }
            });
        });
    }

    private void countStats() {
        JSONArray groups = schema.optJSONArray("groups");
        int screens = 0;
        if (groups != null) {
            for (int i = 0; i < groups.length(); i++) {
                JSONObject g = groups.optJSONObject(i);
                if (g != null && g.optJSONArray("screens") != null)
                    screens += g.optJSONArray("screens").length();
            }
        }
        Motion.countUp((TextView) findViewById(R.id.hub_n_groups), groups == null ? 0 : groups.length());
        Motion.countUp((TextView) findViewById(R.id.hub_n_screens), screens);
        Motion.countUp((TextView) findViewById(R.id.hub_n_endpoints), countEndpoints());
    }

    private int countEndpoints() {
        final java.util.Set<String> set = new java.util.HashSet<>();
        walk(schema, set);
        return set.size();
    }

    private void walk(Object o, java.util.Set<String> set) {
        if (o instanceof JSONObject) {
            JSONObject j = (JSONObject) o;
            String ep = j.optString("ep", "");
            if (ep.length() > 0) set.add(ep);
            java.util.Iterator<String> it = j.keys();
            while (it.hasNext()) walk(j.opt(it.next()), set);
        } else if (o instanceof JSONArray) {
            JSONArray a = (JSONArray) o;
            for (int i = 0; i < a.length(); i++) walk(a.opt(i), set);
        }
    }

    /** Bento：第一张卡跨整行做主推，其余两列。管理员分区对非管理员淡出并标注。 */
    private void render() {
        if (grid == null) return;
        grid.removeAllViews();
        JSONArray groups = schema.optJSONArray("groups");
        if (groups == null) return;
        LinearLayout row = null;
        int shown = 0;
        for (int i = 0; i < groups.length(); i++) {
            JSONObject g = groups.optJSONObject(i);
            if (g == null) continue;
            JSONArray screens = g.optJSONArray("screens");
            int n = screens == null ? 0 : screens.length();
            String zh = g.optString("l", ""), en = g.optString("le", "");
            if (query.length() > 0) {
                String hay = (zh + " " + en).toLowerCase();
                boolean hit = hay.contains(query);
                if (!hit && screens != null) {
                    for (int k = 0; k < screens.length(); k++) {
                        JSONObject sc = screens.optJSONObject(k);
                        if (sc != null && (sc.optString("l", "") + " " + sc.optString("le", ""))
                                .toLowerCase().contains(query)) { hit = true; break; }
                    }
                }
                if (!hit) continue;
            }
            if (shown % 2 == 0) {
                row = new LinearLayout(this);
                row.setOrientation(LinearLayout.HORIZONTAL);
                row.setWeightSum(2f);
                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT,
                        LinearLayout.LayoutParams.WRAP_CONTENT);
                lp.setMargins(0, 0, 0, Ui.dp(this, 12));
                grid.addView(row, lp);
            }
            final int gi = i;
            View card = groupCard(g, n, i);
            LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            cp.setMargins(shown % 2 == 0 ? 0 : Ui.dp(this, 8), 0,
                    shown % 2 == 0 ? Ui.dp(this, 8) : 0, 0);
            row.addView(card, cp);
            Motion.transitionName(card, "group_" + gi);
            card.setOnClickListener(v -> {
                Intent it = new Intent(this, GroupActivity.class);
                it.putExtra("group", gi);
                it.putExtra("admin", admin);
                Bundle scene = Motion.scene(this, card, "group_" + gi);
                if (scene != null) startActivity(it, scene);
                else startActivity(it);
                Motion.enter(this);
            });
            Motion.press(card);
            shown++;
        }
        if (shown == 0) {
            TextView t = new TextView(this);
            t.setText(R.string.hub_search_empty);
            t.setTextColor(getResources().getColor(R.color.bar_dim));
            t.setPadding(Ui.dp(this, 8), Ui.dp(this, 24), 0, 0);
            grid.addView(t);
            return;
        }
        Motion.stagger(grid);
    }

    private View groupCard(JSONObject g, int screens, int index) {
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setBackgroundResource(R.drawable.bg_group_card);
        c.setPadding(Ui.dp(this, 12), Ui.dp(this, 12), Ui.dp(this, 12), Ui.dp(this, 14));

        android.widget.ImageView art = new android.widget.ImageView(this);
        String[] arts = {"art_group_0", "art_group_1", "art_group_2", "art_group_3", "art_group_4",
                "art_group_5", "art_group_6", "art_group_7", "art_group_8", "art_group_9"};
        int res = getResources().getIdentifier(arts[index % arts.length], "drawable", getPackageName());
        if (res != 0) art.setImageResource(res);
        art.setScaleType(android.widget.ImageView.ScaleType.CENTER_CROP);
        LinearLayout.LayoutParams ap = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, Ui.dp(this, 84));
        c.addView(art, ap);

        TextView title = Ui.title(this, label(g));
        title.setTypeface(Motion.display(this));
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        tp.setMargins(0, Ui.dp(this, 10), 0, 0);
        c.addView(title, tp);

        boolean isAdmin = g.optBoolean("admin", false);
        String meta = screens + " " + getString(R.string.hub_screens)
                + (isAdmin ? "  ·  " + getString(R.string.hub_admin_only) : "");
        TextView sub = Ui.body(this, meta);
        c.addView(sub);

        TextView go = new TextView(this);
        go.setText(getString(R.string.hub_enter) + "  →");
        go.setTextColor(getResources().getColor(R.color.brand_dot));
        go.setTextSize(12);
        go.setTypeface(Motion.body(this));
        LinearLayout.LayoutParams gp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        gp.setMargins(0, Ui.dp(this, 8), 0, 0);
        c.addView(go, gp);

        if (isAdmin && !admin) c.setAlpha(0.5f);
        return c;
    }

    static String label(JSONObject o) {
        boolean zh = java.util.Locale.getDefault().getLanguage().equalsIgnoreCase("zh");
        return zh ? o.optString("l", "") : o.optString("le", o.optString("l", ""));
    }
}
