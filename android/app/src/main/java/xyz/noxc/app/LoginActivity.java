package xyz.noxc.app;

import android.content.Intent;
import android.os.Bundle;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Toast;

import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import org.json.JSONObject;

/**
 * 原生 Material 3 登录：邮箱密码直连 /api/auth/login，注册 / 找回也是原生页面。
 *
 * 第三方登录不再由 App 直接跳 /api/auth/github/start —— 真机上 Custom Tab 常停在
 * 空白页（授权跳转需要浏览器完整上下文、凭据未配置时还会返回 JSON）。改成用户要的
 * 「浏览器授权登录」：
 *   1. 点「浏览器授权登录」→ Custom Tab 打开 /app-authorize（Worker 直出 HTML，
 *      永远不会空白）；在页面里用邮箱 / GitHub / NodeLoc 正常登录。
 *   2. 登录后点「授权给 App」拿到一次性码，点「一键返回 App」(noxc://auth?code=)
 *      由 MainActivity 自动兑换；或复制码回这里点「输入授权码」粘贴。
 *   3. /api/app/v1/auth/exchange 换到站点原有 sh_session，权限口径完全一致。
 */
public class LoginActivity extends FormActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_login);
        bindForm();

        final EditText email = findViewById(R.id.login_email);
        final EditText password = findViewById(R.id.login_password);
        final CheckBox remember = findViewById(R.id.login_remember);

        findViewById(R.id.login_submit).setOnClickListener(v -> {
            String mail = email.getText().toString().trim().toLowerCase();
            String pass = password.getText().toString();
            if (mail.length() == 0 || pass.length() == 0) {
                showError(getString(R.string.login_empty));
                return;
            }
            clearError();
            busy(true);
            JSONObject body = new JSONObject();
            try {
                body.put("email", mail);
                body.put("password", pass);
                body.put("remember", remember.isChecked());
            } catch (Exception ignored) { }
            api.post(api.endpoint("login", "/api/auth/login"), body, r -> {
                busy(false);
                if (r.ok && api.loggedIn()) {
                    Toast.makeText(this, R.string.login_success, Toast.LENGTH_SHORT).show();
                    finishWithLogin();
                } else {
                    showError(r.message.length() > 0 ? r.message : getString(R.string.err_api));
                }
            });
        });

        findViewById(R.id.login_register).setOnClickListener(v ->
                startActivity(new Intent(this, RegisterActivity.class)));
        findViewById(R.id.login_forgot).setOnClickListener(v ->
                startActivity(new Intent(this, ForgotPasswordActivity.class)));

        findViewById(R.id.login_browser_auth).setOnClickListener(v -> showBrowserAuth());
        findViewById(R.id.login_auth_code).setOnClickListener(v -> promptCode());
    }

    private void showBrowserAuth() {
        new MaterialAlertDialogBuilder(this)
                .setTitle(R.string.login_browser_auth)
                .setMessage(R.string.browser_auth_help)
                .setPositiveButton(R.string.browser_auth_open, (d, w) ->
                        api.openInApp(this, api.endpoint("appAuthorize", "/app-authorize")))
                .setNeutralButton(R.string.login_auth_code, (d, w) -> promptCode())
                .setNegativeButton(R.string.cancel, null)
                .show();
    }

    /* 注意：prompt()/pick()/confirm() 是 OpsActivity 的 helper，FormActivity 没有。
       这里直接内联一个 M3 对话框，避免「cannot find symbol」编译失败。 */
    private void promptCode() {
        final EditText input = new EditText(this);
        input.setHint(R.string.auth_code_hint);
        input.setSingleLine(true);
        input.setTextColor(getResources().getColor(R.color.bar_text));
        input.setHintTextColor(getResources().getColor(R.color.bar_dim));
        LinearLayout box = new LinearLayout(this);
        box.setPadding(Ui.dp(this, 24), Ui.dp(this, 8), Ui.dp(this, 24), 0);
        box.addView(input, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT));
        new MaterialAlertDialogBuilder(this)
                .setTitle(R.string.login_auth_code)
                .setView(box)
                .setNegativeButton(R.string.cancel, null)
                .setPositiveButton(R.string.common_ok, (d, w) ->
                        exchange(input.getText().toString().trim()))
                .show();
    }

    /** 用浏览器授权页的一次性码换会话；成功即回到主界面刷新登录态。 */
    public void exchange(String code) {
        String clean = code == null ? "" : code.toUpperCase().replaceAll("[^A-Z0-9]", "");
        if (clean.length() < 8) {
            showError(getString(R.string.browser_auth_failed));
            return;
        }
        clearError();
        busy(true);
        JSONObject body = new JSONObject();
        try { body.put("code", clean); } catch (Exception ignored) { }
        api.epPost("appTokenExchange", body, r -> {
            busy(false);
            if (r.ok) {
                // Set-Cookie 由 Api.execute 自动保存；响应体 token 是双保险
                String t = r.data.optString("token", "");
                if (t.length() > 0) api.saveSession(t);
                Toast.makeText(this, R.string.browser_auth_success, Toast.LENGTH_SHORT).show();
                finishWithLogin();
            } else {
                showError(r.message.length() > 0 ? r.message
                        : getString(R.string.browser_auth_failed));
            }
        });
    }

    private void finishWithLogin() {
        setResult(RESULT_OK);
        finish();
    }
}
