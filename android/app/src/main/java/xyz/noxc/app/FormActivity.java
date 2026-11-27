package xyz.noxc.app;

import android.os.Bundle;
import android.view.View;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.appbar.MaterialToolbar;
import com.google.android.material.progressindicator.CircularProgressIndicator;

/** 三个原生账号表单共享的骨架：MaterialToolbar 返回键 / 错误文本 / 加载指示器。 */
public abstract class FormActivity extends AppCompatActivity {

    protected Api api;
    protected TextView errorView;
    protected CircularProgressIndicator progress;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        api = new Api(this);
    }

    protected void bindForm() {
        MaterialToolbar toolbar = findViewById(R.id.toolbar);
        if (toolbar != null) toolbar.setNavigationOnClickListener(v -> finish());
        errorView = findViewById(R.id.form_error);
        progress = findViewById(R.id.form_progress);
    }

    protected void showError(String msg) {
        if (errorView != null) errorView.setText(msg);
    }

    protected void clearError() {
        if (errorView != null) errorView.setText("");
    }

    protected void busy(boolean on) {
        if (progress != null) progress.setVisibility(on ? View.VISIBLE : View.GONE);
    }
}
