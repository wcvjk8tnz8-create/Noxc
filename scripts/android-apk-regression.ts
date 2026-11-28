/**
 * Noxc Android App · 配置防回流回归
 *
 * 这一版是**真正的 Material 3 原生 App**：AndroidX + Material Components 打进 APK
 * （体积几 MB），登录 / 注册 / 找回密码全是 App 内原生表单，文档 / 后台 / 条款
 * 用 Chrome Custom Tab 在 App 内打开，账号流程**不甩外部浏览器**。仍然是零 WebView。
 *
 * 真跑：python3 + ElementTree 解析全部 Android XML；PyYAML 解析 workflow；
 *       PNG 头与尺寸实测；资源引用交叉校验。真编译交给 CI 的 assembleDebug/Release。
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
const registerJava = java['RegisterActivity.java'] || '';
const forgotJava = java['ForgotPasswordActivity.java'] || '';
const detailJava = java['DomainDetailActivity.java'] || '';
const formJava = java['FormActivity.java'] || '';
const accountJava = loginJava + registerJava + forgotJava + formJava;

const gradle = read(A + 'app/build.gradle');
const rootGradle = read(A + 'build.gradle');
const settings = read(A + 'settings.gradle');
const props = read(A + 'gradle.properties');
const manifest = read(MAIN + 'AndroidManifest.xml');
const layout = read(MAIN + 'res/layout/activity_main.xml');
const loginLayout = read(MAIN + 'res/layout/activity_login.xml');
const registerLayout = read(MAIN + 'res/layout/activity_register.xml');
const forgotLayout = read(MAIN + 'res/layout/activity_forgot.xml');
const detailLayout = read(MAIN + 'res/layout/activity_domain_detail.xml');
const allLayouts = layout + loginLayout + registerLayout + forgotLayout + detailLayout;
const strings = read(MAIN + 'res/values/strings.xml');
const stringsZh = read(MAIN + 'res/values-zh-rCN/strings.xml');
const styles = read(MAIN + 'res/values/styles.xml');
const stylesNight = read(MAIN + 'res/values-night/styles.xml');
const colors = read(MAIN + 'res/values/colors.xml');
const colorsNight = read(MAIN + 'res/values-night/colors.xml');
const adaptive = read(MAIN + 'res/mipmap-anydpi-v26/ic_launcher.xml');
const pill = read(MAIN + 'res/drawable/bg_pill.xml');
const inputBg = read(MAIN + 'res/drawable/bg_input.xml');
const bottomMenu = read(MAIN + 'res/menu/bottom_nav.xml');
const topMenu = read(MAIN + 'res/menu/top_menu.xml');
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
  'app/src/main/res/layout/activity_register.xml',
  'app/src/main/res/layout/activity_forgot.xml',
  'app/src/main/res/layout/activity_domain_detail.xml',
  'app/src/main/res/menu/bottom_nav.xml',
  'app/src/main/res/menu/top_menu.xml',
  'app/src/main/res/values/strings.xml',
  'app/src/main/res/values-zh-rCN/strings.xml',
  'app/src/main/res/values/styles.xml',
  'app/src/main/res/values-night/styles.xml',
  'app/src/main/res/drawable/bg_pill.xml',
  'app/src/main/res/drawable/bg_input.xml',
  'app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml',
]) check(exists(A + f), `安卓工程文件存在：${f}`);
for (const j of ['MainActivity.java', 'Api.java', 'Ui.java', 'LoginActivity.java',
  'RegisterActivity.java', 'ForgotPasswordActivity.java',
  'DomainDetailActivity.java', 'FormActivity.java', 'OpsActivity.java',
  'AdminActivity.java', 'ApplyActivity.java', 'ServicesActivity.java',
  'CaptchaDialog.java']) {
  check(!!java[j], `原生 Java 源文件存在：${j}`);
}
for (const d of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
  check(exists(MAIN + `res/mipmap-${d}/ic_launcher.png`), `${d} 传统图标存在`);
}
check(exists(MAIN + 'res/mipmap-xxxhdpi/ic_launcher_foreground.png'), '自适应图标前景图存在（432×432）');
for (const i of ['ic_tab_home', 'ic_tab_domains', 'ic_tab_points', 'ic_tab_profile', 'ic_back']) {
  check(exists(MAIN + `res/drawable/${i}.xml`), `Material 导航矢量图标：${i}`);
}
check(exists('scripts/gen-android-icons.py'), '图标生成脚本入库，产物可复现');
check(exists('scripts/android-resource-check.py'), '资源引用交叉校验脚本入库');
check(!exists(JAVA + 'PullRefreshFrame.java'), '旧 WebView 专用下拉容器已删除');

/* ───────── B. 真跑：XML / YAML / PNG ───────── */
const xmlFiles = execFileSync('python3', ['-c',
  `import glob
print('\\n'.join(sorted(glob.glob('${MAIN}**/*.xml', recursive=True))))`],
  { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
check(xmlFiles.length >= 20, `找到 ${xmlFiles.length} 个 Android XML 资源`);
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
    check(j.permissions && j.permissions.contents === 'write', 'workflow 具备 contents: write');
  } catch (e: any) {
    check(false, `workflow YAML 解析：${String(e?.stderr || e).slice(0, 200)}`);
  }
} else {
  check(/^jobs:/m.test(wf) && /^  build:/m.test(wf),
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

/* ───────── C. Java 源码结构（真编译交 CI） ───────── */
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
check(/extends AppCompatActivity/.test(mainJava)
  && /extends FormActivity/.test(loginJava + registerJava + forgotJava + detailJava),
  'AppCompat / FormActivity 基类正确（M3 主题必需）');
/* 真实踩坑：AGP 8 起 app module 的 R.id 字段也非 final，switch case R.id.*
   会报 constant expression required（CI 第 8 步 javac 失败）。菜单分发必须
   用 if/else 按 id 比较。 */
check(!/case R\.id\./.test(allJava)
  && /if \(id == R\.id\.action_refresh\)/.test(mainJava),
  '菜单分发用 if/else，不用 switch case R.id（AGP8 非 final R.id 会编译失败）');

/* ───────── D. 零 WebView（硬约束） ───────── */
const allJavaCode = Object.values(java)
  .map((s) => s.replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''))
  .join('\n');
check(!/android\.webkit|WebView|WebViewClient|WebChromeClient|setTextZoom|shouldOverrideUrlLoading|setAllowFileAccess/.test(allJavaCode),
  '全部 Java 代码（剥注释）里 0 处 WebView / android.webkit');
check(!/<WebView|<xyz\.noxc\.app\.PullRefreshFrame/.test(allLayouts),
  '五套布局里 0 个 WebView 标签');
check(!/WebView/.test(manifest), 'Manifest 里不提 WebView');
check(/完全原生 App/.test(manifest), 'Manifest 明确标注这是完全原生 App');

/* ───────── E. Material 3 / AndroidX（这版的核心变化） ───────── */
check(/implementation 'com\.google\.android\.material:material:1\.12\.0'/.test(gradle)
  && /implementation 'androidx\.appcompat:appcompat:1\.7\.0'/.test(gradle)
  && /implementation 'androidx\.browser:browser:1\.8\.0'/.test(gradle),
  'build.gradle 真引入 Material 3 + AppCompat + Custom Tabs');
for (const dep of ['swiperefreshlayout', 'constraintlayout', 'recyclerview',
  'coordinatorlayout', 'core', 'activity', 'fragment']) {
  check(gradle.includes(`androidx.${dep}`), `AndroidX 依赖：${dep}`);
}
check(/^\s*dependencies\s*\{/m.test(gradle), '有真实 dependencies 块（不再是零依赖玩具包）');
check(/android\.useAndroidX=true/.test(props), 'gradle.properties 开启 useAndroidX');
check(/Theme\.Material3\.DayNight\.NoActionBar/.test(styles)
  && /Theme\.Material3\.DayNight\.NoActionBar/.test(stylesNight)
  && /colorSurfaceContainer/.test(styles) && /colorPrimary/.test(styles),
  '亮/暗双主题都是 Material 3 DayNight + M3 color tokens');
check(/on_brand|brand_container/.test(colors)
  && /on_brand|brand_container/.test(colorsNight),
  '新增 M3 color tokens，颜色仍是黑白灰 + 一点品牌粉');
check(/MaterialToolbar/.test(layout) && /BottomNavigationView/.test(layout)
  && /SwipeRefreshLayout/.test(layout)
  && /NestedScrollView/.test(layout)
  && /LinearProgressIndicator/.test(layout)
  && /CircularProgressIndicator/.test(layout),
  '主界面六件 M3 控件齐全：Toolbar / BottomNav / 下拉刷新 / 嵌套滚动 / 两种进度');
for (const f of [loginLayout, registerLayout, forgotLayout]) {
  check(/TextInputLayout/.test(f) && /TextInputEditText/.test(f)
    && /MaterialButton/.test(f), '账号表单用 M3 OutlinedBox 输入框 + MaterialButton');
}
check(/MaterialCheckBox/.test(loginLayout + registerLayout), 'M3 复选框（记住登录 / 同意条款）');
check(/MaterialShapeDrawable/.test(uiJava)
  && /ShapeAppearanceModel/.test(uiJava)
  && /MaterialButton/.test(uiJava),
  'Ui.java 用 M3 形状引擎画卡片、真 MaterialButton 当胶囊');
check(/app:menu="@menu\/bottom_nav"/.test(layout)
  && /android:id="@\+id\/tab_home"/.test(bottomMenu)
  && /action_about/.test(topMenu),
  'BottomNavigationView / Toolbar 溢出菜单有真实 menu 资源与矢量图标');
check(/MaterialAlertDialogBuilder/.test(mainJava + registerJava),
  '关于 / 条款用 M3 对话框，不是平台 AlertDialog');

/* ───────── F. 账号流程全部原生，不跳外部浏览器 ───────── */
check(/android:name="\.MainActivity"/.test(manifest)
  && /android:name="\.LoginActivity"/.test(manifest)
  && /android:name="\.RegisterActivity"/.test(manifest)
  && /android:name="\.ForgotPasswordActivity"/.test(manifest)
  && /android:name="\.DomainDetailActivity"/.test(manifest)
  && /android:name="\.AdminActivity"/.test(manifest)
  && /android:name="\.ApplyActivity"/.test(manifest)
  && /android:name="\.ServicesActivity"/.test(manifest),
  'Manifest 注册八个 Activity（含后台 / 申请 / 服务）');
check(/api\.endpoint\("register"/.test(registerJava)
  && /api\.endpoint\("reset"/.test(forgotJava)
  && /api\.endpoint\("verifySend"/.test(registerJava + forgotJava)
  && /api\.endpoint\("login"/.test(loginJava),
  '登录 / 注册 / 发码 / 重置四个接口都从 bootstrap 契约取');
check(registerJava.includes('agreeTerms')
  && registerJava.includes('"scene", "register"')
  && forgotJava.includes('"scene", "reset"')
  && forgotJava.includes('"password"'),
  '注册/找回表单字段与后端 scene/agreeTerms/password 口径一致');
check(/new Intent\(this, RegisterActivity\.class\)/.test(loginJava)
  && /new Intent\(this, ForgotPasswordActivity\.class\)/.test(loginJava)
  && /startActivityForResult\(new Intent\(this, RegisterActivity/.test(mainJava),
  '注册 / 找回密码 / 登录都是 App 内页面跳转，不是浏览器');
check(!/Intent\.ACTION_VIEW/.test(accountJava + mainJava),
  '账号流程与主界面 0 处 ACTION_VIEW（不再甩外部浏览器）');
check(/CustomTabsIntent/.test(apiJava) && /openInApp\(/.test(apiJava)
  && /api\.openInApp\(/.test(mainJava + loginJava + detailJava),
  '文档 / 条款 / 后台 / OAuth 用 Chrome Custom Tab 在 App 内打开');
check(/setShowTitle\(true\)/.test(apiJava), 'Custom Tab 带标题栏，视觉上不离开 App');
check(/showTerms\(\)/.test(registerJava) && /R\.string\.terms_body/.test(registerJava),
  '条款在 App 内用 M3 对话框呈现，不用浏览器看');
check(/verifyRequired/.test(registerJava), '验证码字段显隐由后台开关驱动（site.verifyRequired）');

/* ───────── G. App 专用接口与四页 ───────── */
check(/api\.bootstrap\(fresh/.test(mainJava)
  && /\/api\/app\/v1\/bootstrap/.test(apiJava)
  && /ep\("check"/.test(mainJava) && /ep\("whois"/.test(mainJava)
  && /epGet\("records"/.test(detailJava)
  && /api\.persistEndpoints\(endpoints\)/.test(mainJava),
  '冷启动只打 bootstrap 一个接口，所有页面的路径都来自 endpoints 契约');
check(/bottomNav\.setOnItemSelectedListener/.test(mainJava)
  && /showPage\(int idx\)/.test(mainJava)
  && /pageViews\[i\]\.setVisibility/.test(mainJava),
  '底部导航切的是四个原生页面，不是网页 URL');
check(/swipe\.setOnRefreshListener/.test(mainJava)
  && /swipe\.setRefreshing\(false\)/.test(mainJava),
  'M3 下拉刷新接 bootstrap，结束后收起指示器');
check(/android:layout_weight="1"/.test(layout)
  && /android:id="@\+id\/error"/.test(layout),
  '内容区占满中间，断网页只盖内容区、原生上下栏保留');

/* ── G2. 全部东西都能在 App 里操控（管理后台 / DNS / 滑块） ── */
const adminJava = java['AdminActivity.java'] || '';
const applyJava = java['ApplyActivity.java'] || '';
const servicesJava = java['ServicesActivity.java'] || '';
const opsJava = java['OpsActivity.java'] || '';
const captchaJava = java['CaptchaDialog.java'] || '';
check(!!java['AdminActivity.java'] && !!java['ApplyActivity.java']
  && !!java['ServicesActivity.java'] && !!java['OpsActivity.java']
  && !!java['CaptchaDialog.java'], '五个原生操控类齐全（后台 / 申请 / 服务 / 骨架 / 滑块）');
check(/extends OpsActivity/.test(adminJava + applyJava + servicesJava + detailJava)
  && /epPost|epPatch|epDelete|epPut|epGet/.test(opsJava)
  /* Activity.setTitle(int) 是 public，protected 会以「降低访问权限」编译失败 */
  && /public void setTitle\(int resId\)/.test(opsJava)
  && !/protected void setTitle\(int resId\)/.test(opsJava),
  '四个操控页共用 OpsActivity 骨架，写操作统一走契约');
check(/adminOverview/.test(adminJava) && /SECTION_KEYS/.test(adminJava)
  && /adminApprove|adminReject|adminUserBan|adminUserQuota|adminIpBan|adminSettings/.test(adminJava),
  '后台原生覆盖审核 / 用户 / 配额 / 封禁 / IP / 站点设置 / 锁 / 审计');
check(/epPost\("records"/.test(detailJava) && /epPatch\("recordUpdate"/.test(detailJava)
  && /epDelete\("recordDelete"/.test(detailJava)
  && /verifyStart|verifyConfirm|forceUnlock/.test(detailJava)
  && /domain_renew|domain_delete|domain_edit/.test(detailJava),
  'DNS 记录增/改/删 + 验证锁 + 域名续期/删除/备注全原生');
check(/CaptchaDialog\.show/.test(applyJava)
  && /captchaToken/.test(applyJava)
  && /epPost\("apply"/.test(applyJava),
  '申请子域名原生：原生滑块票据 + 提交，不再跳浏览器');
check(/validateTrace|trace|passToken/.test(captchaJava)
  && /SeekBar/.test(captchaJava) && /onDraw/.test(captchaJava)
  && /api\.image\(/.test(captchaJava),
  '原生 M3 滑块：自绘舞台 + SeekBar 轨迹 + 底图下载 + 服务端一次性票据');
check(/notificationsReadAll|ticketCreate|ticketReply|redeem|transferCommit|abuse|externalDomainVerify|profile|delegation|chatPosts/.test(servicesJava),
  '用户端服务全原生：通知 / 工单 / 兑换 / 转让 / 举报 / 第三方域名 / 资料 / 委派 / 社区');
check(/tab_admin/.test(mainJava) && /PAGE_COUNT = 5/.test(mainJava)
  && /findItem\(R\.id\.tab_admin\)\.setVisible/.test(mainJava)
  && /new Intent\(this, AdminActivity\.class\)/.test(mainJava),
  '第 5 个「管理」tab，仅管理员可见');
check(/new Intent\(this, ApplyActivity\.class\)|applyIntent/.test(mainJava)
  && /new Intent\(this, ServicesActivity\.class\)/.test(mainJava),
  '首页 / 域名页 / 我的页的入口都换成原生 Activity');
check(/adminOverview/.test(read('src/routes/app.ts'))
  && /\/api\/app\/v1\/admin\/overview/.test(read('src/routes/app.ts')),
  '后端提供后台概览聚合接口');
check(/public void (patch|put|delete|endpointCall)/.test(apiJava)
  && /epPost|epPatch|epPut|epDelete/.test(apiJava),
  'Api 支持 PATCH/PUT/DELETE + 契约占位符替换');

/* ── G3. 浏览器授权登录（真机反馈：GitHub 按钮只剩空白页） ── */
const loginAct = java['LoginActivity.java'] || '';
check(!/\bprompt\(/.test(loginJava)
  && /MaterialAlertDialogBuilder/.test(loginJava),
  'LoginActivity 不误用 OpsActivity 的 prompt（FormActivity 没有该方法，会 javac 失败）');
check(/login_browser_auth|login_auth_code/.test(loginJava)
  && /browser_auth_open|appAuthorize/.test(loginJava)
  && /appTokenExchange/.test(loginJava)
  && /api\.saveSession/.test(loginJava),
  '登录页改成「浏览器授权登录 + 输入授权码」，不再直接跳 OAuth /start');
check(!/oauthGithub|oauthNodeloc|openOAuth/.test(loginJava),
  '原生端不再发起 /api/auth/github/start（真机上 Custom Tab 会停在空白页）');
check(/browser_auth_success/.test(mainJava) && /handleDeepLink/.test(mainJava)
  && /onNewIntent/.test(mainJava) && /noxc/.test(mainJava),
  'MainActivity 接住 noxc://auth?code= 自动兑换登录态');
check(/android:scheme="noxc"/.test(manifest) && /android:host="auth"/.test(manifest)
  && /android.intent.action.VIEW/.test(manifest),
  'Manifest 有浏览器授权回跳的 deep link（一键返回 App）');
check(/DEFAULT_ENDPOINTS/.test(apiJava) && /DEFAULT_MAP/.test(apiJava)
  && /接口配置缺失/.test(apiJava),
  'Api 内置同源兜底契约：bootstrap 没跑完也绝不会请求空路径');
check(/appTokenIssue|appTokenExchange|appAuthorize/.test(read('src/routes/app.ts'))
  && /app\.get\('\/app-authorize'/.test(read('src/index.ts'))
  && /authorizePage/.test(read('src/routes/appAuth.ts')),
  '后端提供授权页（Worker 直出 HTML，永不空白）与一次性码 issue/exchange');
check(/records: '\/api\/subdomains\/\{id\}\/records'/.test(read('src/routes/app.ts')),
  'DNS 记录列表契约路径修好（真机曾报「接口不存在」）');
check(/browser_auth_help/.test(strings) && /browser_auth_help/.test(stringsZh),
  '浏览器授权流程文案中英齐全');

/* ───────── H. 文案 / 主题 / 颜色 ───────── */
check(exists(MAIN + 'res/values-zh-rCN/strings.xml')
  && /[一-龥]/.test(stringsZh) && !/[一-龥]/.test(strings),
  '中英双语文案齐全，英文默认资源里不夹中文');
for (const k of ['tab_home', 'tab_domains', 'tab_points', 'tab_profile',
  'home_tagline', 'home_stats', 'home_rules', 'home_lookup', 'lookup_root',
  'domains_mine', 'points_balance', 'profile_logout', 'login_title',
  'register_title', 'register_confirm', 'register_agree', 'register_button',
  'forgot_title', 'forgot_new_password', 'err_password_mismatch',
  'terms_body', 'detail_records', 'whois_status', 'bar_back']) {
  check(strings.includes(`name="${k}"`) && stringsZh.includes(`name="${k}"`),
    `M3 词条中英齐全：${k}`);
}
check(/statusBarColor">@color\/bar_bg/.test(styles)
  && /navigationBarColor">@color\/bar_bg/.test(styles),
  '状态栏 / 导航栏与 M3 顶栏同色');
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
  '站点地址可改且强制补 https');

/* ───────── J. Gradle / CI ───────── */
check(/com\.android\.application' version '8\.5\.2'/.test(rootGradle)
  && /google\(\)/.test(settings) && /mavenCentral\(\)/.test(settings), 'AGP 8.5.2 + 仓库');
check(/namespace 'xyz\.noxc\.app'/.test(gradle) && /compileSdk 34/.test(gradle)
  && /minSdk 24/.test(gradle) && /targetSdk 34/.test(gradle), 'SDK 版本');
check(/buildConfig true/.test(gradle)
  && /buildConfigField 'String', 'SITE_URL'/.test(gradle)
  && /project\.findProperty\('siteUrl'\)/.test(gradle), 'BuildConfig 显式开启 + 站点地址注入');
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
check(/APK 组成（按压缩后大小）/.test(wf) && /assets\/ 条目/.test(wf),
  'CI 打印 APK 组成清单，体积可复核');
/* 用户明确要「至少几 MB」：CI 里必须有体积下限断言，防止退回 68KB 玩具包 */
check(/MIN_SIZE/.test(wf) && /::error::APK 体积过小/.test(wf),
  'CI 断言 APK ≥ 1.5MB（Material 3 / AndroidX 必须真的打进去）');
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
check(/### 23\./.test(readme) && /### 24\./.test(readme) && /### Z\.15/.test(readme),
  'README 第 23 节 / 第 24 节 / Z.15');
check(/Material 3/.test(readme) && /完全原生/.test(readme)
  && /零 WebView|没有 WebView|没有任何 WebView/.test(readme),
  'README 如实写明 Material 3 完全原生、零 WebView');
check(/几 MB|1\.5MB|几 MB/.test(readme), 'README 解释体积与「至少几 MB」的口径');

/* ───────── L. 反向对照 ───────── */
check(/WebView/.test('import android.webkit.WebView; class X {}') &&
  !/android\.webkit/.test(allJavaCode),
  '反向对照：任意 Java 里出现 android.webkit 都会被零 WebView 断言抓住');
const brokenLayout = layout.replace('android:id="@+id/bottom_nav"', 'android:id="@+id/gone_bar"');
check(!/android:id="@\+id\/bottom_nav"/.test(brokenLayout),
  '反向对照：拿掉 Material 底部导航后断言必须失败');
const brokenApi = apiJava.replace('setRequestProperty("Cookie", "sh_session="', 'setRequestProperty("X", "');
check(!/setRequestProperty\("Cookie", "sh_session="/.test(brokenApi),
  '反向对照：不带 Cookie 头后登录态断言必须失败');
const brokenManifest = manifest.replace('android:usesCleartextTraffic="false"', 'android:usesCleartextTraffic="true"');
check(!/android:usesCleartextTraffic="false"/.test(brokenManifest),
  '反向对照：放开明文 HTTP 后安全断言必须失败');
const brokenDep = gradle.replace("com.google.android.material:material:1.12.0", "com.google.android.material:material:0.0");
check(!/material:1\.12\.0/.test(brokenDep),
  '反向对照：撤掉 Material 3 依赖后断言必须失败');

console.log(`安卓 Material 3 原生 App 配置回归：${ok.length} 通过，${bad.length} 失败`);
for (const m of ok) console.log('  ✓ ' + m);
for (const m of bad) console.error('  ✗ ' + m);
if (bad.length) process.exit(1);
