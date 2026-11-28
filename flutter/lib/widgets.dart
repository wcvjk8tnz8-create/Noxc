import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'core.dart';

// 视觉层：Material 3 + 全套圆角 + 浮动胶囊底栏（PiliPlus/PiliNara 的招牌形态）。
// 动效全部自绘，不引 flutter_animate / lottie 之类的第三方包。

/// 不依赖 ColorScheme.surfaceContainerHighest（这个字段在旧版 Flutter 叫
/// surfaceVariant），用 lerp 自己混一层，跨版本都能编。
Color softSurface(BuildContext context) {
  final cs = Theme.of(context).colorScheme;
  return Color.lerp(cs.surface, cs.onSurface, 0.055)!;
}

class NxCard extends StatelessWidget {
  final Widget child;
  final EdgeInsets padding;
  final Color? color;
  final double radius;
  final VoidCallback? onTap;

  const NxCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.color,
    this.radius = 20,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final card = Container(
      width: double.infinity,
      padding: padding,
      decoration: BoxDecoration(
        color: color ?? (cs.brightness == Brightness.dark
            ? const Color(0xFF1B1C22)
            : Colors.white),
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(color: cs.outlineVariant.withOpacity(.55)),
      ),
      child: child,
    );
    if (onTap == null) return card;
    return InkWell(
      borderRadius: BorderRadius.circular(radius),
      onTap: onTap,
      child: card,
    );
  }
}

class SectionTitle extends StatelessWidget {
  final String text;
  const SectionTitle(this.text, {super.key});

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Text(text,
            style: const TextStyle(
                fontFamily: 'NotoSerifSC',
                fontSize: 15,
                fontWeight: FontWeight.w700)),
      );
}

class PillButton extends StatelessWidget {
  final String title;
  final VoidCallback? onTap;
  final bool danger;
  final bool prominent;
  final IconData? icon;

  const PillButton(this.title,
      {super.key, this.onTap, this.danger = false, this.prominent = false, this.icon});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final fg = danger ? cs.error : (prominent ? cs.primary : cs.onSurface);
    final child = Row(
      mainAxisSize: MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (icon != null) ...[Icon(icon, size: 16, color: fg), const SizedBox(width: 7)],
        Flexible(
          child: Text(title,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                  fontFamily: 'NotoSansSC',
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: fg)),
        ),
      ],
    );
    return SizedBox(
      width: double.infinity,
      height: 46,
      child: prominent && !danger
          ? FilledButton(onPressed: onTap, child: child)
          : OutlinedButton(
              onPressed: onTap,
              style: OutlinedButton.styleFrom(
                side: BorderSide(color: danger ? cs.error.withOpacity(.5) : cs.outlineVariant),
                shape: const StadiumBorder(),
              ),
              child: child,
            ),
    );
  }
}

/// 列表错落淡入 + 轻微上移 + 弹簧回弹。
class Stagger extends StatefulWidget {
  final int index;
  final Widget child;
  const Stagger({super.key, required this.index, required this.child});

  @override
  State<Stagger> createState() => _StaggerState();
}

class _StaggerState extends State<Stagger> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: Duration(milliseconds: 420 + widget.index.clamp(0, 12).toInt() * 42),
  )..forward();
  late final Animation<double> _a = CurvedAnimation(parent: _c, curve: Curves.easeOutBack);

  @override
  void initState() {
    super.initState();
    if (AppThemeRef.reduce) _c.value = 1;
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
        animation: _a,
        builder: (_, child) => Opacity(
          opacity: _a.value.clamp(0.0, 1.0).toDouble(),
          child: Transform.translate(
            offset: Offset(0, (1 - _a.value) * 18),
            child: Transform.scale(scale: .97 + .03 * _a.value, child: child),
          ),
        ),
        child: widget.child,
      );
}

/// 动效开关读取点：跟着全局主题走，系统/设置页一改，所有动效立即响应。
class AppThemeRef {
  static bool get reduce => appTheme.reduceMotion;
}

class CountUp extends StatelessWidget {
  final int value;
  final double size;
  const CountUp(this.value, {super.key, this.size = 25});

  @override
  Widget build(BuildContext context) {
    if (AppThemeRef.reduce || value <= 0) {
      return Text('$value', style: _style(context));
    }
    return TweenAnimationBuilder<int>(
      tween: IntTween(begin: 0, end: value),
      duration: const Duration(milliseconds: 760),
      curve: Curves.easeOutCubic,
      builder: (_, v, __) => Text('$v', style: _style(context)),
    );
  }

