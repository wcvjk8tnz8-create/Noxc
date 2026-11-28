/**
 * Noxc Flutter App · 防回流回归
 *
 * 用户要求「不用 Swift，参考 PiliPlus / PiliNara 那些」：
 * 这两个项目都是 Flutter + Dart 一套代码覆盖 Android / iOS / Pad，
 * Material 3 + 动态主题色 + 浮动底栏、分层收口、平台差异隔离。
 * 真编译与产物校验在 .github/workflows/flutter-app.yml 里跑；
 * 这里做静态阻断，任何一项被删掉都直接失败。
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');
const ok: string[] = [];
const bad: string[] = [];
const check = (v: any, m: string) => (v ? ok.push(m) : bad.push(m));
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

const dart = fs.readdirSync(path.join(root, 'flutter/lib'))
  .filter((f) => f.endsWith('.dart'))
  .map((f) => read('flutter/lib/' + f))
  .join('\n');
const pub = read('flutter/pubspec.yaml');
const wf = read('.github/workflows/flutter-app.yml');
const patch = read('scripts/flutter-platform-patch.py');

/* ── A. 框架与分层（对齐 PiliPlus 的工程范本） ── */
check(/name: noxc/.test(pub) && /sdk: flutter/.test(pub),
  'Flutter / Dart 工程，不是 SwiftUI / Java 原生工程');
check(!/SwiftUI|@main\s+struct|UIKit|android\/app\/src\/main\/java/.test(dart),
  'Dart 业务代码里零 Swift / UIKit / Java');
check(/class AppState/.test(dart) && /class Api/.test(dart) && /class AppScope/.test(dart),
  '状态 / 网络 / 注入三点收口，页面不直接碰 HTTP');
check(/class AppRoutes/.test(dart) && /Navigator\.pushNamed/.test(dart),
  '路由表收口，页面不自己 new Route');
check(/class PlatformX/.test(dart) && /static bool pad/.test(dart),
  '平台差异压缩在 PlatformX（Pad 断点）');
check(/class Reply/.test(dart), '统一结果类型 Reply（LoadingState 思路）');
check(/class Store/.test(dart) && /shared_preferences/.test(pub),
  '本地存储单点 Store，页面不直接读写偏好');
check(/flutter\/lib\/core\.dart/.test(read('flutter/README.md')) ||
      /分层/.test(read('flutter/README.md')),
  'README 说明分层结构');

/* ── B. PiliPlus 形态：Material 3 / 动态主题色 / 浮动底栏 / Pad 双栏 ── */
check(/useMaterial3: true/.test(dart) && /ColorScheme\.fromSeed/.test(dart),
  'Material 3 + seed 动态配色');
check(/static const seeds/.test(dart) && /void setSeed/.test(dart),
  '可切换的动态主题色（PiliPlus 招牌）');
check(/ThemeMode\.system|materialMode/.test(dart) && /setMode/.test(dart),
  '亮 / 暗 / 跟随系统三段外观');
check(/class FloatNav/.test(dart) && /borderRadius: BorderRadius\.circular\(32\)/.test(dart),
  '悬浮胶囊底部导航，不是贴边系统 NavigationBar');
