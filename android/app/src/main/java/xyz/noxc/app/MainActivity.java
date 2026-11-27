package xyz.noxc.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.google.android.material.appbar.MaterialToolbar;
import com.google.android.material.bottomnavigation.BottomNavigationView;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.android.material.progressindicator.LinearProgressIndicator;
import com.google.android.material.textfield.MaterialAutoCompleteTextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Noxc 手机版 · Material 3 完全原生 App（零 WebView）
 *
 * UI 全部是 AndroidX / Material Components 控件：MaterialToolbar、BottomNavigationView、
 * SwipeRefreshLayout、MaterialShapeDrawable 卡片、MaterialButton、TextInputLayout、
 * LinearProgressIndicator。冷启动只打 /api/app/v1/bootstrap 一个接口。
 *
 * 登录 / 注册 / 找回密码全部是 App 内原生表单（LoginActivity / RegisterActivity /
 * ForgotPasswordActivity），**不再跳外部浏览器**。文档 / 后台 / 条款用 Chrome Custom Tab
 * 在 App 内打开（Api.openInApp），视觉上不离开 App。
 */
public class MainActivity extends AppCompatActivity {

    private static final int REQ_LOGIN = 7;
    private static final int[] TAB_IDS = {
            R.id.tab_home, R.id.tab_domains, R.id.tab_points, R.id.tab_profile};
    private static final int[] TAB_TITLES = {
            R.string.tab_home, R.string.tab_domains, R.string.tab_points, R.string.tab_profile};

    private Api api;
    private JSONObject appData;
    private JSONObject site;
    private JSONObject endpoints;
    private boolean booted;
    private int page = 0;
    private long lastBackAt;

    private MaterialToolbar toolbar;
    private BottomNavigationView bottomNav;
    private SwipeRefreshLayout swipe;
    private LinearProgressIndicator progress;
    private View[] pageViews;
    private LinearLayout[] pageContainers;
    private View splash;
    private View errorView;
    private TextView barTitle;
    private TextView barSubtitle;

    private LinearLayout homeTop;
    private LinearLayout lookupResultBox;
    private EditText lookupInput;
    private MaterialAutoCompleteTextView rootSpinner;
    private ArrayAdapter<String> rootAdapter;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        api = new Api(this);

        toolbar = findViewById(R.id.toolbar);
        bottomNav = findViewById(R.id.bottom_nav);
        swipe = findViewById(R.id.swipe);
        progress = findViewById(R.id.progress);
        pageViews = new View[]{
                findViewById(R.id.view_home), findViewById(R.id.view_domains),
                findViewById(R.id.view_points), findViewById(R.id.view_profile)};
        pageContainers = new LinearLayout[]{
                findViewById(R.id.page_home), findViewById(R.id.page_domains),
                findViewById(R.id.page_points), findViewById(R.id.page_profile)};
        splash = findViewById(R.id.splash);
        errorView = findViewById(R.id.error);
        barTitle = findViewById(R.id.bar_title);
        barSubtitle = findViewById(R.id.bar_subtitle);
        barSubtitle.setText(api.host());

        /* AGP 8 起 app module 的 R.id 字段也非 final，不能用在 switch case
           （需要编译期常量），否则 javac 报 constant expression required。
           这里用 if/else 按 id 比较。 */
        toolbar.setOnMenuItemClickListener(item -> {
            int id = item.getItemId();
            if (id == R.id.action_refresh) { boot(true); return true; }
            if (id == R.id.action_full_web) { openWeb(""); return true; }
            if (id == R.id.action_change_site) { showSiteDialog(); return true; }
            if (id == R.id.action_about) {
                new MaterialAlertDialogBuilder(this)
                        .setTitle(R.string.about_app)
                        .setMessage(R.string.about_body)
                        .setPositiveButton(android.R.string.ok, null)
                        .show();
                return true;
            }
            return false;
        });

        bottomNav.setOnItemSelectedListener(item -> {
            for (int i = 0; i < TAB_IDS.length; i++) {
                if (item.getItemId() == TAB_IDS[i]) { showPage(i); return true; }
            }
            return false;
        });
        swipe.setOnRefreshListener(() -> boot(true));

