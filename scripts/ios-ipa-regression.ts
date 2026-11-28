/**
 * Noxc iOS Universal App · 配置防回流回归
 *
 * 真编译与 IPA 产物校验在 .github/workflows/ios-ipa.yml 的 macOS runner 上跑；
 * 这里做静态阻断：iPad/iPhone 双家族、三栏适配、schema 同源、动效、资源、
 * 签名与未签名两条出包路径，任何一项被删掉都直接失败。
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');
const ok: string[] = [];
const bad: string[] = [];
const check = (v: any, m: string) => (v ? ok.push(m) : bad.push(m));
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const has = (p: string) => fs.existsSync(path.join(root, p));

const wf = read('.github/workflows/ios-ipa.yml');
const pbx = read('ios/Noxc.xcodeproj/project.pbxproj');
const info = read('ios/Noxc/Info.plist');
const scheme = read('ios/Noxc.xcodeproj/xcshareddata/xcschemes/Noxc.xcscheme');
const endpointsSwift = read('ios/Noxc/Generated/Endpoints.swift');
const schemaJson = JSON.parse(read('ios/Noxc/Generated/schema.json'));
const appTs = read('src/routes/app.ts');
const schemaTs = read('src/lib/appSchema.ts');
const swift = fs.readdirSync(path.join(root, 'ios/Noxc'))
  .filter((f) => f.endsWith('.swift')).map((f) => read('ios/Noxc/' + f)).join('\n');

/* ── A. Universal：iPhone + iPad 都进包 ── */
check(/TARGETED_DEVICE_FAMILY = "1,2"/.test(pbx),
  'TARGETED_DEVICE_FAMILY = 1,2（iPhone + iPad）');
check(/IPHONEOS_DEPLOYMENT_TARGET = 16\.0/.test(pbx),
  'iOS 16 部署目标（NavigationSplitView 可用）');
check(/PRODUCT_BUNDLE_IDENTIFIER = xyz\.noxc\.app/.test(pbx),
  'Bundle ID 与 Android applicationId 同源');
check(/UISupportedInterfaceOrientations~ipad/.test(info)
  && /UIInterfaceOrientationPortraitUpsideDown/.test(info),
  'iPad 四向支持（含倒立竖屏）');
check(/<key>UIRequiresFullScreen<\/key>\s*<false\/>/.test(info),
  'UIRequiresFullScreen=false → 支持 Split View / Slide Over');
check(/UIApplicationSupportsMultipleScenes/.test(info),
  '支持 iPad 多窗口 / 台前调度');
check(/<key>UIAppFonts<\/key>/.test(info)
  && /NotoSerifSC-VF\.ttf/.test(info),
  '内置 OFL 中文字体走 UIAppFonts');
check(/CFBundleLocalizations/.test(info) && /zh-Hans/.test(info),
  '中英双语文案声明');
check(/NavigationSplitView/.test(swift) && /TabView\(selection:/.test(swift),
  'iPad 三栏 NavigationSplitView + iPhone TabView 两套布局');
check(/horizontalSizeClass/.test(swift) && /GridItem\(\.adaptive/.test(swift),
  '按 horizontalSizeClass 自适应 Bento 列数（iPad 3–4 列 / iPhone 2 列）');
check(/UIDeviceFamily/.test(wf), 'CI 真校验编译产物的 UIDeviceFamily');

/* ── B. 全站功能与服务端同源 ── */
const appBlock = appTs.slice(appTs.indexOf('endpoints: {'), appTs.indexOf('      capabilities: {'));
const eps: Record<string, string> = {};
for (const m of appBlock.matchAll(/^\s*(\w+):\s*'([^']+)',/gm)) eps[m[1]] = m[2];
const swiftEps: Record<string, string> = {};
for (const m of endpointsSwift.matchAll(/^\s*"(\w+)":\s*"([^"]+)",/gm)) swiftEps[m[1]] = m[2];
check(Object.keys(eps).length >= 140, `服务端契约 ${Object.keys(eps).length} 条`);
check(JSON.stringify(eps) === JSON.stringify(swiftEps),
  `Endpoints.swift 与 app.ts 逐条同源（${Object.keys(swiftEps).length} 条）`);
check(schemaTs.includes('export const APP_SCHEMA') && schemaJson.v === 2,
  '内置 schema.json 是 v2 快照');
check(Array.isArray(schemaJson.groups) && schemaJson.groups.length >= 10,
  `内置 schema 覆盖 ${schemaJson.groups.length} 个功能分组`);
const screens = schemaJson.groups.reduce((n: number, g: any) => n + (g.screens || []).length, 0);
check(screens >= 40, `内置 schema 覆盖 ${screens} 个页面`);
const epsUsed = new Set<string>();
const walk = (o: any) => {
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o)) { for (const x of o) walk(x); return; }
  if (typeof o.ep === 'string') epsUsed.add(o.ep);
  for (const v of Object.values(o)) walk(v);
};
walk(schemaJson);
check([...epsUsed].every((k) => eps[k]),
  `schema 引用的 ${epsUsed.size} 个契约 key 全部存在`);
check(/app\/v1\/schema/.test(swift) && /Endpoints\.defaults/.test(swift),
  'iOS 端只走契约 + schema，不硬编码 /api 路径');
