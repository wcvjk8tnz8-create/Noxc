package xyz.noxc.app;

import android.os.Bundle;
import android.widget.EditText;
import android.widget.Toast;

import org.json.JSONObject;

/** 原生 Material 3 找回密码：发码 → 填码 + 新密码 → /api/auth/reset，全程不跳浏览器。 */
public class ForgotPasswordActivity extends FormActivity {

    private EditText email, code, newPassword;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_forgot);
        bindForm();

        email = findViewById(R.id.forgot_email);
        code = findViewById(R.id.forgot_code);
        newPassword = findViewById(R.id.forgot_new_password);

        findViewById(R.id.forgot_send).setOnClickListener(v -> sendCode());
        findViewById(R.id.forgot_submit).setOnClickListener(v -> submit());
        findViewById(R.id.forgot_go_login).setOnClickListener(v -> finish());
    }

    private void sendCode() {
        String mail = email.getText().toString().trim().toLowerCase();
        if (!mail.contains("@")) { showError(getString(R.string.err_email_required)); return; }
        clearError();
        busy(true);
        JSONObject b = new JSONObject();
        try { b.put("email", mail); b.put("scene", "reset"); } catch (Exception ignored) { }
        api.post(api.endpoint("verifySend", "/api/auth/verify/send"), b, r -> {
            busy(false);
            if (r.ok) Toast.makeText(this, R.string.code_sent, Toast.LENGTH_LONG).show();
            else showError(r.message.length() > 0 ? r.message : getString(R.string.err_api));
        });
    }

    private void submit() {
        String mail = email.getText().toString().trim().toLowerCase();
        String vcode = code.getText().toString().trim();
        String pass = newPassword.getText().toString();
        if (!mail.contains("@")) { showError(getString(R.string.err_email_required)); return; }
        if (vcode.length() == 0) { showError(getString(R.string.err_code_required)); return; }
        if (pass.length() < 8) { showError(getString(R.string.err_password_short)); return; }
        clearError();
        busy(true);
        JSONObject b = new JSONObject();
        try {
            b.put("email", mail);
            b.put("code", vcode);
            b.put("password", pass);
        } catch (Exception ignored) { }
        api.post(api.endpoint("reset", "/api/auth/reset"), b, r -> {
            busy(false);
            if (r.ok) {
                Toast.makeText(this, R.string.forgot_success, Toast.LENGTH_LONG).show();
                finish();
            } else {
                showError(r.message.length() > 0 ? r.message : getString(R.string.err_api));
            }
        });
    }
}