  TextStyle _style(BuildContext context) => TextStyle(
        fontFamily: 'NotoSerifSC',
        fontSize: size,
        fontWeight: FontWeight.w700,
        color: Theme.of(context).colorScheme.primary,
      );
}

/// 骨架屏扫光（CustomPainter 自绘，不依赖 shader / 第三方包）。
class Shimmer extends StatefulWidget {
  final Widget child;
  const Shimmer({super.key, required this.child});

  @override
  State<Shimmer> createState() => _ShimmerState();
}

class _ShimmerState extends State<Shimmer> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
      vsync: this, duration: const Duration(milliseconds: 1350))
    ..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (AppThemeRef.reduce) return widget.child;
    return AnimatedBuilder(
      animation: _c,
      builder: (_, child) => CustomPaint(
        foregroundPainter: _SweepPainter(_c.value, Theme.of(context).colorScheme.outlineVariant),
        child: child,
      ),
      child: widget.child,
    );
  }
}

class _SweepPainter extends CustomPainter {
  final double t;
  final Color line;
  _SweepPainter(this.t, this.line);

  @override
  void paint(Canvas canvas, Size size) {
    final x = (t * 1.6 - .3) * size.width;
    final rect = Rect.fromLTWH(x, 0, size.width * .5, size.height);
    final shader = LinearGradient(
      colors: [Colors.transparent, line.withOpacity(.42), Colors.transparent],
    ).createShader(rect);
    canvas.save();
    canvas.clipRect(Rect.fromLTWH(0, 0, size.width, size.height));
    canvas.drawRect(rect, Paint()..shader = shader);
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _SweepPainter old) => old.t != t;
}

class Skeleton extends StatelessWidget {
  final int lines;
  const Skeleton({super.key, this.lines = 4});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Shimmer(
      child: Column(
        children: List.generate(lines, (i) => Container(
              height: i == 0 ? 96 : 62,
              margin: const EdgeInsets.only(bottom: 12),
              decoration: BoxDecoration(
                color: softSurface(context),
                borderRadius: BorderRadius.circular(18),
              ),
            )),
      ),
    );
  }
}

class ResultCard extends StatelessWidget {
  final Reply result;
  final String label;
  const ResultCard({super.key, required this.result, required this.label});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final good = result.ok;
    final text = result.display;
    return NxCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(good ? Icons.check_circle_rounded : Icons.error_rounded,
              size: 18, color: good ? cs.primary : cs.error),
          const SizedBox(width: 8),
          Expanded(
            child: Text('$label · ${good ? (zh ? '已完成' : 'Done') : (zh ? '失败' : 'Failed')}',
                style: const TextStyle(fontFamily: 'NotoSerifSC', fontSize: 14)),
          ),
        ]),
        const SizedBox(height: 8),
        SelectableText(
          text.length > 4000 ? '${text.substring(0, 4000)}\n…' : text,
          style: TextStyle(fontSize: 11, color: good ? cs.onSurface : cs.error, height: 1.45),
        ),
      ]),
    );
  }
}

class EmptyState extends StatelessWidget {
  final String? text;
  const EmptyState({super.key, this.text});

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 26),
        child: Column(children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(20),
            child: Image.asset('assets/images/art_empty.png', height: 128, fit: BoxFit.cover),
          ),
          const SizedBox(height: 12),
          Text(text ?? (zh ? '这里还没有内容，用下面的操作创建第一条吧。' : 'Nothing here yet.'),
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant)),
        ]),
      );
}

class HeroArt extends StatelessWidget {
  final double height;
  const HeroArt({super.key, this.height = 148});

  @override
  Widget build(BuildContext context) => ClipRRect(
        borderRadius: BorderRadius.circular(22),
        child: Stack(
          alignment: Alignment.bottomLeft,
          children: [
            Image.asset('assets/images/art_hero.png',
                width: double.infinity, height: height, fit: BoxFit.cover),
            Container(
              height: height,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [Colors.transparent, Colors.black.withOpacity(.72)],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                Text(zh ? '全部功能' : 'All features',
                    style: const TextStyle(
                        fontFamily: 'NotoSerifSC', fontSize: 21, color: Colors.white, fontWeight: FontWeight.w700)),
                const SizedBox(height: 3),
                Text(zh ? '网站上的一切，都在这里原生完成' : 'Everything on the site, natively',
                    style: TextStyle(fontSize: 11, color: Colors.white.withOpacity(.8))),
              ]),
            ),
          ],
        ),
      );
}

