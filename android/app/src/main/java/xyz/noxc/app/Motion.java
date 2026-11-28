package xyz.noxc.app;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ValueAnimator;
import android.app.Activity;
import android.content.Context;
import android.graphics.Typeface;
import android.os.Bundle;
import android.provider.Settings;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.DecelerateInterpolator;
import android.view.animation.OvershootInterpolator;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.app.ActivityOptionsCompat;
import androidx.dynamicanimation.animation.DynamicAnimation;
import androidx.dynamicanimation.animation.SpringAnimation;
import androidx.dynamicanimation.animation.SpringForce;

/**
 * 全局动效基建 · 参考主流 App 的「物理化微交互 + 骨架屏 + 共享元素 + 克制动效」。
 *
 * 设计取舍（不是堆特效）：
 *  - 入场：子 View 错落淡入 + 轻微上移，弹簧回弹，不做整页视差；
 *  - 反馈：按压 0.96 缩放 → 松手弹簧归位，给用户「可触摸」感；
 *  - 等待：骨架屏由 SkeletonView 承担，转圈只留一条细进度条；
 *  - 转场：共享元素保持上下文连贯，配合窗口 fade/slide；
 *  - 无障碍：系统「减少动画」或 App 内开关打开时，全部退化为瞬时状态切换。
 *
 * 所有动画都集中在这一处开关，页面代码不自己写 ValueAnimator，避免各页不一致。
 */
public final class Motion {

    private Motion() { }

    private static Typeface BODY;
    private static Typeface DISPLAY;
    private static Boolean APP_REDUCE = null;

    /** 系统动画缩放为 0（开发者选项 / 无障碍）或用户在 App 里关掉动效。 */
    public static boolean reduced(Context c) {
        if (APP_REDUCE != null && APP_REDUCE) return true;
        try {
            float a = Settings.Global.getFloat(c.getContentResolver(),
                    Settings.Global.ANIMATOR_DURATION_SCALE, 1f);
            float t = Settings.Global.getFloat(c.getContentResolver(),
                    Settings.Global.TRANSITION_ANIMATION_SCALE, 1f);
            return a == 0f || t == 0f;
        } catch (Exception e) {
            return false;
        }
    }

    public static void setReduce(boolean on) { APP_REDUCE = on; }

    public static boolean isReduceSet() { return APP_REDUCE != null && APP_REDUCE; }

    /** 内置 OFL 字体：正文 Noto Sans SC，标题 Noto Serif SC（变量字体）。 */
    public static Typeface body(Context c) {
        if (BODY == null) {
            try {
                BODY = Typeface.createFromAsset(c.getAssets(), "fonts/NotoSansSC-Regular.ttf");
            } catch (Exception e) {
                BODY = Typeface.DEFAULT;
            }
        }
        return BODY;
    }

    public static Typeface display(Context c) {
        if (DISPLAY == null) {
            try {
                DISPLAY = Typeface.createFromAsset(c.getAssets(), "fonts/NotoSerifSC-VF.ttf");
            } catch (Exception e) {
                DISPLAY = Typeface.DEFAULT_BOLD;
            }
        }
        return DISPLAY;
    }

    public static void applyFont(View root) {
        if (root instanceof TextView) {
            TextView t = (TextView) root;
            if (t.getTextSize() > 58f) t.setTypeface(display(root.getContext()));
            else t.setTypeface(body(root.getContext()));
        }
        if (root instanceof ViewGroup) {
            ViewGroup g = (ViewGroup) root;
            for (int i = 0; i < g.getChildCount(); i++) applyFont(g.getChildAt(i));
        }
    }

    /** 错落入场：卡片依次淡入 + 上移 + 轻微放大，最后用弹簧归位。 */
    public static void stagger(LinearLayout parent) {
        if (parent == null) return;
        Context c = parent.getContext();
        if (reduced(c)) return;
        int n = parent.getChildCount();
        for (int i = 0; i < n; i++) {
            final View v = parent.getChildAt(i);
            v.setAlpha(0f);
            v.setTranslationY(Ui.dp(c, 18));
            v.setScaleX(0.97f);
            v.setScaleY(0.97f);
            v.animate()
                    .alpha(1f).translationY(0f).scaleX(1f).scaleY(1f)
                    .setStartDelay(Math.min(i, 12) * 42L)
                    .setDuration(340)
                    .setInterpolator(new OvershootInterpolator(0.85f))
                    .start();
        }
    }

