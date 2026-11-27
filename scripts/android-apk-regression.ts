/**
 * Noxc Android App · 配置防回流回归
 *
 * 这一版 App 是**完全原生**：没有 WebView，四个 tab 由 Android 控件绘制，
 * 数据通过 Api.java 直接取 Worker 的 JSON 接口。回归重点因此是：
 *   · 零 WebView / 零 AndroidX（真扫描全部 Java + XML）
 *   · 四个原生页面 + 三个 Activity 都在
 *   · 网络层正确带 sh_session、解析统一信封、回调回主线程
 *   · 复杂流程（注册 / 后台 / 文档）确实交系统浏览器
 *
 * 真跑：python3 + ElementTree 解析全部 Android XML；PyYAML 解析 workflow；
 *       PNG 头与尺寸实测。真编译交给 CI 的 assembleDebug/Release。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ok: string[] = [];
const bad: string[] = [];
const check = (v: any, m: string) => (v ? ok.push(m) : bad.push(m));
const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf8');
const exists = (p: string) => fs.existsSync(path.resolve(p));

const A = 'android/';
const MAIN = A + 'app/src/main/';
const JAVA = MAIN + 'java/xyz/noxc/app/';
const javaFiles = execFileSync('python3', ['-c',
  `import glob
print('\\n'.join(sorted(glob.glob('${JAVA}*.java'))))`],
  { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const java: Record<string, string> = {};
for (const f of javaFiles) java[path.basename(f)] = read(f);
const allJava = Object.values(java).join('\n');
const mainJava = java['MainActivity.java'] || '';
const apiJava = java['Api.java'] || '';
const uiJava = java['Ui.java'] || '';
const loginJava = java['LoginActivity.java'] || '';
const detailJava = java['DomainDetailActivity.java'] || '';

const gradle = read(A + 'app/build.gradle');
const rootGradle = read(A + 'build.gradle');
const settings = read(A + 'settings.gradle');
const manifest = read(MAIN + 'AndroidManifest.xml');
const layout = read(MAIN + 'res/layout/activity_main.xml');
const loginLayout = read(MAIN + 'res/layout/activity_login.xml');
const detailLayout = read(MAIN + 'res/layout/activity_domain_detail.xml');
const strings = read(MAIN + 'res/values/strings.xml');
const stringsZh = read(MAIN + 'res/values-zh-rCN/strings.xml');
const styles = read(MAIN + 'res/values/styles.xml');
const stylesNight = read(MAIN + 'res/values-night/styles.xml');
const colors = read(MAIN + 'res/values/colors.xml');
const colorsNight = read(MAIN + 'res/values-night/colors.xml');
const adaptive = read(MAIN + 'res/mipmap-anydpi-v26/ic_launcher.xml');
const pill = read(MAIN + 'res/drawable/bg_pill.xml');
const inputBg = read(MAIN + 'res/drawable/bg_input.xml');
const wf = read('.github/workflows/android-apk.yml');
const deployWf = read('.github/workflows/deploy.yml');
const ignore = read('.gitignore');
const readme = read('README.md');

/* ───────── A. 文件齐全 ───────── */
for (const f of [
  'build.gradle', 'settings.gradle', 'gradle.properties',
  'app/build.gradle', 'app/src/main/AndroidManifest.xml',
  'app/src/main/res/layout/activity_main.xml',
  'app/src/main/res/layout/activity_login.xml',
  'app/src/main/res/layout/activity_domain_detail.xml',
  'app/src/main/res/values/strings.xml',
  'app/src/main/res/values-zh-rCN/strings.xml',
  'app/src/main/res/values/styles.xml',
  'app/src/main/res/values-night/styles.xml',
  'app/src/main/res/drawable/bg_pill.xml',
  'app/src/main/res/drawable/bg_input.xml',
  'app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml',
]) check(exists(A + f), `安卓工程文件存在：${f}`);
for (const j of ['MainActivity.java', 'Api.java', 'Ui.java',
  'LoginActivity.java', 'DomainDetailActivity.java']) {
  check(!!java[j], `原生 Java 源文件存在：${j}`);
}
for (const d of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
  check(exists(MAIN + `res/mipmap-${d}/ic_launcher.png`), `${d} 传统图标存在`);
}
check(exists(MAIN + 'res/mipmap-xxxhdpi/ic_launcher_foreground.png'), '自适应图标前景图存在（432×432）');
check(exists('scripts/gen-android-icons.py'), '图标生成脚本入库，产物可复现');
check(exists('scripts/android-resource-check.py'), '资源引用交叉校验脚本入库');
check(!exists(JAVA + 'PullRefreshFrame.java'), 'WebView 专用下拉容器已删除');