class BentoCard extends StatelessWidget {
  final J group;
  final int index;
  final int screens;
  final VoidCallback onTap;
  const BentoCard(
      {super.key, required this.group, required this.index, required this.screens, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final admin = jB(group, 'admin');
    return InkWell(
      borderRadius: BorderRadius.circular(22),
      onTap: onTap,
      child: NxCard(
        padding: const EdgeInsets.all(10),
        radius: 22,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: Image.asset('assets/images/art_group_${index % 10}.png',
                height: 88, width: double.infinity, fit: BoxFit.cover),
          ),
          const SizedBox(height: 11),
          Text(jL(group), maxLines: 2, overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontFamily: 'NotoSerifSC', fontSize: 14, fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          Text('$screens ${zh ? '页面' : 'screens'}${admin ? '  ·  ${zh ? '仅管理员' : 'Admin'}' : ''}',
              style: TextStyle(fontSize: 10, color: cs.onSurfaceVariant)),
          const SizedBox(height: 9),
          Row(children: [
            Text(zh ? '进入' : 'Open', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: cs.primary)),
            const Spacer(),
            Icon(Icons.arrow_outward, size: 14, color: cs.primary),
          ]),
        ]),
      ),
    );
  }
}

/// 浮动胶囊底栏：PiliPlus 那种悬浮、带阴影、选中态滑动的导航，
/// 不是贴边系统 NavigationBar。平板宽度下由 RootPage 换成 NavigationRail。
class FloatNav extends StatelessWidget {
  final int current;
  final ValueChanged<int> onTap;
  final bool admin;
  const FloatNav({super.key, required this.current, required this.onTap, this.admin = false});

  static const items = <(IconData, IconData, String, String)>[
    (Icons.home_outlined, Icons.home_rounded, '首页', 'Home'),
    (Icons.language_outlined, Icons.language_rounded, '域名', 'Domains'),
    (Icons.stars_outlined, Icons.stars_rounded, '积分', 'Points'),
    (Icons.apps_outlined, Icons.apps_rounded, '功能', 'Features'),
    (Icons.person_outline, Icons.person_rounded, '我的', 'Profile'),
  ];

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return SafeArea(
      minimum: const EdgeInsets.fromLTRB(18, 0, 18, 14),
      child: Container(
        height: 64,
        decoration: BoxDecoration(
          color: softSurface(context),
          borderRadius: BorderRadius.circular(32),
          border: Border.all(color: cs.outlineVariant.withOpacity(.6)),
          boxShadow: [
            BoxShadow(color: Colors.black.withOpacity(.22), blurRadius: 22, offset: const Offset(0, 8)),
          ],
        ),
        child: Row(
          children: List.generate(items.length, (i) {
            final it = items[i];
            final active = i == current;
            return Expanded(
              child: InkWell(
                borderRadius: BorderRadius.circular(28),
                onTap: () => onTap(i),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 260),
                  curve: Curves.easeOutCubic,
                  margin: const EdgeInsets.all(5),
                  decoration: BoxDecoration(
                    color: active ? cs.primary.withOpacity(.16) : Colors.transparent,
                    borderRadius: BorderRadius.circular(26),
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(active ? it.$2 : it.$1, size: 20, color: active ? cs.primary : cs.onSurfaceVariant),
                      const SizedBox(height: 2),
                      Text(zh ? it.$3 : it.$4,
                          style: TextStyle(
                              fontSize: 10,
                              fontWeight: active ? FontWeight.w700 : FontWeight.w400,
                              color: active ? cs.primary : cs.onSurfaceVariant)),
                    ],
                  ),
                ),
              ),
            );
          }),
        ),
      ),
    );
  }
}

// ── schema 动态字段 ──

class DynField extends StatelessWidget {
  final J fd;
  final J values;
  final VoidCallback onChange;
  const DynField({super.key, required this.fd, required this.values, required this.onChange});

  String get k => jS(fd, 'k');
  String get t => jS(fd, 't', 'text');

  List<(String, String)> get options => jA(fd, 'opt')
      .whereType<List>()
      .where((a) => a.length >= 2)
      .map((a) => (a[0].toString(), a[1].toString()))
      .toList();

