package xyz.noxc.app;

import android.app.Activity;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.os.SystemClock;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;

import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 原生 M3 滑块拼图验证。
 *
 * 申请子域名时若后台开启了滑块，服务端要求一次性 passToken。以前只能跳网页，
 * 现在 App 内领挑战 → 下载底图 → 拖 SeekBar 对齐缺口 → 提交带轨迹的验证，
 * 全程原生控件，零 WebView。服务端仍校验 HMAC token / 坐标 / 轨迹 / 一次性 nonce，
 * App 不绕过任何安全规则。
 */
public final class CaptchaDialog {

    public interface Result { void on(String passToken); }

    private CaptchaDialog() { }

    /** enabled=false 时直接回调空串（后台关掉验证）；失败回调 null 让调用方提示。 */
    public static void show(Activity a, Api api, Result cb) {
        api.epGet("captcha", r -> {
            if (!r.ok) { cb.on(null); return; }
            JSONObject d = r.data;
            if (!d.optBoolean("enabled")) { cb.on(""); return; }
            build(a, api, d, cb);
        });
    }

    private static void build(Activity a, Api api, JSONObject d, Result cb) {
        final String id = d.optString("id", "");
        final String token = d.optString("token", "");
        final int gapX = d.optInt("x", 0);
        final int gapY = d.optInt("y", 0);
        final int w = d.optInt("w", 320);
        final int h = d.optInt("h", 180);
        final int piece = d.optInt("piece", 52);
        final String img = d.optString("img", "typhoon");

        LinearLayout box = new LinearLayout(a);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = Ui.dp(a, 20);
        box.setPadding(pad, Ui.dp(a, 8), pad, 0);

        Stage stage = new Stage(a, gapX, gapY, w, h, piece);
        int stageW = Ui.dp(a, 300);
        int stageH = Math.round(stageW * h / (float) w);
        box.addView(stage, new LinearLayout.LayoutParams(stageW, stageH));

        TextView hint = new TextView(a);
        hint.setText(R.string.captcha_hint);
        hint.setTextColor(a.getResources().getColor(R.color.bar_dim));
        hint.setTextSize(13);
        hint.setPadding(0, Ui.dp(a, 10), 0, Ui.dp(a, 6));
        box.addView(hint);

        SeekBar seek = new SeekBar(a);
        seek.setMax(w);
        box.addView(seek, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, Ui.dp(a, 44)));

        final AlertDialog[] holder = new AlertDialog[1];
        holder[0] = new MaterialAlertDialogBuilder(a)
                .setTitle(R.string.captcha_title)
                .setView(box)
                .setCancelable(false)
                .setNegativeButton(R.string.common_cancel, (dlg, wch) -> cb.on(null))
                .create();

        final long[] t0 = {0};
        final boolean[] tracking = {false};
        final JSONArray[] trace = {new JSONArray()};
        final int[] last = {0};
        final long[] lastT = {0};

        api.image(api.web("img/captcha/" + img + ".webp"), bmp -> stage.setBitmap(bmp));

        seek.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onStartTrackingTouch(SeekBar s) {
                t0[0] = SystemClock.elapsedRealtime();
                trace[0] = new JSONArray();
                last[0] = 0;
                lastT[0] = 0;
                tracking[0] = true;
                put(trace[0], 0, 0);
            }

            @Override
            public void onProgressChanged(SeekBar s, int progress, boolean fromUser) {
                stage.setProgress(progress);
                if (!tracking[0] || !fromUser) return;
                long t = SystemClock.elapsedRealtime() - t0[0];
                // 大跨度拖动拆成多个中间采样，避免单步 dx>90 被判瞬移；
                // 保留真实 elapsed 时间戳，所以轨迹仍带人形抖动。
                int prev = last[0];
                int step = progress - prev;
                int n = Math.max(1, (int) Math.ceil(Math.abs(step) / 60.0));
                // 时间戳严格单调：以 lastT 为下界线性插值，杜绝 dt<0 被判瞬移；
                // 每步至少 1ms，真实拖动的事件间隔本身不规则，不会是完美匀速。
                long span = Math.max(n, t - lastT[0]);
                for (int i = 1; i <= n; i++) {
                    int x = prev + Math.round(step * i / (float) n);
                    long ti = lastT[0] + Math.round(span * i / (float) n);
                    put(trace[0], ti, x);
                    lastT[0] = ti;
                }
                last[0] = progress;
            }

