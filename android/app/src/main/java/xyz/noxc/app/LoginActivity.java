package xyz.noxc.app;

import android.content.Intent;
import android.os.Bundle;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.Toast;

import org.json.JSONObject;

/** 原生 Material 3 登录：邮箱 + 密码直连 /api/auth/login，注册/找回也是原生页面。 */
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
                    setResult(RESULT_OK);
                    finish();
                } else {
                    showError(r.message.length() > 0 ? r.message : getString(R.string.err_api));
                }
            });
        });

        // 全部 App 内原生页面，不再跳浏览器
        findViewById(R.id.login_register).setOnClickListener(v ->
                startActivity(new Intent(this, RegisterActivity.class)));
        findViewById(R.id.login_forgot).setOnClickListener(v ->
                startActivity(new Intent(this, ForgotPasswordActivity.class)));
        // 第三方 OAuth 走应用内 Custom Tab（授权规范需要浏览器安全上下文，但不离开 App）
        findViewById(R.id.login_oauth_nodeloc).setOnClickListener(v ->
                openOAuth("oauthNodeloc", "/api/auth/nodeloc/start"));
        findViewById(R.id.login_oauth_github).setOnClickListener(v ->
                openOAuth("oauthGithub", "/api/auth/github/start"));
    }

    private void openOAuth(String key, String fallback) {
        Toast.makeText(this, R.string.oauth_opening, Toast.LENGTH_SHORT).show();
        api.openInApp(this, api.endpoint(key, fallback));
    }
}