        findViewById(R.id.retry).setOnClickListener(v -> boot(true));
        findViewById(R.id.splash_logo).setOnLongClickListener(v -> { showSiteDialog(); return true; });
        findViewById(R.id.error_title).setOnLongClickListener(v -> { showSiteDialog(); return true; });
        ((ImageView) findViewById(R.id.bar_logo))
                .setOnLongClickListener(v -> { showSiteDialog(); return true; });

        showPage(0);
        boot(false);
    }

    /* ══════════════ 启动：一个专用接口拿全四页 ══════════════ */

    private void boot(boolean fresh) {
        if (!booted) splash.setVisibility(View.VISIBLE);
        errorView.setVisibility(View.GONE);
        progress.setVisibility(View.VISIBLE);
        api.bootstrap(fresh, r -> {
            progress.setVisibility(View.GONE);
            swipe.setRefreshing(false);
            if (!r.ok) {
                showError(r.message);
                return;
            }
            appData = r.data;
            site = appData.optJSONObject("site");
            endpoints = appData.optJSONObject("endpoints");
            if (site == null) site = new JSONObject();
            if (endpoints == null) endpoints = new JSONObject();
            Api.setEndpoints(endpoints);
            booted = true;
            splash.setVisibility(View.GONE);
            barSubtitle.setText(api.host());
            renderHome();
            renderLoggedPages();
        });
    }

    private void showError(String msg) {
        splash.setVisibility(View.GONE);
        progress.setVisibility(View.GONE);
        swipe.setRefreshing(false);
        errorView.setVisibility(View.VISIBLE);
        if (msg != null && msg.length() > 0) {
            Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
        }
    }

    private void renderLoggedPages() {
        renderProfile();
        if (page == 1) loadDomains();
        else if (page == 2) loadPoints();
    }

    private void showPage(int idx) {
        page = idx;
        for (int i = 0; i < 4; i++) {
            pageViews[i].setVisibility(i == idx ? View.VISIBLE : View.GONE);
        }
        barTitle.setText(TAB_TITLES[idx]);
        if (idx == 0) renderHome();
        else if (idx == 1) loadDomains();
        else if (idx == 2) loadPoints();
        else renderProfile();
    }

    private JSONObject user() {
        return appData == null ? null : appData.optJSONObject("user");
    }

    private String ep(String key, String fallback) {
        String v = endpoints == null ? "" : endpoints.optString(key, "");
        return v.length() > 0 ? v : fallback;
    }

    /* ══════════════ 首页 ══════════════ */

    private void ensureHomeSkeleton() {
        if (homeTop != null) return;
        homeTop = new LinearLayout(this);
        homeTop.setOrientation(LinearLayout.VERTICAL);
        pageContainers[0].addView(homeTop, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        buildLookupCard();
    }

    private void buildLookupCard() {
        LinearLayout c = Ui.card(this);
        c.addView(Ui.title(this, getString(R.string.home_lookup)));

        lookupInput = new EditText(this);
        lookupInput.setHint(R.string.lookup_hint);
        lookupInput.setSingleLine(true);
        lookupInput.setTextSize(16);
        lookupInput.setTextColor(getResources().getColor(R.color.bar_text));
        lookupInput.setHintTextColor(getResources().getColor(R.color.bar_dim));
        lookupInput.setBackground(Ui.shape(this,
                getResources().getColor(R.color.input_bg),
                getResources().getColor(R.color.bar_hair), 14));
        lookupInput.setPadding(Ui.dp(this, 14), Ui.dp(this, 10), Ui.dp(this, 14), Ui.dp(this, 10));
        c.addView(lookupInput, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        // Material 3 Exposed Dropdown：后缀选择也是原生 M3 控件
        rootSpinner = new MaterialAutoCompleteTextView(this);
        rootSpinner.setHint(R.string.lookup_root);
        rootSpinner.setTextColor(getResources().getColor(R.color.bar_text));
        rootSpinner.setBackground(Ui.shape(this,
                getResources().getColor(R.color.input_bg),
                getResources().getColor(R.color.bar_hair), 14));
        rootSpinner.setPadding(Ui.dp(this, 14), Ui.dp(this, 12), Ui.dp(this, 14), Ui.dp(this, 12));
        rootSpinner.setSingleLine(true);
        rootAdapter = new ArrayAdapter<>(this,
                android.R.layout.simple_dropdown_item_1line, new ArrayList<String>());
        rootSpinner.setAdapter(rootAdapter);
        rootSpinner.setOnItemClickListener((parent, v, pos, id) -> { });
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        sp.setMargins(0, Ui.dp(this, 10), 0, Ui.dp(this, 10));
        c.addView(rootSpinner, sp);

        c.addView(Ui.pill(this, getString(R.string.lookup_button), v -> doLookup()),
                new LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT, Ui.dp(this, 46)));

        lookupResultBox = new LinearLayout(this);
        lookupResultBox.setOrientation(LinearLayout.VERTICAL);
        c.addView(lookupResultBox);
        pageContainers[0].addView(c);
    }

    private void renderHome() {
        ensureHomeSkeleton();
        homeTop.removeAllViews();
        if (site == null) return;

        homeTop.addView(Ui.headline(this, getString(R.string.home_tagline)));
        TextView sub = Ui.body(this, site.optString("siteName", "Noxc"));
        sub.setPadding(0, Ui.dp(this, 6), 0, Ui.dp(this, 14));
        homeTop.addView(sub);

        String ann = site.optString("announcement", "").trim();
        if (ann.length() > 0) {
            LinearLayout c = Ui.card(this);
            c.addView(Ui.title(this, getString(R.string.announcement_label)));
            c.addView(Ui.body(this, ann));   // 纯文本，不解析 HTML
            homeTop.addView(c);
        }
        String mig = site.optString("migrationNotice", "").trim();
        if (mig.length() > 0) {
            LinearLayout c = Ui.card(this);
            c.addView(Ui.title(this, getString(R.string.migration_label)));
            c.addView(Ui.body(this, mig));
            homeTop.addView(c);
        }

        JSONObject st = site.optJSONObject("publicStats");
        if (st != null) {
            LinearLayout c = Ui.card(this);
            c.addView(Ui.title(this, getString(R.string.home_stats)));
            c.addView(Ui.row(this, getString(R.string.stat_domains), num(st, "domains")));
            c.addView(Ui.row(this, getString(R.string.stat_users), num(st, "users")));
            String hot = st.optString("hottest", "");
            if (hot.length() > 0) {
                c.addView(Ui.row(this, getString(R.string.stat_hottest), hot + "  " + getString(R.string.hot)));
            }
            homeTop.addView(c);
        }

        JSONObject pr = site.optJSONObject("pointRules");
        if (pr != null) {
            LinearLayout c = Ui.card(this);
            c.addView(Ui.title(this, getString(R.string.home_rules)));
            c.addView(Ui.row(this, getString(R.string.rule_checkin), "+" + num(pr, "checkin")));
            c.addView(Ui.row(this, getString(R.string.rule_initial), "+" + num(pr, "initial")));
            c.addView(Ui.row(this, getString(R.string.rule_domain), "-" + num(pr, "domainCost")));
            c.addView(Ui.row(this, getString(R.string.rule_short), "-" + num(pr, "shortCost")));
            homeTop.addView(c);
        }
        fillRoots();
    }

    private void fillRoots() {
        if (rootAdapter == null || site == null) return;
        String old = String.valueOf(rootSpinner.getText());
        JSONArray roots = site.optJSONArray("rootDomains");
        JSONArray paused = site.optJSONArray("pausedRoots");
        Set<String> pausedSet = new HashSet<>();
        if (paused != null) {
            for (int i = 0; i < paused.length(); i++) {
                String s = paused.optString(i, "");
                if (s.length() > 0) pausedSet.add(s.toLowerCase());
            }
        }
        List<String> open = new ArrayList<>();
        if (roots != null) {
            for (int i = 0; i < roots.length(); i++) {
                String s = roots.optString(i, "").trim().toLowerCase();
                if (s.length() > 0 && !pausedSet.contains(s)) open.add(s);
            }
        }
        if (open.isEmpty()) {
            String one = site.optString("rootDomain", "noxc.uk").trim().toLowerCase();
            if (one.length() > 0) open.add(one);
        }
        rootAdapter.clear();
        rootAdapter.addAll(open);
        rootAdapter.notifyDataSetChanged();
        if (open.contains(old)) rootSpinner.setText(old, false);
        else if (!open.isEmpty()) rootSpinner.setText(open.get(0), false);
    }

    private void doLookup() {
        String label = lookupInput.getText().toString().trim().toLowerCase()
                .replaceAll("[^a-z0-9-]", "");
        if (label.length() == 0) {
            Toast.makeText(this, R.string.lookup_empty, Toast.LENGTH_SHORT).show();
            return;
        }
        String root = String.valueOf(rootSpinner.getText()).trim();
        if (root.length() == 0) return;
        final String fqdnGuess = label + "." + root;
        lookupResultBox.removeAllViews();
        lookupResultBox.addView(Ui.body(this, getString(R.string.loading)));
        api.get(ep("check", "/api/subdomains/check") + "?label=" + Uri.encode(label)
                + "&root=" + Uri.encode(root), r -> renderLookup(r, label, root, fqdnGuess));
    }

    private void renderLookup(Api.Reply r, String label, String root, String fqdnGuess) {
        lookupResultBox.removeAllViews();
        LinearLayout c = Ui.card(this);
        if (!r.ok) {
            c.addView(Ui.body(this, r.message.length() > 0 ? r.message : getString(R.string.err_api)));
            lookupResultBox.addView(c);
            return;
        }
        final String fqdn = r.data.optString("fqdn", fqdnGuess);
        boolean available = r.data.optBoolean("available");
        c.addView(Ui.title(this, fqdn));
        c.addView(Ui.body(this, available
                ? getString(R.string.lookup_available)
                : getString(R.string.lookup_taken) + " · " + r.data.optString("message", "")));
        c.addView(Ui.row(this, getString(R.string.lookup_cost), num(r.data, "cost")));
        int points = r.data.optInt("points", -1);
        if (points >= 0) c.addView(Ui.row(this, getString(R.string.lookup_points), String.valueOf(points)));
        if (r.data.optBoolean("applyPaused")) {
            c.addView(Ui.body(this, getString(R.string.lookup_paused)));
        }
        Ui.hairline(this, c);
        c.addView(Ui.pill(this, getString(R.string.lookup_apply), v ->
                openWeb("register?label=" + Uri.encode(label) + "&root=" + Uri.encode(root))));
        c.addView(Ui.pill(this, getString(R.string.lookup_whois), v -> whois(fqdn)),
                topMarginParams());
        lookupResultBox.addView(c);
    }

    private void whois(String fqdn) {
        api.get(ep("whois", "/api/whois") + "?name=" + Uri.encode(fqdn), r -> {
            LinearLayout c = Ui.card(this);
            if (!r.ok) {
                c.addView(Ui.body(this, r.message.length() > 0 ? r.message : getString(R.string.err_api)));
            } else {
                c.addView(Ui.title(this, r.data.optString("fqdn", fqdn)));
                c.addView(Ui.row(this, getString(R.string.whois_status),
                        r.data.optString("statusText", "")));
                String holder = r.data.optString("holder", "");
                if (holder.length() > 0 && !"null".equals(holder)) {
                    c.addView(Ui.row(this, getString(R.string.whois_holder), holder));
                }
                c.addView(Ui.row(this, getString(R.string.whois_records),
                        num(r.data, "recordCount")));
                long at = r.data.optLong("registeredAt", 0);
                if (at > 0) {
                    c.addView(Ui.row(this, getString(R.string.whois_registered),
                            new java.text.SimpleDateFormat("yyyy-MM-dd",
                                    java.util.Locale.getDefault()).format(new java.util.Date(at))));
                }
            }
            lookupResultBox.addView(c, topMarginParams());
        });
    }

    /* ══════════════ 我的域名 ══════════════ */

    private void loadDomains() {
        LinearLayout p = pageContainers[1];
        p.removeAllViews();
        p.addView(Ui.headline(this, getString(R.string.domains_mine)));
        if (!api.loggedIn() || user() == null) {
            p.addView(loginCard());
            return;
        }
        JSONObject d = appData.optJSONObject("domains");
        if (d == null) {
            p.addView(errorCard(getString(R.string.err_api)));
            return;
        }
        LinearLayout q = Ui.card(this);
        q.addView(Ui.row(this, getString(R.string.quota_used),
                d.optInt("used", 0) + " / " + d.optString("quota", "")));
        p.addView(q);
        p.addView(Ui.pill(this, getString(R.string.apply_new), v -> openWeb("register")),
                topMarginParams());

        JSONArray items = d.optJSONArray("items");
        if (items == null || items.length() == 0) {
            LinearLayout c = Ui.card(this);
            c.addView(Ui.body(this, getString(R.string.no_domains)));
            p.addView(c, topMarginParams());
            return;
        }
        for (int i = 0; i < items.length(); i++) {
            JSONObject o = items.optJSONObject(i);
            if (o == null) continue;
            final int id = o.optInt("id", 0);
            final String fqdn = o.optString("fqdn", "");
            LinearLayout c = Ui.card(this);
            c.addView(Ui.title(this, fqdn));
            c.addView(Ui.body(this, statusLabel(o.optString("status", ""))
                    + (o.optBoolean("dnsPaused") ? " · " + getString(R.string.dns_paused) : "")));
            c.addView(Ui.row(this, getString(R.string.domain_records), num(o, "record_count")));
            c.setClickable(true);
            c.setOnClickListener(v -> {
                Intent it = new Intent(this, DomainDetailActivity.class);
                it.putExtra(DomainDetailActivity.EXTRA_ID, id);
                it.putExtra(DomainDetailActivity.EXTRA_FQDN, fqdn);
                startActivity(it);
            });
            p.addView(c, topMarginParams());
        }
    }

    private String statusLabel(String s) {
        switch (s) {
            case "pending": return getString(R.string.status_pending);
            case "approved": return getString(R.string.status_approved);
            case "rejected": return getString(R.string.status_rejected);
            case "suspended": return getString(R.string.status_suspended);
            case "reserved": return getString(R.string.status_reserved);
            default: return s;
        }
    }

    /* ══════════════ 积分 ══════════════ */

    private void loadPoints() {
        LinearLayout p = pageContainers[2];
        p.removeAllViews();
        p.addView(Ui.headline(this, getString(R.string.tab_points)));
        if (!api.loggedIn() || user() == null) {
            p.addView(loginCard());
            return;
        }
        JSONObject r = appData.optJSONObject("points");
        if (r == null) {
            p.addView(errorCard(getString(R.string.err_api)));
            return;
        }
        LinearLayout bal = Ui.card(this);
        bal.addView(Ui.title(this, getString(R.string.points_balance)));
        bal.addView(Ui.bigNum(this, r.optBoolean("unlimited")
                ? getString(R.string.points_unlimited) : num(r, "points")));
        p.addView(bal);

        boolean can = r.optBoolean("canCheckIn");
        LinearLayout ck = Ui.card(this);
        View.OnClickListener onCheck = can ? v -> checkin() : null;
        ck.addView(Ui.pill(this, can ? getString(R.string.points_checkin)
                : getString(R.string.points_checked), onCheck));
        p.addView(ck, topMarginParams());

        JSONObject rules = r.optJSONObject("rules");
        if (rules != null) {
            LinearLayout rc = Ui.card(this);
            rc.addView(Ui.title(this, getString(R.string.home_rules)));
            rc.addView(Ui.row(this, getString(R.string.rule_checkin), "+" + num(rules, "checkin")));
            rc.addView(Ui.row(this, getString(R.string.rule_initial), "+" + num(rules, "initial")));
            rc.addView(Ui.row(this, getString(R.string.rule_domain), "-" + num(rules, "domainCost")));
            rc.addView(Ui.row(this, getString(R.string.rule_short), "-" + num(rules, "shortCost")));
            p.addView(rc, topMarginParams());
        }

        LinearLayout lc = Ui.card(this);
        lc.addView(Ui.title(this, getString(R.string.points_logs)));
        JSONArray logs = r.optJSONArray("logs");
        if (logs == null || logs.length() == 0) {
            lc.addView(Ui.body(this, getString(R.string.points_no_logs)));
        } else {
            for (int i = 0; i < logs.length(); i++) {
                JSONObject o = logs.optJSONObject(i);
                if (o == null) continue;
                int delta = o.optInt("delta", 0);
                lc.addView(Ui.row(this, (delta >= 0 ? "+" : "") + delta,
                        o.optString("reason", "") + " " + o.optString("detail", "")));
            }
        }
        p.addView(lc, topMarginParams());
    }

    private void checkin() {
        api.post(ep("checkin", "/api/points/checkin"), new JSONObject(), r -> {
            Toast.makeText(this, r.message.length() > 0 ? r.message : getString(R.string.err_api),
                    Toast.LENGTH_SHORT).show();
            boot(true);
        });
    }

    /* ══════════════ 我的 ══════════════ */

    private void renderProfile() {
        LinearLayout p = pageContainers[3];
        p.removeAllViews();
        p.addView(Ui.headline(this, getString(R.string.tab_profile)));
        JSONObject u = user();
        if (!api.loggedIn() || u == null) {
            p.addView(loginCard());
            p.addView(Ui.pill(this, getString(R.string.profile_register),
                    v -> startActivityForResult(new Intent(this, RegisterActivity.class), REQ_LOGIN)),
                    topMarginParams());
            p.addView(webLinksCard(), topMarginParams());
            return;
        }
        LinearLayout c = Ui.card(this);
        c.addView(Ui.title(this, getString(R.string.profile_account)));
        c.addView(Ui.row(this, getString(R.string.profile_email), u.optString("email", "")));
        c.addView(Ui.row(this, getString(R.string.profile_role), u.optString("role", "")));
        c.addView(Ui.row(this, getString(R.string.profile_quota), u.optString("quota", "")));
        c.addView(Ui.row(this, getString(R.string.quota_used),
                String.valueOf(appData.optInt("used", 0))));
        p.addView(c);
        p.addView(Ui.pill(this, getString(R.string.profile_logout), v ->
                api.logout(r -> {
                    Toast.makeText(this, R.string.logged_out, Toast.LENGTH_SHORT).show();
                    boot(true);
                })), topMarginParams());
        p.addView(webLinksCard(), topMarginParams());
    }

    private LinearLayout webLinksCard() {
        LinearLayout c = Ui.card(this);
        c.addView(Ui.title(this, getString(R.string.profile_web_more)));
        c.addView(Ui.pill(this, getString(R.string.profile_web_console), v -> openWeb("dashboard")));
        c.addView(Ui.pill(this, getString(R.string.profile_web_docs), v -> openWeb("docs")),
                topMarginParams());
        c.addView(Ui.pill(this, getString(R.string.profile_web_terms), v -> openWeb("terms")),
                topMarginParams());
        c.addView(Ui.pill(this, getString(R.string.profile_web_external),
                v -> openWeb("external-domains")), topMarginParams());
        c.addView(Ui.pill(this, getString(R.string.profile_web_report), v -> openWeb("report")),
                topMarginParams());
        return c;
    }

    private LinearLayout loginCard() {
        LinearLayout c = Ui.card(this);
        c.addView(Ui.body(this, getString(R.string.need_login)));
        c.addView(Ui.pill(this, getString(R.string.login_now), v ->
                startActivityForResult(new Intent(this, LoginActivity.class), REQ_LOGIN)),
                topMarginParams());
        return c;
    }

    private LinearLayout errorCard(String msg) {
        LinearLayout c = Ui.card(this);
        c.addView(Ui.body(this, msg != null && msg.length() > 0
                ? msg : getString(R.string.err_api)));
        return c;
    }

    /* ══════════════ 通用 ══════════════ */

    private LinearLayout.LayoutParams topMarginParams() {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, Ui.dp(this, 10), 0, 0);
        return lp;
    }

    private static String num(JSONObject o, String k) {
        return String.valueOf(o == null ? 0 : o.optInt(k, 0));
    }

    /** 文档 / 后台 / 条款用 Custom Tab 在 App 内打开，不甩给外部浏览器。 */
    private void openWeb(String path) {
        api.openInApp(this, path);
    }

    private void showSiteDialog() {
        final EditText input = new EditText(this);
        input.setText(api.base());
        input.setSingleLine(true);
        input.setSelection(input.getText().length());
        new MaterialAlertDialogBuilder(this)
                .setTitle(R.string.site_title)
                .setMessage(R.string.site_body)
                .setView(input)
                .setPositiveButton(R.string.site_save, (d, w) -> {
                    String v = input.getText().toString().trim();
                    if (v.length() == 0) return;
                    api.setSite(v);
                    api.clearSession();
                    appData = null;
                    site = null;
                    booted = false;
                    barSubtitle.setText(api.host());
                    boot(true);
                })
                .setNegativeButton(R.string.cancel, null)
                .show();
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == REQ_LOGIN && res == RESULT_OK) boot(true);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
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
}
