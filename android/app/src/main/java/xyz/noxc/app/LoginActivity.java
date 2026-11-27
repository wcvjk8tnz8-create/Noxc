package xyz.noxc.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

/** 原生登录页：邮箱 + 密码直连 /api/auth/login，复杂流程（注册 / OAuth）交系统浏览器。 */
public class LoginActivity extends Activity {

    private Api api;
    private EditText email;
    private EditText password;
    private CheckBox remember;
    private TextView error;
    private ProgressBar progress;
    private Button submit;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_login);
        api = new Api(this);
        email = findViewById(R.id.login_email);
        password = findViewById(R.id.login_password);
        remember = findViewById(R.id.login_remember);
        error = findViewById(R.id.login_error);
        progress = findViewById(R.id.login_progress);
        submit = findViewById(R.id.login_submit);

        submit.setOnClickListener(v -> doLogin());
        findViewById(R.id.login_register).setOnClickListener(v -> openWeb("register"));
        findViewById(R.id.login_forgot).setOnClickListener(v -> openWeb("login"));
        findViewById(R.id.login_oauth_nodeloc).setOnClickListener(v -> openWeb("login"));
        findViewById(R.id.login_oauth_github).setOnClickListener(v -> openWeb("login"));
    }

    private void doLogin() {
        String mail = email.getText().toString().trim().toLowerCase();
        String pass = password.getText().toString();
        if (mail.length() == 0 || pass.length() == 0) {
            error.setText(R.string.login_empty);
            return;
        }
        error.setText("");
        submit.setEnabled(false);
        progress.setVisibility(View.VISIBLE);
        JSONObject body = new JSONObject();
        try {
            body.put("email", mail);
            body.put("password", pass);
            body.put("remember", remember.isChecked());
        } catch (Exception ignored) { }
        api.post(api.endpoint("login", "/api/auth/login"), body, r -> {
            submit.setEnabled(true);
            progress.setVisibility(View.GONE);
            if (r.ok && api.loggedIn()) {
                Toast.makeText(this, R.string.login_success, Toast.LENGTH_SHORT).show();
                setResult(RESULT_OK);
                finish();
            } else {
                error.setText(r.message.length() > 0 ? r.message : getString(R.string.err_api));
            }
        });
    }

    private void openWeb(String path) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(api.web(path))));
        } catch (Exception e) {
            Toast.makeText(this, R.string.no_browser, Toast.LENGTH_SHORT).show();
        }
    }
}
