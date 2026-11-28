import Foundation
import SwiftUI
import UIKit

/// 动效总开关。与 Android 的 Motion.java 同一设计：
/// 系统「减少动画」或 App 内开关打开时，全部退化为瞬时状态切换。
enum Motion {
    private static let key = "noxc.reduceMotion"

    static var reduce: Bool {
        if UserDefaults.standard.object(forKey: key) != nil {
            return UserDefaults.standard.bool(forKey: key)
        }
        return UIAccessibility.isReduceMotionEnabled
    }

    static func setReduce(_ on: Bool) {
        UserDefaults.standard.set(on, forKey: key)
    }
}

/// 列表卡片错落淡入 + 轻微上移 + 弹簧回弹。
struct Stagger: ViewModifier {
    let index: Int
    @State private var show = false

    func body(content: Content) -> some View {
        content
            .opacity(show ? 1 : 0)
            .offset(y: show ? 0 : 18)
            .scaleEffect(show ? 1 : 0.97)
            .onAppear {
                if Motion.reduce { show = true; return }
                withAnimation(.spring(response: 0.44, dampingFraction: 0.78)
                    .delay(Double(min(index, 12)) * 0.042)) {
                    show = true
                }
            }
    }
}

/// 按压反馈：0.96 缩放，松手弹簧归位。
struct PressButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(.spring(response: 0.30, dampingFraction: 0.62),
                       value: configuration.isPressed)
    }
}

/// 统计数字从 0 滚到目标值。
struct CountUp: View {
    let value: Int
    @State private var shown = 0

    var body: some View {
        Text("\(shown)")
            .font(BrandFont.display(25))
            .foregroundStyle(C.pink)
            .monospacedDigit()
            .onAppear { animate() }
            .onChange(of: value) { _ in animate() }
    }

    private func animate() {
        if Motion.reduce || value <= 0 { shown = value; return }
        let target = value
        Task { @MainActor in
            let steps = 22
            for i in 1...steps {
                try? await Task.sleep(nanoseconds: 24_000_000)
                self.shown = target * i / steps
            }
            self.shown = target
        }
    }
}

/// 骨架屏扫光：主流 App 用骨架替代一直转圈，降低感知等待。
struct Shimmer: ViewModifier {
    let reduce: Bool
    @State private var phase: CGFloat = -1

    func body(content: Content) -> some View {
        content
            .overlay(
                GeometryReader { geo in
                    LinearGradient(colors: [.clear, C.hair.opacity(0.9), .clear],
                                   startPoint: .leading, endPoint: .trailing)
                        .frame(width: geo.size.width * 0.55)
                        .offset(x: phase * geo.size.width * 1.5)
                }
                .clipped()
            )
            .onAppear {
                guard !reduce else { return }
                withAnimation(.linear(duration: 1.35).repeatForever(autoreverses: false)) {
                    phase = 1
                }
            }
    }
}

struct SkeletonView: View {
    @EnvironmentObject var store: AppStore
    var lines: Int = 4

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(0..<max(1, lines), id: \.self) { i in
                RoundedRectangle(cornerRadius: 14)
                    .fill(C.card)
                    .frame(height: i == 0 ? 96 : 64)
            }
        }
        .modifier(Shimmer(reduce: store.reduceMotion))
    }
}

/// 成功脉冲：结果卡片轻微放大后回弹。
struct SuccessPulse: ViewModifier {
    @State private var pulse = false
    let reduce: Bool

    func body(content: Content) -> some View {
        content
            .scaleEffect(pulse ? 1.02 : 1)
            .onAppear {
                guard !reduce else { return }
                withAnimation(.spring(response: 0.32, dampingFraction: 0.5)) {
                    self.pulse = true
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) {
                    withAnimation(.spring(response: 0.36, dampingFraction: 0.7)) {
                        self.pulse = false
                    }
                }
            }
    }
}