  @override
  Widget build(BuildContext context) {
    final label = jL(fd);
    switch (t) {
      case 'bool':
        return SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(label, style: const TextStyle(fontSize: 13)),
          value: values[k] == true || values[k] == '1',
          onChanged: (v) {
            values[k] = v;
            onChange();
          },
        );
      case 'select':
        final opts = options;
        final cur = values[k]?.toString() ?? '';
        // 值不在选项里时 DropdownButton 会断言崩溃，先确认再传 value
        final selected = opts.any((o) => o.$1 == cur) ? cur : null;
        return Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            decoration: BoxDecoration(
              color: softSurface(context),
              borderRadius: BorderRadius.circular(14),
            ),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                value: selected,
                isExpanded: true,
                hint: Text(label, style: const TextStyle(fontSize: 12)),
                items: opts
                    .map((o) => DropdownMenuItem<String>(value: o.$1, child: Text(o.$2)))
                    .toList(),
                onChanged: (v) {
                  values[k] = v ?? '';
                  onChange();
                },
              ),
            ),
          ),
        );
      case 'area':
        return Padding(
          padding: const EdgeInsets.only(top: 8),
          child: TextFormField(
            initialValue: values[k]?.toString() ?? '',
            minLines: 3,
            maxLines: 6,
            decoration: InputDecoration(labelText: label, alignLabelWithHint: true),
            onChanged: (v) => values[k] = v,
          ),
        );
      case 'secret':
        return Padding(
          padding: const EdgeInsets.only(top: 8),
          child: TextFormField(
            initialValue: values[k]?.toString() ?? '',
            obscureText: true,
            decoration: InputDecoration(labelText: label),
            onChanged: (v) => values[k] = v,
          ),
        );
      default:
        return Padding(
          padding: const EdgeInsets.only(top: 8),
          child: TextFormField(
            initialValue: values[k]?.toString() ?? '',
            keyboardType: t == 'num' ? TextInputType.number : TextInputType.text,
            decoration: InputDecoration(labelText: label),
            onChanged: (v) => values[k] = v,
          ),
        );
    }
  }
}

J buildBody(List<J> fields, J vals) {
  final out = <String, dynamic>{};
  for (final fd in fields) {
    final k = jS(fd, 'k');
    final t = jS(fd, 't', 'text');
    if (k.isEmpty) continue;
    final v = vals[k];
    if (t == 'bool') {
      if (v != null) out[k] = (v == true || v == '1' || v == 1);
    } else if (v == null || v.toString().isEmpty) {
      continue;
    } else if (t == 'num') {
      out[k] = int.tryParse(v.toString()) ?? 0;
    } else {
      out[k] = v.toString();
    }
  }
  return out;
}

// ── 原生滑块验证（申请域名前置，真实拖动轨迹，与站点协议一致） ──

class CaptchaSheet extends StatefulWidget {
  final J initial;
  final ValueChanged<String> onToken;
  const CaptchaSheet({super.key, this.initial = const {}, required this.onToken});

  @override
  State<CaptchaSheet> createState() => _CaptchaSheetState();
}

class _CaptchaSheetState extends State<CaptchaSheet> {
  static const double stageW = 320;
  static const double stageH = 180;
  static const double piece = 52;

  J ch = <String, dynamic>{};
  bool enabled = false;
  bool loading = true;
  bool busy = false;
  String message = '';
  double dragX = 0;
  List<J> trace = <J>[];
  DateTime start = DateTime.now();

