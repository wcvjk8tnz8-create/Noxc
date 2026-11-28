package xyz.noxc.app;

import android.animation.ValueAnimator;
import android.content.Context;
import android.util.AttributeSet;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.RadialGradient;
import android.graphics.Shader;
import android.view.View;
import android.view.animation.LinearInterpolator;

/**
 * 两种自绘动画，都不吃图片资源、不需要第三方素材包：
 *
 *  - SHIMMER：骨架屏。主流 App 用骨架替代菊花转圈，降低感知等待；
 *    这里用一条 LinearGradient 平移扫过圆角占位块，加载完直接 hide()。
 *  - GLOW：品牌光晕。两团缓慢漂移的径向渐变，给启动页 / 功能中心做
 *    「空间分层」的克制氛围，不做多层视差，控制低端机性能成本。
 *
 * 尊重系统「减少动画」：关闭时静止绘制，不跑 ValueAnimator。
 */
public final class FxView extends View {

    public enum Kind { SHIMMER, GLOW }

    private final Kind kind;
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private float phase;
    private ValueAnimator anim;
    private int blocks = 4;

    public FxView(Context c, Kind k) {
        super(c);
        kind = k;
        setWillNotDraw(false);
    }

    /** XML inflate 用：按 id 决定骨架屏还是光晕，避免运行时 InflateException。 */
    public FxView(Context c, AttributeSet attrs) {
        super(c, attrs);
        int id = attrs == null ? 0 : attrs.getAttributeResourceValue(
                "http://schemas.android.com/apk/res/android", "id", 0);
        kind = id == R.id.hub_glow ? Kind.GLOW : Kind.SHIMMER;
        setWillNotDraw(false);
    }

    public FxView setBlocks(int n) { blocks = Math.max(1, n); return this; }

    @Override
    protected void onAttachedToWindow() {
        super.onAttachedToWindow();
        start();
    }

    @Override
    protected void onDetachedFromWindow() {
        stop();
        super.onDetachedFromWindow();
    }

    private void start() {
        if (anim != null || Motion.reduced(getContext())) { invalidate(); return; }
        anim = ValueAnimator.ofFloat(0f, 1f);
        anim.setDuration(kind == Kind.GLOW ? 5200 : 1350);
        anim.setRepeatCount(ValueAnimator.INFINITE);
        anim.setInterpolator(new LinearInterpolator());
        anim.addUpdateListener(a -> {
            phase = (float) a.getAnimatedValue();
            invalidate();
        });
        anim.start();
    }

    private void stop() {
        if (anim != null) { anim.cancel(); anim = null; }
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        if (kind == Kind.SHIMMER) drawShimmer(canvas);
        else drawGlow(canvas);
    }

    private void drawShimmer(Canvas canvas) {
        int w = getWidth(), h = getHeight();
        if (w <= 0 || h <= 0) return;
        float top = Ui.dp(getContext(), 6);
        float gap = Ui.dp(getContext(), 12);
        float bh = Math.max(Ui.dp(getContext(), 14), (h - top * 2 - gap * (blocks - 1)) / (float) blocks);
        int base = getResources().getColor(R.color.card_bg);
        int hi = getResources().getColor(R.color.bar_bg_pressed);
        for (int i = 0; i < blocks; i++) {
            float y = top + i * (bh + gap);
            float bw = i % 2 == 0 ? w * 0.92f : w * 0.66f;
            paint.setShader(null);
            paint.setColor(base);
            canvas.drawRoundRect(0, y, bw, y + bh, Ui.dp(getContext(), 9), Ui.dp(getContext(), 9), paint);
            float sweep = w * 1.6f;
            float x = -sweep + phase * (w + sweep * 2);
            Shader s = new LinearGradient(x, 0, x + sweep * 0.55f, 0,
                    new int[]{base, hi, base}, new float[]{0f, 0.5f, 1f}, Shader.TileMode.CLAMP);
            paint.setShader(s);
            paint.setColor(Color.WHITE);
            canvas.drawRoundRect(0, y, bw, y + bh, Ui.dp(getContext(), 9), Ui.dp(getContext(), 9), paint);
        }
        paint.setShader(null);
    }

    private void drawGlow(Canvas canvas) {
        int w = getWidth(), h = getHeight();
        if (w <= 0 || h <= 0) return;
        canvas.drawColor(getResources().getColor(R.color.splash_bg));
        double a = phase * Math.PI * 2;
        float x1 = (float) (w * (0.72 + 0.10 * Math.sin(a)));
        float y1 = (float) (h * (0.16 + 0.08 * Math.cos(a * 0.8)));
        float x2 = (float) (w * (0.20 + 0.09 * Math.cos(a * 0.7)));
        float y2 = (float) (h * (0.78 + 0.07 * Math.sin(a)));
        drawBlob(canvas, x1, y1, Math.max(w, h) * 0.62f, 0x33E58AB0);
        drawBlob(canvas, x2, y2, Math.max(w, h) * 0.55f, 0x225C7CD6);
    }

    private void drawBlob(Canvas canvas, float cx, float cy, float r, int color) {
        RadialGradient g = new RadialGradient(cx, cy, r,
                new int[]{color, Color.TRANSPARENT},
                new float[]{0f, 1f}, Shader.TileMode.CLAMP);
        paint.setShader(g);
        paint.setColor(Color.WHITE);
        canvas.drawCircle(cx, cy, r, paint);
        paint.setShader(null);
    }
}
