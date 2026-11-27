package xyz.noxc.app;

import android.content.Context;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;

/** 原生卡片 / 文字 / 胶囊按钮的统一构造，避免四个页面各写一套样式。 */
public final class Ui {

    private Ui() { }

    public static int dp(Context c, float v) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, v, c.getResources().getDisplayMetrics()));
    }

    public static GradientDrawable round(Context c, int fill, int stroke, int strokeW) {
        GradientDrawable d = new GradientDrawable();
        d.setCornerRadius(dp(c, 18));
        d.setColor(fill);
        if (strokeW > 0) d.setStroke(dp(c, strokeW), stroke);
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
        l.setBackground(round(c, c.getResources().getColor(R.color.card_bg),
                c.getResources().getColor(R.color.bar_hair), 1));
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
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 26);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    public static TextView bigNum(Context c, CharSequence s) {
        TextView t = new TextView(c);
        t.setText(s);
        t.setTextColor(c.getResources().getColor(R.color.brand_dot));
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 24);
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

    public static TextView pill(Context c, CharSequence s, View.OnClickListener click) {
        TextView t = new TextView(c);
        t.setText(s);
        t.setTextColor(c.getResources().getColor(R.color.bar_text));
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        t.setGravity(Gravity.CENTER);
        t.setMinHeight(dp(c, 44));
        t.setPadding(dp(c, 16), dp(c, 8), dp(c, 16), dp(c, 8));
        GradientDrawable d = new GradientDrawable();
        d.setCornerRadius(dp(c, 999));
        d.setColor(c.getResources().getColor(R.color.bar_bg_pressed));
        d.setStroke(dp(c, 1), c.getResources().getColor(R.color.brand_dot));
        t.setBackground(d);
        if (click != null) {
            t.setClickable(true);
            t.setFocusable(true);
            t.setOnClickListener(click);
        }
        return t;
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
