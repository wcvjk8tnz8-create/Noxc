package xyz.noxc.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.PorterDuff;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.Toast;

/**
 * Noxc 手机版 · WebView 壳
 *
 * 站点本身就是响应式 SPA（上一轮刚做完移动端适配），所有业务都在 Worker 上，
 * 所以 App 不复制任何页面逻辑：只负责「像 App 一样装下这个网页」。
 * 网页更新即时生效，APK 不用跟着重打包。
 *
 * 零第三方依赖，只用 Android 平台 API。
 */
public class MainActivity extends Activity {

    private static final String PREF = "noxc";
    private static final String KEY_SITE = "site_url";
    private static final int REQ_FILE = 1001;

    private WebView web;
    private ProgressBar progress;
    private View splash;
    private View errorView;
    private ValueCallback<Uri[]> filePathCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        web = findViewById(R.id.webview);
        progress = findViewById(R.id.progress);
        splash = findViewById(R.id.splash);
        errorView = findViewById(R.id.error);

        progress.getProgressDrawable().setColorFilter(0xFFE58AB0, PorterDuff.Mode.SRC_IN);
        findViewById(R.id.retry).setOnClickListener(v -> {
            errorView.setVisibility(View.GONE);
            web.setVisibility(View.VISIBLE);
            loadSite();
        });
        // 两个隐藏入口：启动 Logo / 断网提示长按可改站点地址（迁移域名时不用重装）
        findViewById(R.id.splash_logo).setOnLongClickListener(v -> { showSiteDialog(); return true; });
        findViewById(R.id.error_title).setOnLongClickListener(v -> { showSiteDialog(); return true; });

        setupWebView();
        loadSite();
    }

    /** 构建时默认值可被用户在 App 内覆盖一次，之后一直沿用。 */
    private String siteUrl() {
        String saved = getSharedPreferences(PREF, MODE_PRIVATE).getString(KEY_SITE, null);
        return saved != null && saved.length() > 0 ? saved : BuildConfig.SITE_URL;
    }

    private void loadSite() {
        splash.setVisibility(View.VISIBLE);
        progress.setVisibility(View.VISIBLE);
        errorView.setVisibility(View.GONE);
        web.setVisibility(View.VISIBLE);
        web.loadUrl(siteUrl());
    }

    @android.annotation.SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        // OAuth 登录会跳第三方再跳回来，第三方 cookie 必须放行，否则登录态丢失
        cookies.setAcceptThirdPartyCookies(web, true);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setGeolocationEnabled(false);
        // 网页端可据此识别「在 App 内」，以后要隐藏「下载 App」入口不用改代码
        s.setUserAgentString(s.getUserAgentString() + BuildConfig.UA_SUFFIX);

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        web.setWebViewClient(new WebViewClient() {
            /** http/https 一律留在 App 内（含 OAuth 跳转链）；其它协议交给系统应用。 */
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                String scheme = u == null ? null : u.getScheme();
                if (scheme == null) return false;
                if (scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https")) return false;
                return openExternally(u);
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                splash.setVisibility(View.GONE);
                progress.setVisibility(View.GONE);
            }

            /** 只有主帧失败才弹断网页，子资源 404 不打扰。 */
            @Override
            public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) showError();
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView v, int p) {
                progress.setProgress(p);
                progress.setVisibility(p < 100 ? View.VISIBLE : View.GONE);
            }

            /** 站点里的头像上传 / 附件工单用 <input type=file>，必须桥接。 */
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb,
                                             WebChromeClient.FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = cb;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE);
                    return true;
                } catch (ActivityNotFoundException e) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this, R.string.no_file_picker,
                            Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });

        // 长按链接 → 系统浏览器（App 内看外链时也有出路）
        web.setOnLongClickListener(v -> {
            WebView.HitTestResult r = web.getHitTestResult();
            if (r.getType() == WebView.HitTestResult.SRC_ANCHOR_TYPE && r.getExtra() != null) {
                openInBrowser(Uri.parse(r.getExtra()));
                return true;
            }
            return false;
        });
    }

    private boolean openExternally(Uri u) {
        Intent i = new Intent(Intent.ACTION_VIEW, u);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(i);
            return true;
        } catch (ActivityNotFoundException e) {
            return false;
        }
    }

    private void openInBrowser(Uri u) {
        if (!openExternally(u)) {
            Toast.makeText(this, R.string.no_browser, Toast.LENGTH_SHORT).show();
        }
    }

    private void showError() {
        splash.setVisibility(View.GONE);
        progress.setVisibility(View.GONE);
        web.setVisibility(View.GONE);
        errorView.setVisibility(View.VISIBLE);
    }

    /** 站点迁移 / 换域名时不用重装 APK；长按启动 Logo 或断网标题即可改。 */
    private void showSiteDialog() {
        final EditText input = new EditText(this);
        input.setText(siteUrl());
        input.setSingleLine(true);
        input.setSelection(input.getText().length());
        new AlertDialog.Builder(this)
                .setTitle(R.string.site_title)
                .setMessage(R.string.site_body)
                .setView(input)
                .setPositiveButton(R.string.site_save, (d, w) -> {
                    String v = input.getText().toString().trim();
                    if (v.length() == 0) return;
                    if (!v.startsWith("https://") && !v.startsWith("http://")) v = "https://" + v;
                    if (!v.endsWith("/")) v = v + "/";
                    getSharedPreferences(PREF, MODE_PRIVATE).edit().putString(KEY_SITE, v).apply();
                    loadSite();
                })
                .setNegativeButton(R.string.cancel, null)
                .show();
    }

    @Override
    protected void onActivityResult(int reqCode, int resultCode, Intent data) {
        super.onActivityResult(reqCode, resultCode, data);
        if (reqCode != REQ_FILE || filePathCallback == null) return;
        Uri[] results = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getDataString() != null) {
                results = new Uri[]{Uri.parse(data.getDataString())};
            } else if (data.getClipData() != null) {
                ClipData clip = data.getClipData();
                results = new Uri[clip.getItemCount()];
                for (int i = 0; i < clip.getItemCount(); i++) {
                    results[i] = clip.getItemAt(i).getUri();
                }
            }
        }
        filePathCallback.onReceiveValue(results);
        filePathCallback = null;
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onPause() {
        super.onPause();
        // 把会话 cookie 刷到磁盘，杀进程后不用重新登录
        CookieManager.getInstance().flush();
    }
}
