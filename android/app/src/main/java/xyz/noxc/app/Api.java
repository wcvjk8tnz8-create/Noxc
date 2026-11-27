package xyz.noxc.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

import androidx.browser.customtabs.CustomTabsIntent;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Noxc 手机版 · 网络层
 *
 * App 里没有任何 WebView：所有数据都由 Android 控件直接向 Worker 的 JSON 接口取。
 * HTTP 仍用平台 HttpURLConnection + org.json（不引入 OkHttp/Retrofit）；
 * 唯一用到的 AndroidX 是 androidx.browser 的 Custom Tabs，用于 App 内打开网页。
 * 登录态 = 站点原本的 sh_session cookie，登录后从 Set-Cookie 提取 token 存
 * SharedPreferences，之后每个请求手动带 Cookie 头（不依赖 CookieManager 的内存态，
 * 杀进程重开仍在）。接口统一信封 { success:true, ... } / { success:false, message }。
 */
public final class Api {

    public static final class Reply {
        public final int code;
        public final JSONObject data;
        public final String message;
        public final boolean ok;

        Reply(int code, JSONObject data, String err) {
            this.code = code;
            this.data = data == null ? new JSONObject() : data;
            boolean httpOk = code >= 200 && code < 300;
            // 200 但 success:false 仍是业务失败；非 JSON 的 2xx 视为成功
            this.ok = httpOk && this.data.optBoolean("success", true);
            this.message = err != null ? err
                    : this.data.optString("message", httpOk ? "" : ("HTTP " + code));
        }
    }

    public interface Callback {
        void on(Reply r);
    }

    private static final ExecutorService POOL = Executors.newFixedThreadPool(4);
    private static final Handler UI = new Handler(Looper.getMainLooper());
    private static final Pattern SESSION =
            Pattern.compile("sh_session=([^;,\\s]+)", Pattern.CASE_INSENSITIVE);

    private static final String PREF = "noxc";
    private static final String KEY_SITE = "site_url";
    private static final String KEY_SESSION = "session";

    /** bootstrap 下发的接口契约，同一进程内三个 Activity 共用，避免各硬编码一套路径。 */
    private static JSONObject ENDPOINTS = new JSONObject();

    public static void setEndpoints(JSONObject e) {
        ENDPOINTS = e == null ? new JSONObject() : e;
    }

    public String endpoint(String key, String fallback) {
        String v = ENDPOINTS.optString(key, "");
        return v.length() > 0 ? v : fallback;
    }

    private final Context ctx;
    private final SharedPreferences pref;