  AppState get s => AppScope.of(context);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _start());
  }

  Future<void> _start() async {
    if (widget.initial.isNotEmpty) {
      _apply(widget.initial);
      return;
    }
    await _load();
  }

  void _apply(J data) {
    if (!mounted) return;
    setState(() {
      ch = data;
      enabled = true;
      loading = false;
      dragX = 0;
      trace = <J>[];
      message = '';
    });
  }

  Future<void> _load() async {
    final r = await s.api.call('captcha', method: 'GET');
    if (!mounted) return;
    if (!r.ok) {
      setState(() {
        message = r.display;
        loading = false;
      });
      return;
    }
    if (!jB(r.data, 'enabled')) {
      widget.onToken('');
      Navigator.pop(context);
      return;
    }
    _apply(r.data);
  }

  Future<void> _verify(double x) async {
    setState(() => busy = true);
    final body = <String, dynamic>{
      'id': jS(ch, 'id'),
      'token': jS(ch, 'token'),
      'x': x,
      'trace': trace,
      'keyboard': false,
    };
    final r = await s.call('captchaVerify', body: body, refreshAfter: false);
    if (!mounted) return;
    setState(() => busy = false);
    if (r.ok) {
      widget.onToken(jS(r.data, 'passToken'));
      Navigator.pop(context);
    } else {
      setState(() {
        message = r.display;
        dragX = 0;
        trace = <J>[];
      });
      await _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: 18, right: 18, top: 18, bottom: MediaQuery.of(context).viewInsets.bottom + 18),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Text(zh ? '安全验证' : 'Verification',
                style: const TextStyle(fontFamily: 'NotoSerifSC', fontSize: 18, fontWeight: FontWeight.w700)),
            const Spacer(),
            IconButton(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close_rounded)),
          ]),
          if (loading)
            const Padding(padding: EdgeInsets.all(18), child: Skeleton(lines: 2))
          else if (!enabled)
            Padding(
              padding: const EdgeInsets.all(18),
              child: Text(zh ? '该站点未开启滑块验证' : 'Slider verification is off',
                  style: TextStyle(color: cs.onSurfaceVariant)),
            )
          else
            _stage(context),
          if (message.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Text(message, style: TextStyle(fontSize: 11, color: cs.error)),
            ),
          if (busy) const Padding(padding: EdgeInsets.all(12), child: LinearProgressIndicator()),
        ]),
      ),
    );
  }

  Widget _stage(BuildContext context) {
    return LayoutBuilder(builder: (context, box) {
      final w = box.maxWidth;
      final scale = w / stageW;
      final h = stageH * scale;
      final ps = piece * scale;
      final target = jI(ch, 'x').toDouble();
      final ty = jI(ch, 'y').toDouble() * scale;
      final img = 'assets/images/captcha_${jS(ch, 'img', 'typhoon')}.png';
      final maxBase = stageW - piece;

      return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SizedBox(
          width: w,
          height: h,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: Stack(children: [
              Positioned.fill(child: Image.asset(img, fit: BoxFit.cover)),
              Positioned(
                left: target * scale,
                top: ty,
                child: _gap(ps),
              ),
              Positioned(
                left: dragX.clamp(0.0, w - ps).toDouble(),
                top: ty,
                child: _piece(ps),
              ),
            ]),
          ),
        ),
        const SizedBox(height: 14),
        SizedBox(
          width: w,
          height: 48,
          child: Stack(alignment: Alignment.centerLeft, children: [
            Container(
              decoration: BoxDecoration(
                color: softSurface(context),
                borderRadius: BorderRadius.circular(24),
                border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
              ),
            ),
            Center(
              child: Text(zh ? '拖动滑块对齐缺口' : 'Drag to align the gap',
                  style: TextStyle(fontSize: 11, color: Theme.of(context).colorScheme.onSurfaceVariant)),
            ),
            Positioned(
              left: dragX.clamp(0.0, w - 44).toDouble(),
              child: GestureDetector(
                onHorizontalDragStart: (_) {
                  start = DateTime.now();
                  trace = <J>[{'t': 0, 'x': 0}];
                },
                onHorizontalDragUpdate: (d) {
                  final base = (d.localPosition.dx / scale).clamp(0.0, maxBase).toDouble();
                  setState(() => dragX = base * scale);
                  final t = DateTime.now().difference(start).inMilliseconds;
                  trace.add(<String, dynamic>{'t': t, 'x': base});
                },
                onHorizontalDragEnd: (_) async {
                  final base = (dragX / scale).clamp(0.0, maxBase).toDouble();
                  final t = DateTime.now().difference(start).inMilliseconds;
                  if ((base - target).abs() <= 14) {
                    final finalT = math.max(t, 240);
                    trace.add(<String, dynamic>{'t': finalT, 'x': target});
                    setState(() => dragX = target * scale);
                    await _verify(target);
                  } else {
                    setState(() {
                      message = zh ? '没有对齐，再试一次' : 'Not aligned, try again';
                      dragX = 0;
                      trace = <J>[];
                    });
                  }
                },
                child: Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.primary,
                    borderRadius: BorderRadius.circular(22),
                  ),
                  child: Icon(Icons.double_arrow_rounded, size: 18, color: Theme.of(context).colorScheme.onPrimary),
                ),
              ),
            ),
          ]),
        ),
      ]);
    });
  }

  Widget _gap(double ps) => Container(
        width: ps,
        height: ps,
        decoration: BoxDecoration(
          color: Colors.black.withOpacity(.45),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: Colors.white.withOpacity(.8), width: 2),
        ),
      );

  Widget _piece(double ps) => Container(
        width: ps,
        height: ps,
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.primary.withOpacity(.4),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: Colors.white.withOpacity(.95), width: 2),
        ),
      );
}