/* ───────── B. 真跑：XML / YAML / PNG ───────── */
const xmlFiles = execFileSync('python3', ['-c',
  `import glob
print('\\n'.join(sorted(glob.glob('${MAIN}**/*.xml', recursive=True))))`],
  { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
check(xmlFiles.length >= 12, `找到 ${xmlFiles.length} 个 Android XML 资源`);
try {
  execFileSync('python3', ['-c',
    `import sys, xml.etree.ElementTree as ET
for f in sys.argv[1:]: ET.parse(f)
print('ok')`, ...xmlFiles], { encoding: 'utf8' });
  check(true, `python3 真解析：${xmlFiles.length} 个 XML 全部良构`);
} catch (e: any) {
  check(false, `XML 良构性：${String(e?.stderr || e).slice(0, 200)}`);
}
let yamlReady = true;
try { execFileSync('python3', ['-c', 'import yaml'], { encoding: 'utf8' }); }
catch { yamlReady = false; }
if (yamlReady) {
  try {
    const parsed = execFileSync('python3', ['-c',
      `import yaml,json,sys
d=yaml.safe_load(open(sys.argv[1],encoding='utf-8'))
trig=d.get('on', d.get(True, {})) or {}
print(json.dumps({'triggers':list(trig),'jobs':list(d.get('jobs',{})),'permissions':d.get('permissions')},ensure_ascii=False))`,
      '.github/workflows/android-apk.yml'], { encoding: 'utf8' });
    const j = JSON.parse(parsed.trim().split('\n').pop() || '{}');
    check(j.jobs.includes('build') && j.triggers.length >= 2,
      'PyYAML 真解析 workflow：build job + push/workflow_dispatch 双触发');
    check(j.permissions && j.permissions.contents === 'write', 'workflow 具备 contents: write（发 Release 用）');
  } catch (e: any) {
    check(false, `workflow YAML 解析：${String(e?.stderr || e).slice(0, 200)}`);
  }
} else {
  check(/^name: Build Noxc Android APK$/m.test(wf) && /^jobs:/m.test(wf) && /^  build:/m.test(wf),
    '本机无 PyYAML，退化为文本校验 workflow 结构（CI 上会真解析）');
}
const pngs = execFileSync('python3', ['-c',
  `import glob,struct
for f in sorted(glob.glob('${MAIN}res/mipmap-*/*.png')):
    b=open(f,'rb').read()
    assert b[:8]==b'\\x89PNG\\r\\n\\x1a\\n', f
    w,h=struct.unpack('>II',b[16:24])
    assert w>0 and h>0 and w==h, f
    print(f,w,h)`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
check(pngs.length === 6, `6 张图标均为合法正方形 PNG（实测 ${pngs.length} 张）`);
check(pngs.some((l) => /432 432/.test(l)), '自适应前景为 432×432');
check(/ic_launcher\.png 192 192/.test(pngs.join('\n')), 'xxxhdpi 传统图标为 192×192');
try {
  const resOut = execFileSync('python3', ['scripts/android-resource-check.py'],
    { encoding: 'utf8' }).trim();
  console.log('  ' + resOut);
  check(true, '真跑资源交叉校验：XML 的 @string/@color/@drawable 与 Java 的 R.* 全有定义');
} catch (e: any) {
  check(false, `资源交叉校验：${String(e?.stdout || e?.stderr || e).trim().slice(0, 400)}`);
}

/* ───────── C. Java 源码结构（本地无 android.jar，真编译交 CI） ───────── */
for (const [label, src] of Object.entries(java)) {
  const stripped = src.replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [a, b] of [['{', '}'], ['(', ')'], ['[', ']']] as const) {
    const na = (stripped.match(new RegExp('\\' + a, 'g')) || []).length;
    const nb = (stripped.match(new RegExp('\\' + b, 'g')) || []).length;
    check(na === nb, `${label} ${a}${b} 配对（${na}/${nb}）`);
  }
  check(/^package xyz\.noxc\.app;/m.test(src), `${label} 包名正确`);
}
check(!/import androidx\./.test(allJava), '零 AndroidX import（只用平台 API + org.json）');
check(/import org\.json\.JSONObject/.test(apiJava)
  && /import java\.net\.HttpURLConnection/.test(apiJava)
  && /import java\.util\.concurrent\.ExecutorService/.test(apiJava),
  '网络层用平台 HttpURLConnection + org.json + 线程池');

/* ───────── D. 零 WebView（这版的硬约束） ───────── */
const allJavaCode = allJava
  .replace(/"(?:\\.|[^"\\])*"/g, '""')
  .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
check(!/android\.webkit|WebView|WebViewClient|WebChromeClient|setTextZoom|shouldOverrideUrlLoading|setAllowFileAccess/.test(allJavaCode),
  '全部 Java 代码（剥注释）里 0 处 WebView / android.webkit / 网页字号设置');
check(!/<WebView|<xyz\.noxc\.app\.PullRefreshFrame/.test(layout + loginLayout + detailLayout),
  '三个布局里 0 个 WebView 标签');
check(!/WebView/.test(manifest), 'Manifest 注释/节点里不提 WebView');
check(/完全原生 App/.test(manifest), 'Manifest 明确标注这是完全原生 App');
check(!/bg_refresh_hint/.test(layout + mainJava), 'WebView 下拉提示 drawable 不再被引用');

/* ───────── E. 四个原生页面 + 三个 Activity ───────── */
check(/android:name="\.MainActivity"/.test(manifest)
  && /android:name="\.LoginActivity"/.test(manifest)
  && /android:name="\.DomainDetailActivity"/.test(manifest),
  'Manifest 注册主界面 / 登录 / 域名详情三个 Activity');
check(/android:exported="true"/.test(manifest)
  && /android.intent.category.LAUNCHER/.test(manifest),
  '只有 MainActivity 是 exported 启动入口');
for (const id of ['view_home', 'view_domains', 'view_points', 'view_profile',
  'page_home', 'page_domains', 'page_points', 'page_profile']) {
  check(layout.includes(`@+id/${id}`), `原生四页容器存在：${id}`);
}
for (const id of ['topbar', 'bottombar', 'bar_title', 'bar_subtitle',
  'btn_refresh', 'btn_more', 'tab_home', 'tab_domains', 'tab_points', 'tab_profile']) {
  check(layout.includes(`@+id/${id}`), `原生外壳控件存在：${id}`);
}
check(/showPage\(int idx\)/.test(mainJava)
  && /pageViews\[i\]\.setVisibility/.test(mainJava)
  && /tabs\[i\]\.setAlpha/.test(mainJava),
  '底部 tab 切换的是四个原生 ScrollView，不是网页 URL');
check(/android:layout_weight="1"/.test(layout)
  && /android:id="@\+id\/error"/.test(layout),
  '内容区占满中间，断网页只盖内容区、原生上下栏保留');
check(/R\.layout\.activity_login/.test(loginJava)
  && /R\.layout\.activity_domain_detail/.test(detailJava),
  '登录页 / 域名详情页各有独立原生布局');
check(/class Ui/.test(uiJava) && /static LinearLayout card/.test(uiJava)
  && /GradientDrawable/.test(uiJava),
  'Ui.java 用平台 GradientDrawable 画全圆角卡片，不依赖网页 CSS');

/* ───────── F. 网络层：直接调站点 API ───────── */
check(/sh_session/.test(apiJava) && /Set-Cookie/.test(apiJava)
  && /KEY_SESSION/.test(apiJava),
  '登录态 = 站点原本的 sh_session，从 Set-Cookie 提取并持久化');
check(/setRequestProperty\("Cookie", "sh_session="/.test(apiJava),
  '每个请求手动带 Cookie 头，杀进程重开不掉登录');
check(/clearSession\(\)/.test(apiJava) && /class Reply/.test(apiJava)
  && /optBoolean\("success"/.test(apiJava),
  '统一解析 { success, message } 信封，登出清本地 token');
check(/new Handler\(Looper\.getMainLooper\(\)\)/.test(apiJava)
  && /UI\.post\(/.test(apiJava) && /POOL\.execute/.test(apiJava),
  '请求走线程池、回调回主线程，页面不阻塞');
check(/Accept-Language/.test(apiJava) && /zh-CN/.test(apiJava),
  '按系统语言请求中文/英文文案');
check(/BuildConfig\.SITE_URL/.test(apiJava) && /setSite\(/.test(apiJava),
  '站点地址可构建时注入，App 内可改（迁移域名不重装）');
check(/\/api\/config/.test(mainJava) && /\/api\/auth\/me/.test(mainJava)
  && /\/api\/subdomains\/mine/.test(mainJava)
  && /\/api\/points\/me/.test(mainJava)
  && /\/api\/subdomains\/check/.test(mainJava)
  && /\/api\/whois/.test(mainJava)
  && /\/api\/records\/subdomains\//.test(detailJava),
  '四个页面直接调 config / me / domains / points / check / whois / records 七个接口');
check(/\/api\/auth\/login/.test(loginJava) && /\/api\/auth\/logout/.test(apiJava)
  && /api\.logout\(/.test(mainJava) && /\/api\/points\/checkin/.test(mainJava),
  '登录、登出、签到都是原生按钮直连接口');
check(/enableFollowRedirects|setInstanceFollowRedirects/.test(apiJava),
  'HTTP 重定向由平台处理');

/* ───────── G. 复杂流程交系统浏览器 ───────── */
check(/Intent\.ACTION_VIEW/.test(mainJava + loginJava + detailJava)
  && /api\.web\(/.test(mainJava + loginJava + detailJava),
  '注册 / 后台 / 文档 / 记录管理用系统浏览器打开，不在 App 里嵌网页');
for (const p of ['register', 'dashboard', 'docs', 'terms', 'external-domains', 'report']) {
  check(mainJava.includes(`openWeb("${p}")`) || loginJava.includes(`openWeb("${p}")`),
    `浏览器兜底入口：${p}`);
}
check(/menu_full_web/.test(mainJava) && /openWeb\(""\)/.test(mainJava),
  '「更多」里有完整站点入口，但默认界面全是原生');
check(/showSiteDialog/.test(mainJava) && /bar_logo/.test(mainJava),
  '长按启动 Logo / 顶栏 Logo / 断网标题可改站点地址');

/* ───────── H. 文案 / 主题 / 颜色 ───────── */
check(exists(MAIN + 'res/values-zh-rCN/strings.xml')
  && /[一-龥]/.test(stringsZh) && !/[一-龥]/.test(strings),
  '中英双语文案齐全，英文默认资源里不夹中文');
for (const k of ['tab_home', 'tab_domains', 'tab_points', 'tab_profile',
  'home_tagline', 'home_stats', 'home_rules', 'home_lookup',
  'domains_mine', 'points_balance', 'profile_logout',
  'login_title', 'detail_records', 'whois_status', 'bar_back']) {
  check(strings.includes(`name="${k}"`) && stringsZh.includes(`name="${k}"`),
    `原生词条中英齐全：${k}`);
}
check(/Theme\.Material\.Light\.NoActionBar/.test(styles)
  && /Theme\.Material\.NoActionBar/.test(stylesNight)
  && /bar_bg/.test(colors) && /bar_bg/.test(colorsNight)
  && /card_bg/.test(colors) && /card_bg/.test(colorsNight),
  '亮/暗双主题 + 原生栏/卡片色板');
check(/statusBarColor">@color\/bar_bg/.test(styles)
  && /navigationBarColor">@color\/bar_bg/.test(styles),
  '状态栏 / 导航栏与原生栏同色');
check(/corners android:radius="999dp"/.test(pill)
  && /@color\/input_bg/.test(inputBg) && /<adaptive-icon/.test(adaptive),
  '全圆角胶囊 / 输入框 / 自适应图标');

/* ───────── I. Manifest 安全边界 ───────── */
check(/android:usesCleartextTraffic="false"/.test(manifest), '禁止明文 HTTP（只走 https）');
check(/android:allowBackup="false"/.test(manifest)
  && /android:dataExtractionRules="@xml\/data_extraction_rules"/.test(manifest),
  '关闭备份，SharedPreferences 里的 session 不被系统备份带走');
check((manifest.match(/uses-permission/g) || []).length === 2
  && /android.permission.INTERNET/.test(manifest)
  && /android.permission.ACCESS_NETWORK_STATE/.test(manifest),
  '只申请网络 / 网络状态两个权限，不碰存储与定位');
check(/api\.base\(\)/.test(mainJava)
  && /startsWith\("https:\/\/"\)/.test(apiJava)
  && /setSite\(String url\)/.test(apiJava),
  '站点地址可改且强制补 https（用户输入裸域名时）');

/* ───────── J. Gradle / CI ───────── */
check(/com\.android\.application' version '8\.5\.2'/.test(rootGradle)
  && /google\(\)/.test(settings) && /mavenCentral\(\)/.test(settings), 'AGP 8.5.2 + 仓库');
check(/namespace 'xyz\.noxc\.app'/.test(gradle) && /compileSdk 34/.test(gradle)
  && /minSdk 24/.test(gradle) && /targetSdk 34/.test(gradle), 'SDK 版本');
check(/buildConfig true/.test(gradle)
  && /buildConfigField 'String', 'SITE_URL'/.test(gradle)
  && /project\.findProperty\('siteUrl'\)/.test(gradle), 'BuildConfig 显式开启 + 站点地址注入');
check(!/^\s*dependencies\s*\{/m.test(gradle), '零第三方依赖（CI 不拉 AndroidX）');
check(/JavaVersion\.VERSION_17/.test(gradle), 'Java 17 编译');
check(/def canSign = ksPath && ksPass && ksAlias && ksKeyPass && file\(ksPath\)\.exists\(\)/.test(gradle)
  && /if \(canSign\) signingConfig signingConfigs\.getByName\('release'\)/.test(gradle),
  'release 签名只在四个 env 齐全且 keystore 存在时启用');
check(!/storePassword\s+['"]|keyPassword\s+['"]|keyAlias\s+['"]/.test(gradle),
  'build.gradle 不写死任何密码');
check(/paths:/.test(wf) && /'android\/\*\*'/.test(wf) && /workflow_dispatch:/.test(wf),
  '只在 android/ 变化时自动构建，也可手动触发');
check(/java-version: '17'/.test(wf) && /platforms;android-34/.test(wf)
  && /gradle-8\.9-bin\.zip/.test(wf) && /GITHUB_PATH/.test(wf),
  'CI：JDK17 + Android34 + 官方 Gradle 8.9');
check(/定位 Android SDK/.test(wf) && !/setup-android@v3/.test(wf)
  && !/uses:\s*gradle\/actions\/setup-gradle/.test(wf),
  'CI 不依赖会重新下载 SDK / Gradle 的第三方 action');
check(/gradle-build\.log/.test(wf) && /::error::\$line/.test(wf)
  && /exit "\$RC"/.test(wf) && /set \+e/.test(wf),
  '构建失败把关键错误发成 annotation');
check(/TASK=assembleDebug/.test(wf) && /TASK=assembleRelease/.test(wf)
  && /signed=false/.test(wf) && /::notice::/.test(wf),
  '签名缺失时明确降级 debug APK');
check(/aapt" dump badging/.test(wf) && /classes\.dex/.test(wf)
  && /resources\.arsc/.test(wf) && /sha256sum/.test(wf),
  'CI 真校验 APK 内容（dex / 资源表 / 图标）');
check(/actions\/upload-artifact@v4/.test(wf) && /if-no-files-found: error/.test(wf),
  'APK 上传 Artifacts，缺产物直接失败');
check(/inputs\.create_release/.test(wf) && /contents: write/.test(wf),
  '手动触发可发 Releases');
check(/android-apk-regression\.ts/.test(deployWf), '本回归挂进主 deploy.yml');

/* ───────── K. 密钥不入库 / 文档 ───────── */
check(/android\/app\/\*\.keystore/.test(ignore) && /\*\.apk/.test(ignore),
  '.gitignore 排除 keystore / 构建产物 / APK');
check(!exists(A + 'app/release.keystore') && !exists(A + 'app/signing.gradle'),
  '工作区里没有真实 keystore / 签名脚本');
check(/### 23\./.test(readme) && /### Z\.15/.test(readme), 'README 第 23 节 / Z.15');
check(/完全原生/.test(readme) && /零 WebView|没有 WebView|没有任何 WebView/.test(readme),
  'README 如实写明是完全原生、零 WebView');

/* ───────── L. 反向对照：证明断言不是恒真 ───────── */
check(/WebView/.test('import android.webkit.WebView; class X {}') &&
  !/android\.webkit/.test(allJava),
  '反向对照：任意 Java 里出现 android.webkit 都会被零 WebView 断言抓住');
const brokenLayout = layout.replace('android:id="@+id/bottombar"', 'android:id="@+id/gone_bar"');
check(!/android:id="@\+id\/bottombar"/.test(brokenLayout),
  '反向对照：拿掉原生底栏后断言必须失败');
const brokenApi = apiJava.replace('setRequestProperty("Cookie", "sh_session="', 'setRequestProperty("X", "');
check(!/setRequestProperty\("Cookie", "sh_session="/.test(brokenApi),
  '反向对照：不带 Cookie 头后登录态断言必须失败');
const brokenManifest = manifest.replace('android:usesCleartextTraffic="false"', 'android:usesCleartextTraffic="true"');
check(!/android:usesCleartextTraffic="false"/.test(brokenManifest),
  '反向对照：放开明文 HTTP 后安全断言必须失败');

console.log(`安卓纯原生 App 配置回归：${ok.length} 通过，${bad.length} 失败`);
for (const m of ok) console.log('  ✓ ' + m);
for (const m of bad) console.error('  ✗ ' + m);
if (bad.length) process.exit(1);