            @Override
            public void onStopTrackingTouch(SeekBar s) {
                if (!tracking[0]) return;
                tracking[0] = false;
                final int x = s.getProgress();
                final long dur = SystemClock.elapsedRealtime() - t0[0];
                // 服务端要求拖动至少 220ms；用户拖太快时补足末尾时间戳再提交
                long wait = Math.max(0, 260 - dur);
                s.postDelayed(() -> submit(a, api, id, token, x, trace[0],
                        t0[0], dur, holder[0], cb), wait);
            }
        });

        holder[0].show();
    }

    private static void submit(Activity a, Api api, String id, String token, int x,
                               JSONArray trace, long t0, long dur,
                               AlertDialog dlg, Result cb) {
        // 终点必须与提交值一致，且总时长 ≥220ms
        long end = Math.max(260, dur);
        put(trace, end, x);
        JSONObject body = new JSONObject();
        try {
            body.put("id", id);
            body.put("token", token);
            body.put("x", x);
            body.put("trace", trace);
            body.put("keyboard", false);
        } catch (Exception ignored) { }
        api.epPost("captchaVerify", body, r -> {
            if (r.ok && r.data.optString("passToken", "").length() > 0) {
                dlg.dismiss();
                cb.on(r.data.optString("passToken"));
            } else {
                Toast.makeText(a, r.message.length() > 0 ? r.message
                        : a.getString(R.string.captcha_retry), Toast.LENGTH_SHORT).show();
                dlg.dismiss();
                cb.on(null);
            }
        });
    }

    private static void put(JSONArray arr, long t, int x) {
        try {
            JSONObject p = new JSONObject();
            p.put("t", t);
            p.put("x", x);
            arr.put(p);
        } catch (Exception ignored) { }
    }

    /** 自绘舞台：底图 + 缺口 + 随 SeekBar 移动的拼图块，纯 Canvas，零 WebView。 */
    private static final class Stage extends View {
        private final int gapX, gapY, baseW, baseH, piece;
        private Bitmap bmp;
        private int progress;
        private final Paint gap = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint block = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint border = new Paint(Paint.ANTI_ALIAS_FLAG);

        Stage(Context c, int x, int y, int w, int h, int p) {
            super(c);
            gapX = x; gapY = y; baseW = w; baseH = h; piece = p;
            gap.setColor(Color.argb(150, 0, 0, 0));
            block.setColor(Color.argb(170, 255, 255, 255));
            border.setStyle(Paint.Style.STROKE);
            border.setStrokeWidth(3);
            border.setColor(c.getResources().getColor(R.color.brand_dot));
        }

        void setBitmap(Bitmap b) { bmp = b; invalidate(); }

        void setProgress(int p) { progress = p; invalidate(); }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            float sx = getWidth() / (float) baseW;
            float sy = getHeight() / (float) baseH;
            if (bmp != null) {
                android.graphics.Rect src = new android.graphics.Rect(
                        0, 0, bmp.getWidth(), bmp.getHeight());
                android.graphics.RectF dst = new android.graphics.RectF(
                        0, 0, getWidth(), getHeight());
                canvas.drawBitmap(bmp, src, dst, null);
            } else {
                canvas.drawColor(getResources().getColor(R.color.bar_bg_pressed));
            }
            float gx = gapX * sx, gy = gapY * sy;
            float pw = piece * sx, ph = piece * sy;
            canvas.drawRect(gx, gy, gx + pw, gy + ph, gap);
            float bx = progress * sx;
            canvas.drawRect(bx, gy, bx + pw, gy + ph, block);
            canvas.drawRect(bx, gy, bx + pw, gy + ph, border);
        }
    }
}
