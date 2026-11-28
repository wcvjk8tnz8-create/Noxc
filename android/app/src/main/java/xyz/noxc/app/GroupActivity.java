package xyz.noxc.app;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.airbnb.lottie.LottieAnimationView;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 功能分组的二级页：列出该组下全部 site screens，点进去由 {@link SchemaActivity}
 * 按 schema 渲染数据 / 表单 / 动作。空组给 Lottie 空状态而不是一片白。
 */
public class GroupActivity extends OpsActivity {

    private int groupIndex;
    private boolean admin;
    private JSONObject group;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Motion.enter(this);
        groupIndex = getIntent().getIntExtra("group", 0);
        admin = getIntent().getBooleanExtra("admin", false);
        refresh();
    }

    @Override
    public void finish() {
        super.finish();
        Motion.exit(this);
    }

    @Override
    protected void refresh() {
        epGet("schema", r -> {
            clear();
            if (!r.ok) {
                card(null, r.message.length() > 0 ? r.message : getString(R.string.common_error));
                return;
            }
            JSONArray gs = r.data.optJSONArray("groups");
            group = gs == null ? null : gs.optJSONObject(groupIndex);
            if (group == null) { empty(); return; }
            setTitle(HubActivity.label(group));
            JSONArray screens = group.optJSONArray("screens");
            if (screens == null || screens.length() == 0) { empty(); return; }

            LinearLayout hero = Ui.card(this);
            TextView h = Ui.title(this, HubActivity.label(group));
            h.setTypeface(Motion.display(this));
            hero.addView(h);
            hero.addView(Ui.body(this, screens.length() + " " + getString(R.string.hub_screens)));
            LottieAnimationView lv = new LottieAnimationView(this);
            lv.setAnimation(group.optBoolean("admin", false)
                    ? R.raw.anim_shield : R.raw.anim_sparkle);
            lv.setRepeatCount(android.animation.ValueAnimator.INFINITE);
            if (!Motion.reduced(this)) lv.playAnimation();
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    Ui.dp(this, 64), Ui.dp(this, 64));
            lv.setLayoutParams(lp);
            // Lottie 作为卡片右上角装饰：用一层水平容器承载
            LinearLayout wrap = new LinearLayout(this);
            wrap.setOrientation(LinearLayout.HORIZONTAL);
            wrap.setGravity(android.view.Gravity.END);
            wrap.addView(lv);
            hero.addView(wrap);
            list.addView(hero);

            for (int i = 0; i < screens.length(); i++) {
                JSONObject s = screens.optJSONObject(i);
                if (s == null) continue;
                final int si = i;
                boolean sa = group.optBoolean("admin", false) || s.optBoolean("admin", false);
                String meta = (sa ? getString(R.string.hub_admin_only) + "  ·  " : "")
                        + (s.optJSONArray("forms") == null ? 0 : s.optJSONArray("forms").length())
                        + " " + getString(R.string.schema_save).toLowerCase();
                LinearLayout c = Ui.card(this);
                TextView t = Ui.title(this, HubActivity.label(s));
                t.setTypeface(Motion.display(this));
                c.addView(t);
                c.addView(Ui.body(this, meta));
                c.addView(Ui.pill(this, getString(R.string.hub_enter), v -> {
                    Intent it = new Intent(this, SchemaActivity.class);
                    it.putExtra("group", groupIndex);
                    it.putExtra("screen", si);
                    it.putExtra("admin", admin);
                    Bundle scene = Motion.scene(this, c, "screen_" + si);
                    Motion.transitionName(c, "screen_" + si);
                    if (scene != null) startActivity(it, scene);
                    else startActivity(it);
                    Motion.enter(this);
                }));
                Motion.press(c);
                if (sa && !admin) c.setAlpha(0.55f);
                list.addView(c);
            }
            Motion.stagger(list);
        });
    }
}