    /** 单个 View 弹出（新增卡片 / 结果区出现）。 */
    public static void pop(View v) {
        if (v == null) return;
        if (reduced(v.getContext())) { v.setAlpha(1f); return; }
        v.setAlpha(0f);
        v.setScaleX(0.9f);
        v.setScaleY(0.9f);
        v.animate().alpha(1f).scaleX(1f).scaleY(1f)
                .setDuration(320).setInterpolator(new OvershootInterpolator(1.1f)).start();
    }

    /** 按压反馈：不吞点击，松手 performClick。 */
    public static void press(View v) {
        if (v == null) return;
        final Context c = v.getContext();
        v.setOnTouchListener((view, ev) -> {
            if (reduced(c)) return false;
            switch (ev.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    view.animate().scaleX(0.96f).scaleY(0.96f)
                            .setDuration(90).setInterpolator(new DecelerateInterpolator()).start();
                    return false;      // 继续交给 OnClickListener
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    new SpringAnimation(view, DynamicAnimation.SCALE_X, 1f)
                            .setSpring(spring()).start();
                    new SpringAnimation(view, DynamicAnimation.SCALE_Y, 1f)
                            .setSpring(spring()).start();
                    return false;
                default:
                    return false;
            }
        });
    }

    private static SpringForce spring() {
        return new SpringForce(1f)
                .setDampingRatio(SpringForce.DAMPING_RATIO_MEDIUM_BOUNCY)
                .setStiffness(SpringForce.STIFFNESS_MEDIUM);
    }

    /** 数字滚动：统计卡从 0 滚到目标值。 */
    public static void countUp(TextView tv, int target) {
        if (tv == null) return;
        if (reduced(tv.getContext()) || target <= 0) {
            tv.setText(String.valueOf(target));
            return;
        }
        ValueAnimator a = ValueAnimator.ofInt(0, target);
        a.setDuration(760);
        a.setInterpolator(new DecelerateInterpolator(1.4f));
        a.addUpdateListener(an -> tv.setText(String.valueOf(an.getAnimatedValue())));
        a.start();
    }

    /** 淡出旧内容 → 淡入新内容（刷新时不闪白）。 */
    public static void crossfade(View out, final Runnable swap) {
        if (out == null || reduced(out.getContext())) { swap.run(); return; }
        out.animate().alpha(0f).setDuration(120)
                .setListener(new AnimatorListenerAdapter() {
                    @Override
                    public void onAnimationEnd(Animator animation) {
                        swap.run();
                        out.setAlpha(1f);
                    }
                }).start();
    }

    /** 共享元素转场：列表卡 → 详情，元素连续形变而不是「黑一下」。 */
    public static Bundle scene(Activity a, View shared, String name) {
        if (shared == null || reduced(a)) return null;
        return ActivityOptionsCompat.makeSceneTransitionAnimation(a, shared, name).toBundle();
    }

    public static void transitionName(View v, String name) {
        if (v != null) androidx.core.view.ViewCompat.setTransitionName(v, name);
    }

    /** 成功脉冲：结果卡片轻微放大再回弹。 */
    public static void success(View v) {
        if (v == null) return;
        if (reduced(v.getContext())) return;
        v.animate().scaleX(1.03f).scaleY(1.03f).setDuration(130)
                .setListener(new AnimatorListenerAdapter() {
                    @Override
                    public void onAnimationEnd(Animator animation) {
                        new SpringAnimation(v, DynamicAnimation.SCALE_X, 1f).setSpring(spring()).start();
                        new SpringAnimation(v, DynamicAnimation.SCALE_Y, 1f).setSpring(spring()).start();
                    }
                }).start();
    }

    /** 页面转场：进入右滑淡入，退出左滑淡出。 */
    public static void enter(Activity a) {
        if (!reduced(a)) a.overridePendingTransition(R.anim.slide_in_right, R.anim.fade_out);
    }

    public static void exit(Activity a) {
        if (!reduced(a)) a.overridePendingTransition(R.anim.fade_in, R.anim.slide_out_right);
    }
}
