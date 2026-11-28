# Noxc iOS · Universal（iPhone + iPad）

纯 SwiftUI 原生 App，零 WebView、零第三方依赖。与 Android 端共用同一份服务端
`GET /api/app/v1/schema`（10 组 / 48 页）和 `bootstrap.endpoints`（148 条契约），
新增网站功能只改服务端生成脚本，两端都不用发版。

## 工程怎么来

```bash
python3 scripts/gen-ios-project.py     # 重建 pbxproj / plist / scheme / 契约 / schema 快照 / 资源
python3 scripts/ios-sync-check.py      # 静态自检（只用标准库）
open ios/Noxc.xcodeproj                # 或 xcodebuild 命令行
```

`ios/Noxc.xcodeproj/project.pbxproj` 由生成脚本产出，**不依赖 xcodegen**，
CI 的 macOS runner 装好 Xcode 就能直接编。所有 Swift 文件、Assets 资源、
`Generated/Endpoints.swift`、`Generated/schema.json` 都自动扫进工程；
新增 `.swift` 文件重跑一次生成器即可。

## 适配 iPhone 与 iPad

| | iPhone | iPad |
|---|---|---|
| 导航 | `TabView` 五标签 + `NavigationStack` | `NavigationSplitView` 三栏（侧栏 / 分组 / 详情） |
| 功能中心 | 2 列 Bento | 3–4 列 Bento（`GridItem(.adaptive)`） |
| 方向 | 竖屏 + 横屏 | 四向全开 |
| 多任务 | — | Split View / Slide Over / 台前调度 / 多窗口 |

`TARGETED_DEVICE_FAMILY = 1,2`、`UIRequiresFullScreen = false`、
`UIApplicationSupportsMultipleScenes = true`，布局按 `horizontalSizeClass` 切换，
不是两套代码。部署目标 iOS 16（NavigationSplitView）。

## 功能

- **原生精修页**：首页、我的域名（含申请与原生滑块验证）、积分 / 签到 / 兑换、
  个人资料、设置、登录 / 注册 / 找回密码。
- **全站功能中心**：首页 Bento 入口 → 分组网格（搜索 / 数字滚动 / 共享视觉）→
  分组页 → `SchemaScreenView` 通用渲染器，按服务端 schema 生成
  数据卡片、行内动作、动态表单（text/num/bool/select/secret/area）、
  独立动作（确认 / 参数弹窗 / 常量参数）、骨架屏、空状态与结果区。
- **离线兜底**：`Generated/schema.json` 是打包时的服务端快照，
  没网时功能清单照样能浏览；接口地图另有 `Endpoints.swift` 静态兜底。
- **动效**：错落入场、弹簧按压、数字滚动、骨架屏扫光、成功脉冲、品牌插画，
  纯 SwiftUI 实现（Android 端用 Lottie，视觉口径一致）。
  尊重系统「减少动画」，设置页也有开关。

## IPA 与签名（重要）

GitHub Actions `Build Noxc iOS IPA` 每次产出：

| 产物 | 能不能装真机 |
|---|---|
| `Noxc-unsigned.ipa` | **不能**。未签名，供 Xcode / `codesign` 重签或企业分发 |
| `Noxc-Simulator.app.zip` | 解压拖进 iOS Simulator 即可运行，**不需要 Apple 账号** |
| ad-hoc 签名 `.ipa` | 能。需配置签名 Secrets |

想直接装到 iPhone / iPad，二选一：

1. **本地 Xcode 自动签名**（最省事）：`open ios/Noxc.xcodeproj` →
   选 Target → Signing & Capabilities → 勾 Automatically manage signing →
   选自己的 Team → 接上设备 Run，或 Product → Archive → Distribute App（Ad Hoc / Development）。
2. **CI 签名**：在仓库 Secrets 里配
   `IOS_CERTIFICATE_P12_BASE64`、`IOS_CERTIFICATE_PASSWORD`、
   `IOS_PROVISIONING_PROFILE_BASE64`、`IOS_TEAM_ID`，
   workflow 会自动导入钥匙串并 `-exportArchive` 出可安装 IPA。

> 没有 Apple Developer 账号 / 证书时，Linux 与 macOS 都**无法**产出可直接真机安装的 IPA ——
> 这是 iOS 签名机制决定的，不是构建失败。CI 仍然会给出未签名 IPA 与模拟器包，
> 并把 `Success` 标绿。

## 签名前提之外的限制

- 第三方 OAuth（GitHub / NodeLoc）按规范必须经浏览器安全上下文；
  App 内用 SFSafari 流程或浏览器授权页 `/app-authorize` 交接一次性码。
- `NSAllowsArbitraryLoads = true` 是为了支持在设置里改成自建 `http://` 站点；
  若只走正式 https 站点、要上 App Store，应改成域名例外或去掉。
- `UIAppFonts` 内置的 Noto Sans SC / Noto Serif SC 遵循 SIL OFL 1.1，
  许可证见 `Noxc/Fonts/OFL.txt`。

## CI runner 标签

`workflow_dispatch` 支持 `runner` 输入。默认 `macos-latest`；若账户把
`macos-14` 解析为不受支持的 `macos-14-arm64-us-default` 配置，run 会在分配
runner 前被 `cancelled`（详见主 README 文末 Z.16）。遇到这种情况在 Actions
页面手动触发时改填 `macos-15` / `macos-15-intel` 即可，不必改工程。
