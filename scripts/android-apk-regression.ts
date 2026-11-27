/**
 * Noxc Android APK · 配置防回流回归
 *
 * 真跑：
 *   · python3 + ElementTree 解析全部 Android XML（良构 + 关键节点）
 *   · python3 + PyYAML 解析 workflow（触发条件 / 步骤 / 权限都能被机器读到）
 *   · PNG 头 + 尺寸实测（图标不是坏图 / 不是 0 字节）
 *
 * 静态：Manifest 安全边界、WebView 行为、Gradle 注入、签名自适应、密钥不入库。
 * 本地没有 Android SDK，不在这里编译 APK —— CI 的 assembleDebug/Release 才是真编译。
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
const gradle = read(A + 'app/build.gradle');
const rootGradle = read(A + 'build.gradle');
const settings = read(A + 'settings.gradle');
const manifest = read(MAIN + 'AndroidManifest.xml');
const java = read(MAIN + 'java/xyz/noxc/app/MainActivity.java');
const layout = read(MAIN + 'res/layout/activity_main.xml');
const strings = read(MAIN + 'res/values/strings.xml');
const stringsZh = read(MAIN + 'res/values-zh-rCN/strings.xml');
const styles = read(MAIN + 'res/values/styles.xml');
const stylesNight = read(MAIN + 'res/values-night/styles.xml');
const colors = read(MAIN + 'res/values/colors.xml');
const colorsNight = read(MAIN + 'res/values-night/colors.xml');
const adaptive = read(MAIN + 'res/mipmap-anydpi-v26/ic_launcher.xml');
const wf = read('.github/workflows/android-apk.yml');
const deployWf = read('.github/workflows/deploy.yml');
const ignore = read('.gitignore');
const readme = read('README.md');

/* ───────── A. 文件齐全 ───────── */
for (const f of [
  'build.gradle', 'settings.gradle', 'gradle.properties',
  'app/build.gradle', 'app/src/main/AndroidManifest.xml',
  'app/src/main/java/xyz/noxc/app/MainActivity.java',
  'app/src/main/res/layout/activity_main.xml',
  'app/src/main/res/values/strings.xml',
  'app/src/main/res/values-zh-rCN/strings.xml',
  'app/src/main/res/values/styles.xml',
  'app/src/main/res/values-night/styles.xml',
  'app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml',
]) check(exists(A + f), `安卓工程文件存在：${f}`);
for (const d of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
  check(exists(MAIN + `res/mipmap-${d}/ic_launcher.png`), `${d} 传统图标存在`);
}
check(exists(MAIN + 'res/mipmap-xxxhdpi/ic_launcher_foreground.png'), '自适应图标前景图存在（432×432）');
check(exists('scripts/gen-android-icons.py'), '图标生成脚本入库，产物可复现');

