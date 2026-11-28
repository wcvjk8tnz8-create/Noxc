import SwiftUI

/// 站点申请子域名前的滑块验证，iOS 原生实现：
/// 拉取 challenge → 本地图库画缺口 → 真实拖动采样轨迹 → 换一次性 passToken。
/// 后台关掉验证时直接返回空 token，不打扰用户。
struct CaptchaSheet: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    /// 调用方已经领过挑战时直接复用，避免重复消耗领取额度。
    var initial: J = [:]
    let onToken: (String) -> Void

    @State private var ch: J = [:]
    @State private var enabled = false
    @State private var loading = true
    @State private var message = ""
    @State private var dragX: CGFloat = 0
    @State private var trace: [J] = []
    @State private var start = Date()
    @State private var busy = false

    private let stageW: CGFloat = 320
    private let stageH: CGFloat = 180
    private let piece: CGFloat = 52

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if loading {
                        SkeletonView(lines: 2)
                    } else if enabled {
                        captchaBody
                    } else {
                        Text(L10n.t("该站点未开启滑块验证", "Slider verification is off"))
                            .font(BrandFont.body(12))
                            .foregroundStyle(C.dim)
                    }
                }
                .padding()
            }
            .background(C.bg.ignoresSafeArea())
            .navigationTitle(L10n.t("安全验证", "Verification"))
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(L10n.done) { dismiss() }
                }
            }
            .task { await start() }
        }
    }

    @MainActor
    private func start() async {
        if !initial.isEmpty {
            apply(initial)
            return
        }
        await load()
    }

    @MainActor
    private func apply(_ data: J) {
        ch = data
        enabled = true
        loading = false
        dragX = 0
        trace = []
        message = ""
    }

    // MARK: - 舞台

    private var captchaBody: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let scale = w / stageW
            let h = stageH * scale
            let ps = piece * scale
            let ty = CGFloat(jI(ch, "y")) * scale
            let target = CGFloat(jI(ch, "x"))
            let imgName = "captcha_" + jS(ch, "img", "typhoon")

            VStack(alignment: .leading, spacing: 14) {
                ZStack(alignment: .topLeading) {
                    Image(imgName)
                        .resizable()
                        .scaledToFill()
                        .frame(width: w, height: h)
                        .clipped()

                    // 缺口：服务端给出目标 x/y，客户端只负责画出来
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color.black.opacity(0.45))
                        .overlay(RoundedRectangle(cornerRadius: 8)
                            .stroke(Color.white.opacity(0.8), lineWidth: 2))
                        .frame(width: ps, height: ps)
                        .offset(x: target * scale, y: ty)

                    // 可拖动的拼图块
                    RoundedRectangle(cornerRadius: 8)
                        .fill(C.pink.opacity(0.38))
                        .overlay(RoundedRectangle(cornerRadius: 8)
                            .stroke(C.text.opacity(0.95), lineWidth: 2))
                        .frame(width: ps, height: ps)
                        .offset(x: min(max(dragX, 0), w - ps), y: ty)
                }
                .frame(height: h)
                .clipShape(RoundedRectangle(cornerRadius: 16))

                slider(width: w, scale: scale, maxBase: stageW - piece)

                if !message.isEmpty {
                    Text(message)
                        .font(BrandFont.body(11))
                        .foregroundStyle(C.danger)
                }
                if busy {
                    ProgressView().tint(C.pink)
                }
            }
        }
        .frame(height: 290)
    }

    private func slider(width: CGFloat, scale: CGFloat, maxBase: CGFloat) -> some View {
        ZStack(alignment: .leading) {
            Capsule()
                .fill(C.bar)
                .frame(height: 46)
                .overlay(Capsule().stroke(C.hair, lineWidth: 1))
            Text(L10n.t("拖动滑块对齐缺口", "Drag to align the gap"))
                .font(BrandFont.body(11))
                .foregroundStyle(C.dim)
                .frame(maxWidth: .infinity)

            RoundedRectangle(cornerRadius: 12)
                .fill(C.pink)
                .overlay(Image(systemName: "chevron.right.2")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(C.bg))
                .frame(width: 44, height: 44)
                .offset(x: min(max(dragX, 0), width - 44))
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { v in
                            if self.trace.isEmpty { self.start = Date() }
                            let base = min(max(v.translation.width / scale, 0), maxBase)
                            self.dragX = base * scale
                            let t = Date().timeIntervalSince(self.start) * 1000
                            let point: J = ["t": t, "x": Double(base)]
                            self.trace.append(point)
                        }
                        .onEnded { v in
                            let base = min(max(v.translation.width / scale, 0), maxBase)
                            let target = CGFloat(jI(self.ch, "x"))
                            let t = Date().timeIntervalSince(self.start) * 1000
                            if abs(base - target) <= 14 {
                                let finalT = max(t, 240)
                                let finalPoint: J = ["t": finalT, "x": Double(target)]
                                self.trace.append(finalPoint)
                                self.dragX = target * scale
                                Task { @MainActor in await self.verify(x: Double(target)) }
                            } else {
                                self.message = L10n.t("没有对齐，再试一次", "Not aligned, try again")
                                self.dragX = 0
                                self.trace = []
                            }
                        }
                )
        }
        .frame(height: 46)
    }

    // MARK: - 协议

    @MainActor
    private func load() async {
        loading = true
        let r = await store.api.call(ep: "captcha", method: "GET")
        if !r.ok {
            message = r.display
            loading = false
            return
        }
        if !jB(r.data, "enabled") {
            loading = false
            onToken("")
            dismiss()
            return
        }
        apply(r.data)
    }

    @MainActor
    private func verify(x: Double) async {
        busy = true
        let body: J = [
            "id": jS(ch, "id"),
            "token": jS(ch, "token"),
            "x": x,
            "trace": trace,
            "keyboard": false,
        ]
        let r = await store.call(ep: "captchaVerify", body: body, refreshAfter: false)
        busy = false
        if r.ok {
            onToken(jS(r.data, "passToken"))
            dismiss()
        } else {
            message = r.display
            dragX = 0
            trace = []
            await load()
        }
    }
}