check(/NavigationRail\(/.test(dart) && /PlatformX\.pad\(/.test(dart),
  'iPad 用 NavigationRail 侧栏，按宽度断点切换');
check(/crossAxisCount: cols/.test(dart) && /wide \? 2 : \(pad \? 3 : 2\)/.test(dart),
  'Bento 网格：手机 2 列 / Pad 3 列 / 横屏双栏 2 列');
check(/Row\(children: \[[\s\S]{0,400}GroupPage/.test(dart),
  'iPad 横屏左网格 + 右分组详情双栏');
check(/SegmentedButton<int>/.test(dart), '设置页分段控件');

/* ── C. 精美动效（全自绘，零第三方动效包） ── */
check(/class Stagger/.test(dart) && /Curves\.easeOutBack/.test(dart),
  '列表错落淡入 + 弹簧回弹');
check(/class Shimmer/.test(dart) && /class _SweepPainter/.test(dart),
  '骨架屏扫光用 CustomPainter 自绘');
check(/class CountUp/.test(dart) && /TweenAnimationBuilder<int>/.test(dart),
  '统计数字滚动');
check(/AnimatedContainer/.test(dart) && /HeroArt/.test(dart),
  '选中态平滑过渡 + 共享主视觉');
check(/PageRouteBuilder/.test(dart) && /FadeTransition/.test(dart),
  '页面淡入 + 轻微上移转场');
check(/AppThemeRef\.reduce/.test(dart) && /setReduce/.test(dart),
  '尊重「减少动画」开关，退化成瞬时状态');
check(/flutter_animate/.test(pub) === false && /lottie/.test(pub) === false,
  '不引第三方动效包（避免 git fork 依赖）');

/* ── D. 全站功能与服务端同源 ── */
const eps = JSON.parse(read('flutter/assets/endpoints.json')) as Record<string, string>;
const sch = JSON.parse(read('flutter/assets/schema.json'));
const appTs = read('src/routes/app.ts');
const block = appTs.slice(appTs.indexOf('endpoints: {'), appTs.indexOf('      capabilities: {'));
const server: Record<string, string> = {};
for (const m of block.matchAll(/^\s*(\w+):\s*'([^']+)',/gm)) server[m[1]] = m[2];
check(Object.keys(eps).length >= 140, `内置契约 ${Object.keys(eps).length} 条`);
check(JSON.stringify(eps) === JSON.stringify(server),
  'endpoints.json 与 app.ts 逐条同源');
check(Array.isArray(sch.groups) && sch.groups.length >= 10,
  `内置 schema ${sch.groups.length} 组`);
const pages = sch.groups.reduce((n: number, g: any) => n + (g.screens || []).length, 0);
check(pages >= 40, `内置 schema ${pages} 个页面`);
check(/class SchemaPage/.test(dart) && /class DynField/.test(dart) &&
      /buildBody/.test(dart) && /execute\(/.test(dart),
  'schema 通用渲染器：动态表单 / 动作 / 行内动作 / 数据列表');
check(/class RecordsSheet/.test(dart) && /recordUpdate/.test(dart) &&
      /recordDelete/.test(dart),
  'DNS 记录列表 / 增 / 改 / 删（此前用户反馈「接口不存在」）');
check(/class CaptchaSheet/.test(dart) && /captchaVerify/.test(dart) &&
      /trace/.test(dart), '申请域名原生滑块验证（真实拖动轨迹）');
check(/class AccountPage/.test(dart) && /'register'/.test(dart) && /'reset'/.test(dart),
  '登录 / 注册 / 找回密码全部 App 内原生完成');
check(/class SettingsPage/.test(dart) && /setSite/.test(dart),
  '站点地址可在 App 内更换');
check(/Endpoints\.defaults/.test(dart) === false && /endpoints\.json/.test(dart),
  '离线契约来自同源代码生成的快照，不是第二套硬编码');

/* ── E. CI：一套代码两端出包 ── */
check(/name: Android APK \(Flutter\)/.test(wf) && /name: iOS IPA \(Flutter \/ Universal\)/.test(wf),
  '两个 job 分别出 Android APK 与 iOS IPA');
check(/flutter create --org xyz\.noxc/.test(wf),
  '平台壳由 flutter create 生成，不入库手写 pbxproj');
check(/flutter-platform-patch\.py/.test(wf), 'CI 注入平台配置');
check(/flutter analyze/.test(wf) && /flutter pub get/.test(wf),
  'CI 跑 pub get 与 Dart 静态分析');
check(/flutter build apk --release/.test(wf), 'CI 真编译 APK');
check(/flutter build ios --release --no-codesign/.test(wf), 'CI 真编译 iOS');
check(/flutter build ios --simulator --debug/.test(wf),
  'CI 额外出模拟器 .app（无 Apple 账号也能运行）');
check(/UIDeviceFamily/.test(wf) && /Universal/.test(wf),
  'CI 真校验 Universal（iPhone + iPad）');
check(/assets\/flutter_assets\/assets\/schema\.json/.test(wf),
  'CI 校验 APK 内置 schema / 契约');
check(/upload-artifact@v4/.test(wf) && /if-no-files-found: error/.test(wf),
  '产物上传且缺文件即失败');
check(/android\.permission\.INTERNET/.test(patch), 'Android 补 INTERNET 权限');
check(/UISupportedInterfaceOrientations~ipad/.test(patch) &&
      /UIRequiresFullScreen/.test(patch), 'iOS 补 iPad 四向 + 分屏');
check(/TARGETED_DEVICE_FAMILY = "1,2"/.test(patch), 'iOS Universal 1,2');
check(/PiliPlus|PiliNara/.test(read('flutter/README.md')),
  'README 记录参考来源与取舍');

/* ── F. 反向对照：故意破坏配置，断言必须失败 ── */
check(JSON.stringify(eps) === JSON.stringify(server) &&
      JSON.stringify({ ...eps, ghost: '/api/ghost' }) !== JSON.stringify(server),
  '反向对照：契约多一条假接口时同源断言必须失败');
check(/class FloatNav/.test(dart) &&
      !/class FloatNav/.test(dart.split('class FloatNav').join('class ZzzNav')),
  '反向对照：浮动底栏被删时架构断言必须失败');
check(/useMaterial3: true/.test(dart) &&
      !/useMaterial3: true/.test(dart.replace('useMaterial3: true', 'useMaterial3: false')),
  '反向对照：关掉 Material 3 时形态断言必须失败');
check(/macos/.test(wf) && !/macos/.test(wf.split('macos-latest').join('ubuntu-latest')
      .split('macos').join('')),
  '反向对照：iOS job 换成 Linux 时 CI 断言必须失败（编不出 IPA）');
check(/TARGETED_DEVICE_FAMILY = "1,2"/.test(patch) &&
      !/TARGETED_DEVICE_FAMILY = "1,2"/.test(
        patch.split('TARGETED_DEVICE_FAMILY = "1,2"').join('TARGETED_DEVICE_FAMILY = "1"')),
  '反向对照：删掉 iPad 家族时 Universal 断言必须失败');

for (const m of ok) console.log('  ✓ ' + m);
for (const m of bad) console.error('  ✗ ' + m);
console.log(`Flutter App 回归：${ok.length} 通过，${bad.length} 失败`);
if (bad.length) process.exit(1);