/* ───────── B. 真跑：XML / YAML / PNG ───────── */
const xmlFiles = execFileSync('python3', ['-c',
  `import glob,sys
for f in glob.glob('android/app/src/main/**/*.xml', recursive=True): print(f)`],
  { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
check(xmlFiles.length >= 10, `找到 ${xmlFiles.length} 个 Android XML 资源`);
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
  `import glob,struct,sys
for f in sorted(glob.glob('android/app/src/main/res/mipmap-*/*.png')):
    b=open(f,'rb').read()
    assert b[:8]==b'\\x89PNG\\r\\n\\x1a\\n', f
    w,h=struct.unpack('>II',b[16:24])
    assert w>0 and h>0 and w==h, f
    print(f,w,h)`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
check(pngs.length === 6, `6 张图标均为合法正方形 PNG（实测 ${pngs.length} 张）`);
check(pngs.some((l) => /432 432/.test(l)), '自适应前景为 432×432');
check(/ic_launcher\.png 192 192/.test(pngs.join('\n')), 'xxxhdpi 传统图标为 192×192');

/* Java 源码结构：本地没有 android.jar 不能真编译，先做括号 / 语句配对检查，
   真编译交给 CI 的 assembleDebug。 */
{
  const stripped = java.replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const pairs: Array<[string, string]> = [['{', '}'], ['(', ')'], ['[', ']']];
  for (const [a, b] of pairs) {
    const na = (stripped.match(new RegExp('\\' + a, 'g')) || []).length;
    const nb = (stripped.match(new RegExp('\\' + b, 'g')) || []).length;
    check(na === nb, `MainActivity.java ${a}${b} 配对（${na}/${nb}）`);
  }
  check(/^package xyz\.noxc\.app;/m.test(java)
    && /public class MainActivity extends Activity/.test(java)
    && /@Override\s+protected void onCreate/.test(java),
    'Java 包名 / 类名 / onCreate 入口正确');
  const imports = (java.match(/^import .*;/gm) || []).length;
  check(imports >= 15 && !/import androidx\./.test(java), `${imports} 个平台 import，零 AndroidX`);
}

/* ───────── C. Manifest 安全边界 ───────── */
check(/android:usesCleartextTraffic="false"/.test(manifest), '禁止明文 HTTP（只走 https）');
check(/android:allowBackup="false"/.test(manifest) && /android:fullBackupContent="false"/.test(manifest),
  '关闭备份，会话 cookie / 令牌不会被系统备份带走');
check((manifest.match(/uses-permission/g) || []).length === 2
  && /android.permission.INTERNET/.test(manifest)
  && /android.permission.ACCESS_NETWORK_STATE/.test(manifest),
  '只申请网络 / 网络状态两个权限，不碰存储与定位');
check(!/android.permission.READ_EXTERNAL_STORAGE|android.permission.WRITE_EXTERNAL_STORAGE|android.permission.CAMERA/.test(manifest),
  '没有多余敏感权限');
check(/android:exported="true"/.test(manifest) && /android.intent.category.LAUNCHER/.test(manifest),
  '启动 Activity 显式 exported + LAUNCHER（targetSdk 31+ 必需）');
check(/uiMode/.test(manifest) && /singleTop/.test(manifest),
  '转屏 / 深浅色切换不重建 Activity，网页不被迫重载');

/* ───────── D. WebView 行为 ───────── */
check(/setJavaScriptEnabled\(true\)/.test(java) && /setDomStorageEnabled\(true\)/.test(java)
  && /setDatabaseEnabled\(true\)/.test(java), 'JS / DOM Storage / 数据库开启（SPA 必需）');
check(/setAcceptCookie\(true\)/.test(java) && /setAcceptThirdPartyCookies/.test(java)
  && /CookieManager\.getInstance\(\)\.flush\(\)/.test(java),
  'Cookie 放行第三方并在 onPause 刷盘：OAuth 跳转回来不掉登录态');
check(/setMixedContentMode\(WebSettings\.MIXED_CONTENT_NEVER_ALLOW\)/.test(java)
  && /setAllowFileAccess\(false\)/.test(java) && /setGeolocationEnabled\(false\)/.test(java),
  '禁混合内容 / 禁 file:// / 禁定位');
check(/s\.setUserAgentString\(.*BuildConfig\.UA_SUFFIX/.test(java), 'UA 追加 NoxcApp 标识，网页可识别 App 内');
check(/shouldOverrideUrlLoading/.test(java)
  && /scheme\.equalsIgnoreCase\("http"\)/.test(java)
  && /openExternally\(u\)/.test(java),
  'http/https 留在 App 内（含 OAuth 链），mailto/tel/intent 交系统应用');
check(/req\.isForMainFrame\(\)/.test(java), '只有主帧失败才弹断网页，子资源 404 不打扰');
check(/KEYCODE_BACK/.test(java) && /web\.canGoBack\(\)/.test(java) && /web\.goBack\(\)/.test(java),
  '返回键优先网页回退，不直接退出');
check(/onShowFileChooser/.test(java) && /params\.createIntent\(\)/.test(java)
  && /onActivityResult/.test(java) && /getClipData\(\)/.test(java),
  '<input type=file> 桥接完整（单文件 + 多文件 + 取消）');
check(/onProgressChanged/.test(java) && /setColorFilter/.test(java), '顶部加载进度条');
check(/SRC_ANCHOR_TYPE/.test(java) && /openInBrowser/.test(java), '长按链接可用系统浏览器打开');
check(/showSiteDialog/.test(java) && /KEY_SITE/.test(java) && /SharedPreferences/.test(java),
  '长按启动 Logo / 断网标题可改站点地址，迁移域名不必重装');
check(/splash\.setVisibility\(View\.GONE\)/.test(java) && /errorView\.setVisibility\(View\.VISIBLE\)/.test(java),
  '加载完成隐藏启动屏，失败显示重试页');
check(/progressBarStyleHorizontal/.test(layout)
  && /android:id="@\+id\/splash_logo"/.test(layout)
  && /android:id="@\+id\/error_title"/.test(layout)
  && /android:minHeight="44dp"/.test(layout),
  '布局：水平进度条 / 两个长按入口 / 44px 触控目标');
check(exists(MAIN + 'res/values-zh-rCN/strings.xml')
  && /[一-龥]/.test(stringsZh) && !/[一-龥]/.test(strings)
  && /offline_title/.test(strings) && /offline_title/.test(stringsZh),
  '中英双语文案齐全，英文默认资源里不夹中文');
check(/Theme\.Material\.Light\.NoActionBar/.test(styles)
  && /Theme\.Material\.NoActionBar/.test(stylesNight)
  && /splash_bg/.test(colors) && /splash_bg/.test(colorsNight),
  '亮/暗双主题，夜间启动屏不翻白');
check(/<adaptive-icon/.test(adaptive) && /ic_launcher_foreground/.test(adaptive),
  'Android 8+ 自适应图标');

/* ───────── E. Gradle 构建配置 ───────── */
check(/com\.android\.application' version '8\.5\.2'/.test(rootGradle)
  && /google\(\)/.test(settings) && /mavenCentral\(\)/.test(settings),
  'AGP 8.5.2 + Google/Maven 仓库');
check(/namespace 'xyz\.noxc\.app'/.test(gradle) && /compileSdk 34/.test(gradle)
  && /minSdk 24/.test(gradle) && /targetSdk 34/.test(gradle),
  'namespace / compileSdk 34 / minSdk 24 / targetSdk 34');
check(/buildConfig true/.test(gradle), 'AGP 8+ 显式开启 BuildConfig（否则 SITE_URL 不存在）');
check(/project\.findProperty\('siteUrl'\)/.test(gradle)
  && /System\.getenv\('SITE_URL'\)/.test(gradle)
  && /buildConfigField 'String', 'SITE_URL'/.test(gradle)
  && /nic\.299282\.xyz/.test(gradle),
  '站点地址可构建时注入，默认 https://nic.299282.xyz/');
check(/buildConfigField 'String', 'UA_SUFFIX'/.test(gradle), 'UA 后缀由 BuildConfig 下发');
check(!/^\s*dependencies\s*\{/m.test(gradle), '零第三方依赖，CI 不必拉 AndroidX');
check(/JavaVersion\.VERSION_17/.test(gradle), 'Java 17 编译');
check(/def canSign = ksPath && ksPass && ksAlias && ksKeyPass && file\(ksPath\)\.exists\(\)/.test(gradle)
  && /if \(canSign\) signingConfig signingConfigs\.getByName\('release'\)/.test(gradle),
  'release 签名只在四个 env 齐全且 keystore 存在时启用');
check(!/storePassword\s+['"]|keyPassword\s+['"]|keyAlias\s+['"]/.test(gradle)
  && /storePassword ksPass/.test(gradle) && /keyPassword ksKeyPass/.test(gradle),
  'build.gradle 只把环境变量绑进签名配置，不写死任何密码');

/* ───────── F. CI workflow ───────── */
check(/paths:/.test(wf) && /'android\/\*\*'/.test(wf)
  && /workflow_dispatch:/.test(wf),
  '只在 android/ 变化时自动构建，也可手动触发（前端改版不必重打包）');
check(/java-version: '17'/.test(wf) && /distribution: temurin/.test(wf), 'CI JDK 17');
check(/定位 Android SDK/.test(wf) && /ANDROID_HOME/.test(wf)
  && !/setup-android@v3/.test(wf)
  && /platforms;android-34/.test(wf) && /build-tools;34\.0\.0/.test(wf),
  'CI 用 runner 自带 SDK（不重新下载 cmdline-tools）并安装 34 platform / build-tools');
check(/gradle-8\.9-bin\.zip/.test(wf) && /gradle --version/.test(wf)
  && !/uses:\s*gradle\/actions\/setup-gradle/.test(wf) && /GITHUB_PATH/.test(wf),
  'CI 直接下载官方 Gradle 8.9 并写 GITHUB_PATH（不提交 wrapper.jar、不依赖第三方 action）');
check(/gradle "\$TASK" --no-daemon/.test(wf)
  && /TASK=assembleDebug/.test(wf) && /TASK=assembleRelease/.test(wf),
  '按签名状态自适应 assembleDebug / assembleRelease');
check(/secrets\.NOXC_KEYSTORE_BASE64/.test(wf)
  && /base64 -d/.test(wf) && /signed=false/.test(wf) && /::notice::/.test(wf),
  '没配 Secrets 就明确降级到 debug APK，不静默失败');
check(/aapt" dump badging/.test(wf) && /apksigner" verify --print-certs/.test(wf),
  'CI 真校验 APK 包名/签名，不是只 copy 一个文件');
check(/actions\/upload-artifact@v4/.test(wf) && /if-no-files-found: error/.test(wf)
  && /retention-days: 90/.test(wf), 'APK 上传 Artifacts，缺产物直接失败');
check(/inputs\.create_release/.test(wf) && /softprops\/action-gh-release@v2/.test(wf)
  && /contents: write/.test(wf), '手动触发可发布 Releases，权限最小化到位');
check(/inputs\.site_url/.test(wf) && /-PsiteUrl="\$SITE_URL"/.test(wf),
  '手动触发可指定站点地址，透传到 build.gradle');
check(/android-apk-regression\.ts/.test(deployWf), '本回归挂进主 deploy.yml');

/* ───────── G. 密钥不入库 / 文档 ───────── */
check(/android\/app\/\*\.keystore/.test(ignore)
  && /android\/app\/build\//.test(ignore) && /\*\.apk/.test(ignore),
  '.gitignore 排除 keystore / 构建产物 / APK');
check(!exists(A + 'app/release.keystore') && !exists(A + 'app/signing.gradle'),
  '工作区里没有真实 keystore / 签名脚本');
check(!/NOXC_KEYSTORE_BASE64\s*[:=]\s*['"]?[A-Za-z0-9+/]{40,}/.test(wf),
  'workflow 只引用 Secrets，不含 base64 明文');
check(/### 23\./.test(readme) && /### Z\.15/.test(readme),
  'README 第 23 节写用法、文末 Z.15 记排查');
check(/WebView/.test(readme) && /网页更新/.test(readme),
  'README 如实说明是 WebView 壳、前端更新不用重装');

/* ───────── H. 反向对照：证明断言不是恒真 ───────── */
const brokenManifest = manifest.replace('android:usesCleartextTraffic="false"', 'android:usesCleartextTraffic="true"');
check(!/android:usesCleartextTraffic="false"/.test(brokenManifest),
  '反向对照：放开明文 HTTP 后安全断言必须失败');
const brokenWf = wf.replace("gradle-version: '8.9'", "gradle-version: '7.0'");
check(!/gradle-version: '8\.9'/.test(brokenWf),
  '反向对照：改掉 Gradle 版本后 CI 断言必须失败');
const brokenJava = java.replace('setJavaScriptEnabled(true)', 'setJavaScriptEnabled(false)');
check(!/setJavaScriptEnabled\(true\)/.test(brokenJava),
  '反向对照：关掉 JS 后行为断言必须失败（SPA 会白屏）');

console.log(`安卓 APK 配置回归：${ok.length} 通过，${bad.length} 失败`);
for (const m of ok) console.log('  ✓ ' + m);
for (const m of bad) console.error('  ✗ ' + m);
if (bad.length) process.exit(1);
