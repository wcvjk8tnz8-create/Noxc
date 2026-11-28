import Foundation
import SwiftUI
import UIKit

/// 中英文文案。schema 里的每个页面 / 字段自带 l(中) / le(英)，
/// 这里只负责 App 自身的固定文案，取系统首选语言，不另做一套本地化表。
enum L10n {
    static var zh: Bool {
        let first = Bundle.main.preferredLocalizations.first ?? ""
        let lang = first.isEmpty ? (Locale.current.languageCode ?? "en") : first
        return lang.hasPrefix("zh")
    }

    static func t(_ zh: String, _ en: String) -> String { L10n.zh ? zh : en }

    static var home: String { t("首页", "Home") }
    static var domains: String { t("我的域名", "My domains") }
    static var points: String { t("积分", "Points") }
    static var profile: String { t("我的", "Profile") }
    static var settings: String { t("设置", "Settings") }
    static var allFeatures: String { t("全部功能", "All features") }
    static var featureGroups: String { t("功能分组", "Feature groups") }
    static var screens: String { t("页面", "Screens") }
    static var endpoints: String { t("接口动作", "API actions") }
    static var adminOnly: String { t("仅管理员", "Admin only") }
    static var noxc: String { t("Noxc", "Noxc") }
    static var tagline: String { t("从名字开始，点亮你的域名", "Your dynamo starts with a name") }
    static var hubSub: String { t("网站上的一切，都在这里原生完成", "Everything on the site, natively") }
    static var search: String { t("搜索功能", "Search features") }
    static var noMatch: String { t("没有匹配的功能", "No matching feature") }
    static var announcement: String { t("站点公告", "Announcement") }
    static var siteStats: String { t("站点数据", "Site stats") }
    static var enter: String { t("进入", "Open") }
    static var done: String { t("完成", "Done") }
    static var cancel: String { t("取消", "Cancel") }
    static var ok: String { t("确定", "OK") }
    static var save: String { t("保存", "Save") }
    static var run: String { t("执行", "Run") }
    static var refresh: String { t("刷新", "Refresh") }
    static var loading: String { t("加载中…", "Loading…") }
    static var empty: String { t("这里还没有内容，用下面的操作创建第一条吧。", "Nothing here yet. Use the action below to create the first one.") }
    static var result: String { t("返回结果", "Result") }
    static var success: String { t("已完成", "Done") }
    static var failed: String { t("失败", "Failed") }
    static var confirmTitle: String { t("确定执行？", "Are you sure?") }
    static var confirmBody: String { t("此操作不可撤销", "This action cannot be undone") }
    static var required: String { t("必填", "Required") }
    static var select: String { t("请选择", "Choose") }
    static var notLoggedIn: String { t("请先登录", "Please sign in first") }
    static var signIn: String { t("登录 / 注册", "Sign in / Sign up") }
    static var signOut: String { t("退出登录", "Sign out") }
    static var account: String { t("账号", "Account") }
    static var email: String { t("邮箱", "Email") }
    static var password: String { t("密码", "Password") }
    static var newPassword: String { t("新密码", "New password") }
    static var code: String { t("验证码", "Code") }
    static var sendCode: String { t("发送验证码", "Send code") }
    static var login: String { t("登录", "Sign in") }
    static var register: String { t("注册", "Sign up") }
    static var forgot: String { t("找回密码", "Recover") }
    static var checkin: String { t("每日签到", "Daily check-in") }
    static var apply: String { t("申请子域名", "Apply for a subdomain") }
    static var label: String { t("名称", "Label") }
    static var root: String { t("后缀", "Root") }
    static var renew: String { t("续期", "Renew") }
    static var release: String { t("释放", "Release") }
    static var rewards: String { t("奖励与兑换", "Rewards") }
    static var redeemCode: String { t("兑换码", "Redeem code") }
    static var redeem: String { t("兑换", "Redeem") }
    static var balance: String { t("当前积分", "Balance") }
    static var used: String { t("已用额度", "Used") }
    static var siteURL: String { t("站点地址", "Site URL") }
    static var reduceMotion: String { t("减少动画", "Reduce animations") }
    static var about: String { t("关于", "About") }
    static var openSite: String { t("在浏览器打开完整站点", "Open full site in browser") }
    static var appearance: String { t("动效与外观", "Motion & appearance") }
    static var offline: String { t("离线可用：功能清单来自内置快照", "Offline: feature list from bundled snapshot") }
    static var builtFor: String { t("为 iPhone 与 iPad 原生构建", "Built natively for iPhone and iPad") }
    static var nativeDetail: String { t("从左侧选择一个功能页面", "Pick a feature on the left") }
    static var editProfile: String { t("保存资料", "Save profile") }
    static var nickname: String { t("昵称", "Nickname") }
    static var bio: String { t("简介", "Bio") }
}

/// 与 Android 同一套黑白灰 + 一点品牌粉，不引入新品牌色。
enum C {
    static let bg = Color(red: 0.071, green: 0.075, blue: 0.090)
    static let bar = Color(red: 0.106, green: 0.110, blue: 0.129)
    static let card = Color(red: 0.125, green: 0.129, blue: 0.153)
    static let input = Color(red: 0.090, green: 0.094, blue: 0.114)
    static let hair = Color(red: 0.180, green: 0.184, blue: 0.212)
    static let text = Color(red: 0.961, green: 0.961, blue: 0.969)
    static let dim = Color(red: 0.573, green: 0.576, blue: 0.608)
    static let pink = Color(red: 0.898, green: 0.541, blue: 0.690)
    static let danger = Color(red: 0.898, green: 0.541, blue: 0.541)
    static let green = Color(red: 0.420, green: 0.850, blue: 0.620)
}

/// 内置 OFL 字体：标题 Noto Serif SC，正文 Noto Sans SC。
/// 字体名解析不到时自动退回系统字体，绝不因为字体没注册就崩。
enum BrandFont {
    static func font(_ candidates: [String], size: CGFloat, weight: Font.Weight,
                     fallback: Font) -> Font {
        for name in candidates {
            if UIFont(name: name, size: size) != nil {
                return Font.custom(name, size: size).weight(weight)
            }
        }
        return fallback
    }

    static func body(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        font(["Noto Sans SC", "NotoSansSC-Regular", "NotoSansSC"],
             size: size, weight: weight,
             fallback: Font.system(size: size, weight: weight))
    }

    static func display(_ size: CGFloat, weight: Font.Weight = .bold) -> Font {
        font(["Noto Serif SC", "NotoSerifSC-VF", "NotoSerifSC"],
             size: size, weight: weight,
             fallback: Font.system(size: size, weight: weight, design: .serif))
    }
}
