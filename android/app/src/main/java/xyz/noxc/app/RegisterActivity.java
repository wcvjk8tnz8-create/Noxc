package xyz.noxc.app;

import android.os.Bundle;
import android.view.View;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.Toast;

import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import org.json.JSONObject;

/** 原生 Material 3 注册：邮箱规则提示 / 验证码 / 条款勾选全部在 App 内完成。 */
public class RegisterActivity extends FormActivity {

    private EditText email, password, confirm, code;
    private CheckBox agree;
    private View codeBlock, sendCode;
    private boolean requireCode = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_register);
        bindForm();

        email = findViewById(R.id.reg_email);
        password = findViewById(R.id.reg_password);
        confirm = findViewById(R.id.reg_confirm);
        code = findViewById(R.id.reg_code);
        agree = findViewById(R.id.reg_agree);
        codeBlock = findViewById(R.id.til_reg_code);
        sendCode = findViewById(R.id.reg_send_code);

        // 验证码是否必填由后台开关决定（bootstrap 的 site.verifyRequired）
        codeBlock.setVisibility(View.GONE);
        sendCode.setVisibility(View.GONE);
        api.bootstrap(false, r -> {
            if (r.ok) {
                JSONObject s = r.data.optJSONObject("site");
                requireCode = s != null && s.optBoolean("verifyRequired")
                        || s != null && s.optBoolean("mailVerifyRequired");
                codeBlock.setVisibility(requireCode ? View.VISIBLE : View.GONE);
                sendCode.setVisibility(requireCode ? View.VISIBLE : View.GONE);
                String hint = s == null ? "" : s.optString("signupEmailHint", "");
                if (hint.length() > 0) email.setHint(hint);
            }
        });

        sendCode.setOnClickListener(v -> sendCode());
        findViewById(R.id.reg_terms).setOnClickListener(v -> showTerms());
        findViewById(R.id.reg_submit).setOnClickListener(v -> submit());
        findViewById(R.id.reg_go_login).setOnClickListener(v -> finish());
    }

    private void sendCode() {
        String mail = email.getText().toString().trim().toLowerCase();
        if (!mail.contains("@")) { showError(getString(R.string.err_email_required)); return; }
        clearError();
        busy(true);
        JSONObject b = new JSONObject();
        try { b.put("email", mail); b.put("scene", "register"); } catch (Exception ignored) { }
        api.post(api.endpoint("verifySend", "/api/auth/verify/send"), b, r -> {
            busy(false);
            if (r.ok) Toast.makeText(this, R.string.code_sent, Toast.LENGTH_LONG).show();
            else showError(r.message.length() > 0 ? r.message : getString(R.string.err_api));
        });
    }

    private void submit() {
        String mail = email.getText().toString().trim().toLowerCase();
        String pass = password.getText().toString();
        String again = confirm.getText().toString();
        if (!mail.contains("@")) { showError(getString(R.string.err_email_required)); return; }
        if (pass.length() < 8) { showError(getString(R.string.err_password_short)); return; }
        if (!pass.equals(again)) { showError(getString(R.string.err_password_mismatch)); return; }
        if (!agree.isChecked()) { showError(getString(R.string.err_agree_required)); return; }
        String vcode = code.getText().toString().trim();
        if (requireCode && vcode.length() == 0) {
            showError(getString(R.string.err_code_required)); return;
        }
        clearError();
        busy(true);
        JSONObject b = new JSONObject();
        try {
            b.put("email", mail);
            b.put("password", pass);
            b.put("agreeTerms", true);
            if (vcode.length() > 0) b.put("code", vcode);
        } catch (Exception ignored) { }
        api.post(api.endpoint("register", "/api/auth/register"), b, r -> {
            busy(false);
            if (r.ok && api.loggedIn()) {
                Toast.makeText(this, R.string.register_success, Toast.LENGTH_SHORT).show();
                setResult(RESULT_OK);
                finish();
            } else {
                showError(r.message.length() > 0 ? r.message : getString(R.string.err_api));
            }
        });
    }

    private void showTerms() {
        new MaterialAlertDialogBuilder(this)
                .setTitle(R.string.register_terms)
                .setMessage(R.string.terms_body)
                .setPositiveButton(R.string.terms_full, (d, w) ->
                        api.openInApp(this, api.endpoint("webTerms", "/terms")))
                .setNegativeButton(R.string.cancel, null)
                .show();
    }
}
