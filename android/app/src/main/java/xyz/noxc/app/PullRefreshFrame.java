package xyz.noxc.app;

import android.content.Context;
import android.util.AttributeSet;
import android.view.MotionEvent;
import android.view.View;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.TextView;

/**
 * 轻量原生下拉刷新容器（零 AndroidX）。
 *
 * 为什么不用 SwipeRefreshLayout：它属于 AndroidX，而这个工程刻意只依赖 Android
 * 平台 API，CI 不必拉任何额外依赖。这里只在「网页已经滚到最顶 + 手势近乎垂直 +
 * 下拉超过阈值」时拦截，其余手势全部原样交给 WebView，表格横滚、长按、输入框
 * 拖动都不受影响。
 */
public class PullRefreshFrame extends FrameLayout {

    public interface OnRefreshListener {
        void onRefresh();
    }

    private OnRefreshListener listener;
    private float downX, downY, pullDist;
    private boolean intercepting;
    private final float density;
    private final float startSlop;     // 判定「开始下拉」的位移
    private final float releaseSlop;  // 松手触发刷新的位移

    public PullRefreshFrame(Context c, AttributeSet a) {
        super(c, a);
        density = c.getResources().getDisplayMetrics().density;
        startSlop = 14 * density;
        releaseSlop = 64 * density;
    }

    public void setOnRefreshListener(OnRefreshListener l) {
        listener = l;
    }

    /** WebView 在滚动时会请求父容器别拦截；这里保留顶部下拉的拦截能力。 */
    @Override
    public void requestDisallowInterceptTouchEvent(boolean disallow) {
        super.requestDisallowInterceptTouchEvent(false);
    }

    private boolean childAtTop() {
        View w = findViewById(R.id.webview);
        return w == null || w.getScrollY() <= 0;
    }

    private TextView hint() {
        return (TextView) findViewById(R.id.pull_hint);
    }

    private void showHint(float ratio) {
        TextView h = hint();
        if (h == null) return;
        h.setAlpha(Math.min(1f, ratio));
        h.setTranslationY(-14 * density * (1f - Math.min(1f, ratio)));
        h.setText(pullDist >= releaseSlop
                ? getContext().getString(R.string.pull_release)
                : getContext().getString(R.string.pull_hint));
    }

    private void hideHint() {
        TextView h = hint();
        if (h != null) {
            h.setAlpha(0f);
            h.setTranslationY(-14 * density);
        }
    }

    @Override
    public boolean onInterceptTouchEvent(MotionEvent ev) {
        final int action = ev.getActionMasked();
        if (action == MotionEvent.ACTION_DOWN) {
            downX = ev.getX();
            downY = ev.getY();
            pullDist = 0;
            intercepting = false;
            return false;
        }
        if (action == MotionEvent.ACTION_MOVE && !intercepting) {
            float dy = ev.getY() - downY;
            float dx = ev.getX() - downX;
            if (dy > startSlop && dy > Math.abs(dx) * 1.3f && childAtTop()) {
                intercepting = true;
                downY = ev.getY();   // 重新设基准，提示条从 0 开始跟手
                pullDist = 0;
                return true;
            }
        }
        return false;
    }

    @Override
    public boolean onTouchEvent(MotionEvent ev) {
        if (!intercepting) return super.onTouchEvent(ev);
        final int action = ev.getActionMasked();
        if (action == MotionEvent.ACTION_MOVE) {
            pullDist = Math.max(0f, ev.getY() - downY);
            showHint(pullDist / releaseSlop);
            return true;
        }
        if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
            boolean fire = action == MotionEvent.ACTION_UP && pullDist >= releaseSlop;
            hideHint();
            intercepting = false;
            pullDist = 0;
            if (fire && listener != null) listener.onRefresh();
            return true;
        }
        return true;
    }
}