    public Api(Context c) {
        ctx = c.getApplicationContext();
        pref = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE);
    }

    public String base() {
        String v = pref.getString(KEY_SITE, null);
        if (v == null || v.length() == 0) v = BuildConfig.SITE_URL;
        return v.endsWith("/") ? v : v + "/";
    }

    public void setSite(String url) {
        String v = url.trim();
        if (!v.startsWith("https://") && !v.startsWith("http://")) v = "https://" + v;
        if (!v.endsWith("/")) v = v + "/";
        pref.edit().putString(KEY_SITE, v).apply();
    }

    public String host() {
        try {
            String h = new URL(base()).getHost();
            return h == null ? "" : h;
        } catch (Exception e) {
            return "";
        }
    }

    public String url(String path) {
        return base() + (path.startsWith("/") ? path.substring(1) : path);
    }

    public boolean loggedIn() {
        return token() != null && token().length() > 0;
    }

    public String token() {
        return pref.getString(KEY_SESSION, null);
    }

    private void saveSession(String t) {
        pref.edit().putString(KEY_SESSION, t).apply();
    }

    public void clearSession() {
        pref.edit().remove(KEY_SESSION).apply();
    }

    /**
     * App 冷启动专用：一次拿全四个 tab 的数据（站点配置 + 登录态账号 + 域名 + 积分）。
     * fresh=true 时带 ?_= 绕开 Worker 的 10 秒私有缓存，用于签到 / 登录 / 登出后。
     */
    public void bootstrap(boolean fresh, Callback cb) {
        get("/api/app/v1/bootstrap" + (fresh ? "?_=" + System.currentTimeMillis() : ""), cb);
    }

    /** 统一走线程池，回调一定回到主线程，页面代码不用自己切线程。 */
    public void get(String path, Callback cb) {
        call("GET", path, null, cb);
    }

    public void post(String path, JSONObject body, Callback cb) {
        call("POST", path, body == null ? new JSONObject() : body, cb);
    }

    public void logout(Callback cb) {
        post("/api/auth/logout", new JSONObject(), r -> {
            clearSession();   // 无论服务端是否成功，本地都退出
            cb.on(r);
        });
    }

    public String web(String path) {
        return url(path == null ? "" : path);
    }

    /**
     * 用 Chrome Custom Tab 在 **App 内** 打开网页（带 App 名称与工具栏），
     * 不再 ACTION_VIEW 甩给外部浏览器。条款、文档、后台、第三方 OAuth 都走这里。
     * 设备没有支持 Custom Tabs 的浏览器时才回落到系统 VIEW。
     */
    public void openInApp(Activity a, String path) {
        try {
            new CustomTabsIntent.Builder()
                    .setShowTitle(true)
                    .setToolbarColor(a.getResources().getColor(R.color.bar_bg))
                    .build()
                    .launchUrl(a, Uri.parse(web(path)));
        } catch (Exception e) {
            try {
                a.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(web(path))));
            } catch (Exception ignored) { }
        }
    }

    private void call(String method, String path, JSONObject body, Callback cb) {
        final String target = url(path);
        final String payload = body == null ? null : body.toString();
        POOL.execute(() -> {
            Reply r = execute(method, target, payload);
            UI.post(() -> cb.on(r));
        });
    }

    private Reply execute(String method, String target, String payload) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(target).openConnection();
            conn.setRequestMethod(method);
            conn.setConnectTimeout(12000);
            conn.setReadTimeout(15000);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("User-Agent", "NoxcApp/1.0 (Android)");
            String lang = Locale.getDefault().getLanguage();
            conn.setRequestProperty("Accept-Language",
                    "zh".equalsIgnoreCase(lang) ? "zh-CN,zh;q=0.9" : "en-US,en;q=0.9");
            String t = token();
            if (t != null && t.length() > 0) conn.setRequestProperty("Cookie", "sh_session=" + t);
            if (payload != null) {
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(payload.getBytes(StandardCharsets.UTF_8));
                }
            }
            int code = conn.getResponseCode();

            // 登录 / 注册成功时站点会 append Set-Cookie；多个头里找 sh_session
            Map<String, List<String>> heads = conn.getHeaderFields();
            if (heads != null) {
                for (Map.Entry<String, List<String>> e : heads.entrySet()) {
                    if (e.getKey() != null && e.getKey().equalsIgnoreCase("Set-Cookie")
                            && e.getValue() != null) {
                        for (String raw : e.getValue()) {
                            Matcher m = SESSION.matcher(raw == null ? "" : raw);
                            if (m.find()) saveSession(m.group(1));
                        }
                    }
                }
            }

            InputStream in = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String text = readAll(in);
            JSONObject json = new JSONObject();
            if (text != null) {
                String s = text.trim();
                if (s.startsWith("{")) {
                    try { json = new JSONObject(s); } catch (Exception ignored) { }
                }
            }
            return new Reply(code, json, null);
        } catch (Exception e) {
            String m = e.getMessage();
            return new Reply(0, null, "无法连接站点" + (m == null ? "" : "：" + m));
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String readAll(InputStream in) {
        if (in == null) return "";
        StringBuilder sb = new StringBuilder();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = br.readLine()) != null) sb.append(line).append('\n');
        } catch (Exception ignored) { }
        return sb.toString();
    }
}
