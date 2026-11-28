# Noxc · Flutter 版（Android / iOS / iPad）

参考 **PiliPlus / PiliNara** 那类开源客户端的做法：**一套 Dart 代码覆盖手机与平板**，
Material 3 + 动态主题色 + 悬浮胶囊底栏、分层收口、平台差异隔离。
不是 SwiftUI，也不是 WebView 壳；业务逻辑全在 `lib/*.dart`，零 Swift / 零 Java 业务代码。

> 平台侧的 `ios/Runner/AppDelegate.swift`、`android/app/.../MainActivity.kt`
> 是 `flutter create` 自动生成的启动壳（PiliPlus 也一样有），**不入库、不手写**，
> CI 按 Flutter SDK 版本生成后由 `scripts/flutter-platform-patch.py` 注入配置。

## 为什么这次改成 Flutter

| | 之前 | 现在 |
|---|---|---|
| 代码库 | Android(Java) + iOS(SwiftUI) 两套 | **一套 Dart，两个平台壳** |
| 功能新增 | 两端各写一遍 | 服务端 schema 下发，两端都不用发版 |
| 视觉 | 两套各自维护 | Material 3 统一 + 动态主题色 |
| 平板 | 两套适配逻辑 | `PlatformX.pad()` 一个断点，NavigationRail / 双栏 |

PiliPlus 那类项目的构建痛点是「一堆作者自己的 git fork 依赖，编译前得拉分支」。
这里刻意反向：**只用 `http` + `shared_preferences` 两个 pub.dev 官方包**，
动效全部自绘（`AnimationController` / `CustomPainter` / `Hero` / `TweenAnimationBuilder`），
`pub get` 不碰任何 git 仓库。

## 分层（core.dart 是唯一收口点）

```
pages/*.dart  →  AppState / Api / Store / AppTheme / AppRoutes  →  Worker API
                 ↑ 全部在 lib/core.dart，页面不直接发 HTTP、不直接读写偏好
```

- `lib/core.dart`：主题、存储、网络、统一结果 `Reply`、状态、契约占位符、平台判断
- `lib/widgets.dart`：卡片、浮动底栏、Bento、骨架扫光、数字滚动、动态字段、原生滑块验证
- `lib/pages_home.dart`：首页 / 积分 / 我的 / 设置
- `lib/pages_domains.dart`：我的域名、申请子域名、**DNS 记录增改删**
- `lib/pages_hub.dart`：功能中心 Bento、分组页、`SchemaPage` 通用渲染器
- `lib/pages_account.dart`：登录 / 注册 / 找回密码
- `lib/main.dart`：入口、`AppScope` 注入、路由表、手机浮动底栏 / iPad 侧栏

`assets/endpoints.json`（148 条契约）与 `assets/schema.json`（10 组 / 48 页）
由 `scripts/gen-flutter-assets.py` 从 `src/routes/app.ts`、`src/lib/appSchema.ts`
直接生成，**不是第二套硬编码**；服务端下发新契约时自动覆盖，离线用内置快照。

## 形态与动效

- **手机**：`FloatNav` 悬浮胶囊底栏（圆角 32、阴影、选中态滑动动画）
- **iPad**：`NavigationRail` 侧栏；功能中心在横屏再做一层「左网格 + 右分组详情」双栏
- **主题**：6 个可选强调色、亮 / 暗 / 跟随系统、减少动画开关
- **动效**：错落入场弹簧回弹、骨架屏扫光、数字滚动、页面淡入上移、成功脉冲；
  系统「减少动画」或 App 内开关打开时全部退化为瞬时状态

## 功能覆盖

全站功能中心由服务端 `GET /api/app/v1/schema` 驱动：动态表单
（text / num / bool / select / secret / area）、独立动作（确认框 / 参数弹窗 / 常量参数）、
数据卡片、行内动作、骨架屏、空状态、结果区。**管理员后台、DNS 记录、通知、工单、
兑换码、转让、举报、第三方域名接入等都能在 App 里操作**，不是只读浏览。

另有精修原生页：首页、我的域名（含滑块验证申请与 DNS 记录增改删）、积分 / 签到 /
兑换、个人资料、设置、登录注册找回密码。

## 出包

`.github/workflows/flutter-app.yml`：

| job | runner | 产物 |
|---|---|---|
| Android APK | `ubuntu-latest` | `noxc-flutter-apk-*` → `app-release.apk`（可直接安装） |
| iOS IPA | `macos-latest` | `noxc-flutter-ipa-*` → `Noxc-unsigned.ipa` + `Noxc-Simulator.app.zip` |

流程：安装 Flutter → `flutter create` 生成平台壳 → 注入配置 → 同源校验 →
`pub get` → `flutter analyze` → 构建 → 产物结构校验 → 上传。

**iOS 签名前提**：没有 Apple Developer 证书时，任何平台都只能产出**未签名 IPA**，
不能直接装真机（这是 iOS 签名机制，不是构建失败）。两条路：

1. 本地 `open ios/Runner.xcworkspace` → Signing & Capabilities → 自动签名 → Run / Archive；
2. 在 CI 里加签名 Secrets 后 `xcodebuild -exportArchive`（见主 README 文末 Z.17）。

模拟器 `.app.zip` 解压拖进 iOS Simulator 即可运行，不需要账号。

## 本地开发

```bash
python3 scripts/gen-flutter-assets.py       # 刷新内置契约 / schema / 插画 / 字体
flutter create --org xyz.noxc --project-name noxc --platforms=android,ios .
python3 scripts/flutter-platform-patch.py
flutter pub get
flutter run
```

新增 `.dart` 文件只需放在 `lib/` 下（工程没有手写 pbxproj / Gradle 清单要维护）。
