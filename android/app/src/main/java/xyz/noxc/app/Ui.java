package xyz.noxc.app;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.shape.MaterialShapeDrawable;
import com.google.android.material.shape.ShapeAppearanceModel;

/** Material 3 原生控件构造：卡片用 MaterialShapeDrawable，按钮是真 MaterialButton。 */
public final class Ui {

    private Ui() { }

    public static int dp(Context c, float v) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, v, c.getResources().getDisplayMetrics()));
    }

    /** M3 形状引擎：全圆角 + 描边 + 填充，颜色沿用站点黑白灰色板。 */
    public static MaterialShapeDrawable shape(Context c, int fill, int stroke, int radiusDp) {
        MaterialShapeDrawable d = new MaterialShapeDrawable(
                ShapeAppearanceModel.builder().setAllCornerSizes(dp(c, radiusDp)).build());
        d.setFillColor(ColorStateList.valueOf(fill));
        d.setStroke(dp(c, 1), ColorStateList.valueOf(stroke));
        return d;
    }

    public static LinearLayout card(Context c) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, 0, 0, dp(c, 12));
        l.setLayoutParams(lp);
        l.setPadding(dp(c, 16), dp(c, 14), dp(c, 16), dp(c, 14));
        l.setBackground(shape(c, c.getResources().getColor(R.color.card_bg),
                c.getResources().getColor(R.color.bar_hair), 20));
        return l;
    }

    public static TextView title(Context c, CharSequence s) {
        TextView t = new TextView(c);
        t.setText(s);
        t.setTextColor(c.getResources().getColor(R.color.bar_text));
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    public static TextView body(Context c, CharSequence s) {
        TextView t = new TextView(c);
        t.setText(s);
        t.setTextColor(c.getResources().getColor(R.color.bar_dim));
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        t.setLineSpacing(dp(c, 3), 1f);
        return t;
    }

    public static TextView headline(Context c, CharSequence s) {
        TextView t = new TextView(c);
        t.setText(s);
        t.setTextColor(c.getResources().getColor(R.color.bar_text));
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 27);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    public static TextView bigNum(Context c, CharSequence s) {
        TextView t = new TextView(c);
        t.setText(s);
        t.setTextColor(c.getResources().getColor(R.color.brand_dot));
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 28);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    public static TextView row(Context c, CharSequence k, CharSequence v) {
        TextView t = new TextView(c);
        t.setText(k + "  " + v);
        t.setTextColor(c.getResources().getColor(R.color.bar_text));
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        t.setPadding(0, dp(c, 4), 0, dp(c, 4));
        return t;
    }

    public static void hairline(Context c, LinearLayout parent) {
        View v = new View(c);
        v.setBackgroundColor(c.getResources().getColor(R.color.bar_hair));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(c, 1));
        lp.setMargins(0, dp(c, 10), 0, dp(c, 10));
        parent.addView(v, lp);
    }

    /** 返回类型仍是 TextView：MaterialButton 继承自 Button → TextView，调用方零改动。 */
    public static TextView pill(Context c, CharSequence s, View.OnClickListener click) {
        MaterialButton b = new MaterialButton(c);
        b.setText(s);
        b.setAllCaps(false);
        b.setTextColor(c.getResources().getColor(R.color.bar_text));
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        b.setGravity(Gravity.CENTER);
        b.setMinHeight(dp(c, 46));
        b.setMinimumHeight(dp(c, 46));
        b.setPadding(dp(c, 16), 0, dp(c, 16), 0);
        b.setCornerRadius(dp(c, 999));
        b.setInsetTop(0);
        b.setInsetBottom(0);
        b.setBackgroundTintList(ColorStateList.valueOf(
                c.getResources().getColor(R.color.bar_bg_pressed)));
        b.setStrokeColor(ColorStateList.valueOf(c.getResources().getColor(R.color.bar_hair)));
        b.setStrokeWidth(dp(c, 1));
        if (click != null) {
            b.setClickable(true);
            b.setFocusable(true);
            b.setOnClickListener(click);
        } else {
            b.setEnabled(false);
        }
        return b;
    }

    public static LinearLayout wrapRow(Context c, TextView... vs) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.HORIZONTAL);
        l.setGravity(Gravity.CENTER_VERTICAL);
        for (int i = 0; i < vs.length; i++) {
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            if (i > 0) lp.setMargins(dp(c, 8), 0, 0, 0);
            l.addView(vs[i], lp);
        }
        return l;
    }
}
