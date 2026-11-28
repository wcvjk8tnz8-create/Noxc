import SwiftUI

/// 站点黑白灰 + 20 圆角卡片，与 Android 的 Ui.card 一致。
struct Card<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(C.card)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(C.hair, lineWidth: 1)
            )
    }
}

struct SectionTitle: View {
    let text: String
    var body: some View {
        Text(text)
            .font(BrandFont.display(16))
            .foregroundStyle(C.text)
            .padding(.bottom, 4)
    }
}

struct PillButton: View {
    let title: String
    var danger = false
    var prominent = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(BrandFont.body(13, weight: .medium))
                .foregroundStyle(danger ? C.danger : C.text)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(prominent ? C.pink.opacity(0.18) : C.bar)
                .clipShape(Capsule())
                .overlay(Capsule().stroke(prominent ? C.pink.opacity(0.6) : C.hair, lineWidth: 1))
        }
        .buttonStyle(PressButtonStyle())
    }
}

/// Bento 网格卡：渐变插画头图 + 标题 + 页面数 + 管理员标记。
struct BentoCard: View {
    let group: J
    let index: Int
    let screenCount: Int

    private var artName: String { "art_group_\(index % 10)" }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Image(artName)
                .resizable()
                .scaledToFill()
                .frame(height: 92)
                .clipped()

            Text(jLabel(group))
                .font(BrandFont.display(15))
                .foregroundStyle(C.text)
                .lineLimit(2)
                .padding(.top, 12)

            let admin = jB(group, "admin")
            Text("\(screenCount) \(L10n.screens)"
                 + (admin ? "  ·  \(L10n.adminOnly)" : ""))
                .font(BrandFont.body(11))
                .foregroundStyle(C.dim)
                .padding(.top, 3)

            HStack {
                Text(L10n.enter)
                    .font(BrandFont.body(12, weight: .medium))
                    .foregroundStyle(C.pink)
                Spacer()
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(C.pink)
            }
            .padding(.top, 10)
        }
        .padding(12)
        .background(C.card)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(C.hair, lineWidth: 1)
        )
        .opacity(adminDim ? 0.55 : 1)
    }

    private var adminDim: Bool { jB(group, "admin") }
}

struct EmptyStateView: View {
    @EnvironmentObject var store: AppStore
    var text: String = L10n.empty
    @State private var breathing = false

    var body: some View {
        VStack(spacing: 12) {
            Image("art_empty")
                .resizable()
                .scaledToFit()
                .frame(height: 130)
                .clipShape(RoundedRectangle(cornerRadius: 18))
                .scaleEffect(breathing ? 1.02 : 1)
                .onAppear {
                    guard !store.reduceMotion else { return }
                    withAnimation(.easeInOut(duration: 2.4).repeatForever(autoreverses: true)) {
                        self.breathing = true
                    }
                }
            Text(text)
                .font(BrandFont.body(12))
                .foregroundStyle(C.dim)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 22)
    }
}

struct ResultCard: View {
    @EnvironmentObject var store: AppStore
    let result: APIResult
    let label: String

    var body: some View {
        Card {
            HStack(spacing: 8) {
                Image(systemName: result.ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                    .foregroundStyle(result.ok ? C.green : C.danger)
                Text("\(label)  ·  \(result.ok ? L10n.success : L10n.failed)")
                    .font(BrandFont.display(14))
                    .foregroundStyle(C.text)
            }
            let text = result.display
            Text(text.count > 4000 ? String(text.prefix(4000)) + "\n…" : text)
                .font(BrandFont.body(11))
                .foregroundStyle(result.ok ? C.text : C.danger)
                .textSelection(.enabled)
                .padding(.top, 8)
        }
        .modifier(SuccessPulse(reduce: store.reduceMotion))
    }
}

/// 主视觉卡：启动页 / iPad 详情栏 / 首页 Bento 入口共用。
struct HeroArt: View {
    var height: CGFloat = 140
    var body: some View {
        ZStack(alignment: .bottomLeading) {
            Image("art_hero")
                .resizable()
                .scaledToFill()
                .frame(height: height)
                .clipped()
            LinearGradient(colors: [.clear, C.bg.opacity(0.85)],
                           startPoint: .top, endPoint: .bottom)
            VStack(alignment: .leading, spacing: 3) {
                Text(L10n.allFeatures)
                    .font(BrandFont.display(21))
                    .foregroundStyle(C.text)
                Text(L10n.hubSub)
                    .font(BrandFont.body(11))
                    .foregroundStyle(C.dim)
            }
            .padding(14)
        }
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}
