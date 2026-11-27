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
import android.view.MenuItem;
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
import android.widget.PopupMenu;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

/**
 * Noxc 手机版 · 原生外壳 + WebView
 *
 * 站点本身就是响应式 SPA（见 README Z.13 的移动端适配），所有业务都在 Worker 上，
 * 所以不复制页面逻辑，但**不是把网页全屏一塞了事**：上下两条原生栏、圆角按钮、
 * 下拉刷新、双击返回退出、启动/断网覆盖层都由 Android 平台控件画出，网页只占中间
 * 的内容区。前端更新即时生效，APK 不用跟着重打包。
 *
 * 关键修复（社区实拍反馈）：WebView 默认跟随系统「字体/显示大小」做 textZoom，
 * 会把站点响应式撑到「公告压住 Logo、导航竖排成单字」。这里锁死 100% + 16sp
 * 基准字号，原生栏文字则固定单行 ellipsize，不受影响。
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
    private PullRefreshFrame pull;
    private TextView barTitle;
    private TextView barSubtitle;
    private View navBack, navForward, navHome, navRefresh;
    private ValueCallback<Uri[]> filePathCallback;
    private long lastBackAt = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        web = findViewById(R.id.webview);
        progress = findViewById(R.id.progress);
        splash = findViewById(R.id.splash);
        errorView = findViewById(R.id.error);
        pull = findViewById(R.id.pull);
        barTitle = findViewById(R.id.bar_title);
        barSubtitle = findViewById(R.id.bar_subtitle);
        navBack = findViewById(R.id.nav_back);
        navForward = findViewById(R.id.nav_forward);
        navHome = findViewById(R.id.nav_home);
        navRefresh = findViewById(R.id.nav_refresh);

        progress.getProgressDrawable().setColorFilter(
                getResources().getColor(R.color.brand_dot), PorterDuff.Mode.SRC_IN);
        barSubtitle.setText(hostOf(siteUrl()));

        bindChrome();
        setupWebView();
        loadSite();
    }

    /** 构建时默认值可被用户在 App 内覆盖一次，之后一直沿用。 */
    private String siteUrl() {
        String saved = getSharedPreferences(PREF, MODE_PRIVATE).getString(KEY_SITE, null);
        return saved != null && saved.length() > 0 ? saved : BuildConfig.SITE_URL;
    }

    private String hostOf(String url) {
        try {
            String h = Uri.parse(url).getHost();
            return h == null ? "" : h;
        } catch (Exception e) {
            return "";
        }
    }

    private void bindChrome() {
        findViewById(R.id.retry).setOnClickListener(v -> loadSite());
        // 三个隐藏入口：换域名时不用重装 APK
        findViewById(R.id.splash_logo).setOnLongClickListener(v -> { showSiteDialog(); return true; });
        findViewById(R.id.error_title).setOnLongClickListener(v -> { showSiteDialog(); return true; });
        findViewById(R.id.bar_logo).setOnLongClickListener(v -> { showSiteDialog(); return true; });

        findViewById(R.id.btn_refresh).setOnClickListener(v -> reload());
        findViewById(R.id.btn_more).setOnClickListener(this::showMoreMenu);
        navBack.setOnClickListener(v -> { if (web.canGoBack()) web.goBack(); updateNav(); });
        navForward.setOnClickListener(v -> { if (web.canGoForward()) web.goForward(); updateNav(); });
        navHome.setOnClickListener(v -> loadSite());
        navRefresh.setOnClickListener(v -> reload());

        pull.setOnRefreshListener(this::reload);
        updateNav();
    }

    private void showMoreMenu(View anchor) {
        PopupMenu pm = new PopupMenu(this, anchor);
        pm.getMenu().add(0, 1, 0, R.string.open_in_browser);
        pm.getMenu().add(0, 2, 1, R.string.site_title);
        pm.getMenu().add(0, 3, 2, R.string.about_app);
        pm.setOnMenuItemClickListener((MenuItem item) -> {
            switch (item.getItemId()) {
                case 1:
                    String u = web.getUrl() != null ? web.getUrl() : siteUrl();
                    openInBrowser(Uri.parse(u));
                    return true;
                case 2:
                    showSiteDialog();
                    return true;
                case 3:
                    new AlertDialog.Builder(this)
                            .setTitle(R.string.about_app)
                            .setMessage(R.string.about_body)
                            .setPositiveButton(android.R.string.ok, null)
                            .show();
                    return true;
                default:
                    return false;
            }
        });
        pm.show();
    }

    /** 原生底栏按钮随历史栈变灰，像 App 而不是浏览器地址栏。 */
    private void updateNav() {
        setNavEnabled(navBack, web.canGoBack());
        setNavEnabled(navForward, web.canGoForward());
    }

    private void setNavEnabled(View v, boolean on) {
        v.setEnabled(on);
        v.setAlpha(on ? 1f : 0.42f);
    }

    /** 初次进入 / 改地址 / 首页 / 重试：带启动遮罩。 */
    private void loadSite() {
        splash.setVisibility(View.VISIBLE);
        progress.setVisibility(View.VISIBLE);
        errorView.setVisibility(View.GONE);
        web.setVisibility(View.VISIBLE);
        barTitle.setText(R.string.app_name);
        barSubtitle.setText(hostOf(siteUrl()));
        updateNav();
        web.loadUrl(siteUrl());
    }

    /** 下拉刷新 / 顶栏刷新 / 底栏刷新：不弹启动屏，只走进度条。 */
    private void reload() {
        errorView.setVisibility(View.GONE);
        web.setVisibility(View.VISIBLE);
        progress.setVisibility(View.VISIBLE);
        web.reload();
    }

    private void updateTitle(String t) {
        if (t != null && t.trim().length() > 0) barTitle.setText(t.trim());
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

        /* ── 锁死网页字号 ──
           Android WebView 默认会让 textZoom 跟随系统的「字体大小 / 显示大小」。
           用户把显示大小调大后，站点响应式会被撑到公告压住 Logo、导航竖排成
           单字（社区实拍反馈）。锁 100% + 固定基准，网页只按自己的 CSS 排版；
           原生栏文字用的是 sp 且单行 ellipsize，不会挤坏布局。 */
        s.setTextZoom(100);
        s.setDefaultFontSize(16);
        s.setMinimumFontSize(12);

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
                updateTitle(v.getTitle());
                updateNav();
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

            @Override
            public void onReceivedTitle(WebView v, String title) {
                updateTitle(title);
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
        // 只盖内容区：原生上下栏还在，看起来仍是 App 而不是浏览器错误页
        errorView.setVisibility(View.VISIBLE);
    }

    /** 站点迁移 / 换域名时不用重装 APK；长按启动 Logo / 顶栏 Logo / 断网标题即可改。 */
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
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (web.canGoBack()) {
                web.goBack();
                updateNav();
                return true;
            }
            long now = System.currentTimeMillis();
            if (now - lastBackAt < 2000) {
                finish();
                return true;
            }
            lastBackAt = now;
            Toast.makeText(this, R.string.press_back_again, Toast.LENGTH_SHORT).show();
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