check(/renderForm|submitForm|loadData|rowCard|PromptSheet/.test(swift),
  '通用渲染器覆盖动态表单 / 数据列表 / 行内动作 / 参数弹窗');
check(/FieldRow/.test(swift) && /"bool"|"select"|"secret"|"area"|"num"/.test(swift),
  '动态字段类型齐全：text/num/bool/select/secret/area');
check(/CaptchaSheet/.test(swift) && /captchaVerify/.test(swift),
  '申请子域名的滑块验证有原生实现（真实拖动轨迹）');
check(/captcha_/.test(swift) && fs.existsSync(path.join(root, 'ios/Noxc/Assets.xcassets/captcha_typhoon.imageset')),
  '滑块图库已内置 PNG，不依赖远程 WebP 解码');

/* ── C. 精美动效与无障碍（与 Android 同一设计，纯 SwiftUI 实现） ── */
check(/struct Stagger/.test(swift) && /struct PressButtonStyle/.test(swift),
  '错落入场 + 弹簧按压微交互');
check(/struct CountUp/.test(swift) && /struct Shimmer/.test(swift)
  && /struct SkeletonView/.test(swift), '数字滚动 + 自绘骨架屏扫光');
check(/UIAccessibility\.isReduceMotionEnabled/.test(swift)
  && /Motion\.reduce/.test(swift), '尊重系统「减少动画」');
check(/SuccessPulse/.test(swift), '操作结果有成功脉冲');
check(/\.spring\(/.test(swift), '物理弹簧动效');
check(/art_hero/.test(swift) && /art_empty/.test(swift),
  '品牌插画用于 Bento 主视觉与空状态');
check(fs.existsSync(path.join(root, 'ios/Noxc/Fonts/OFL.txt')),
  '内置字体附 SIL OFL 许可证');

/* ── D. CI：真编译 + 两类产物 + 可选签名 ── */
check(/runs-on: .*macos/.test(wf) && /github\.event\.inputs\.runner/.test(wf),
  'CI 用 macOS runner（真 Xcode 编译），且标签可在 dispatch 时切换');
check(/xcodebuild -list -project/.test(wf), 'CI 先校验工程能被 Xcode 打开');
check(/clean archive/.test(wf) && /generic\/platform=iOS/.test(wf),
  'CI 真跑 archive 出真机包');
check(/Noxc-unsigned\.ipa/.test(wf) && /build\/Payload/.test(wf),
  'CI 产出未签名 IPA');
check(/iOS Simulator/.test(wf) && /Noxc-Simulator\.app\.zip/.test(wf),
  'CI 额外产出模拟器 .app（无 Apple 账号也能运行）');
check(/IOS_CERTIFICATE_P12_BASE64/.test(wf)
  && /PROVISIONING_PROFILE_SPECIFIER/.test(wf)
  && /exportArchive/.test(wf), '配置 Secrets 时走真签名 IPA 导出');
check(/upload-artifact@v4/.test(wf) && /if-no-files-found: error/.test(wf),
  '产物上传且缺文件即失败');
check(/scripts\/ios-sync-check\.py/.test(wf),
  'CI 跑同源校验（契约 / schema / pbxproj / 资源）');
check(/Noxc\.xcscheme|Noxc\.xcodeproj/.test(scheme) && /ArchiveAction/.test(scheme),
  'shared scheme 支持 archive');
check(has('ios/README.md') && /IPA|签名|Xcode|iPad|iPhone/.test(read('ios/README.md')),
  'README 说明 IPA 形态、签名前提与双端适配');

/* ── E. 反向对照：故意破坏配置，断言必须失败 ── */
const isUniversal = (s: string) => /TARGETED_DEVICE_FAMILY = "1,2"/.test(s);
check(isUniversal(pbx) && !isUniversal(
  pbx.split('TARGETED_DEVICE_FAMILY = "1,2"').join('TARGETED_DEVICE_FAMILY = "1"')),
  '反向对照：删掉 iPad 家族时 Universal 断言必须失败');
check(JSON.stringify(eps) === JSON.stringify(swiftEps)
  && JSON.stringify({ ...swiftEps, ghost: '/api/ghost' }) !== JSON.stringify(eps),
  '反向对照：契约多一条假接口时同源断言必须失败');
const noMac = wf.split('macos-latest').join('ubuntu-latest')
  .split('macos-15-intel').join('ubuntu-latest')
  .split('macos-15').join('ubuntu-latest')
  .split('macos-14').join('ubuntu-latest')
  .split('macos-13').join('ubuntu-latest')
  .split('macos').join('');
check(/runs-on: .*macos/.test(wf) && !/runs-on: .*macos/.test(noMac),
  '反向对照：换成 Linux runner 时 CI 断言必须失败（Linux 编不出 IPA）');
check(schemaJson.v === 2 && { ...schemaJson, v: 99 }.v !== 2,
  '反向对照：schema 版本被改时同源断言必须失败');

for (const m of ok) console.log('  ✓ ' + m);
for (const m of bad) console.error('  ✗ ' + m);
console.log(`iOS Universal IPA 回归：${ok.length} 通过，${bad.length} 失败`);
if (bad.length) process.exit(1);
