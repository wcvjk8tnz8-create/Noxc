/**
 * 首页 i18n 回归（CI 用 tsx 跑，无需浏览器 / 数据库）
 *
 * 背景：英文模式下首页残留大量中文 —— 「Your own专属 Subdomain」、
 * 整段副标题、代码注释。原因是运行时 i18n 按「文本节点」逐条查词典，
 * 而 Zerexa 改版新增的长句没进词典；被 <em>/<b> 拆开的标题和
 * <pre><code> 里的注释更不可能靠逐节点翻译解决。
 *
 * 这里做两件事：
 *   1) 抽取 Home.tsx 里所有中文 JSX 文本 / 属性，逐条 translateText 断言零残留；
 *      带 data-en 的行除外（那些由整段替换负责）；
 *   2) 断言 data-en 机制与关键整句译文都在，防止改动回流。
 */
import { readFileSync } from 'node:fs';
import { translateText } from '../src/app/lib/i18n.ts';

/* 仓库根目录：CI 里 cwd 就是仓库根（npx tsx 直接跑），本地用 esbuild
   bundle 后同样在仓库根执行，两处一致。 */
const root = process.cwd().endsWith('/') ? process.cwd() : process.cwd() + '/';
const read = (p: string) => readFileSync(root + p, 'utf8');
const home = read('src/app/pages/Home.tsx');
const i18n = read('src/app/lib/i18n.ts');
const dict = read('src/app/lib/dict.en.ts');
const lines = home.split('\n');

const ok: string[] = [];
const bad: string[] = [];
const check = (cond: boolean, msg: string) => (cond ? ok.push(msg) : bad.push(msg));

/* ── 1. 抽取所有中文文案（JSX 文本节点 + 可翻译属性） ───────────── */
const samples: Array<{ text: string; line: number; byDataEn: boolean }> = [];
lines.forEach((line, i) => {
  const byDataEn = line.includes('data-en=');
  // JSX 直接文本：>中文< 或 >中文 后跟标签
  for (const m of line.matchAll(/>([^<>{}]*[\u4e00-\u9fa5][^<>{}]*)</g)) {
    const t = m[1].trim();
    if (t) samples.push({ text: t, line: i + 1, byDataEn });
  }
  // 属性值
  for (const m of line.matchAll(/(?:placeholder|aria-label|title|alt)="([^"]*[\u4e00-\u9fa5][^"]*)"/g)) {
    samples.push({ text: m[1].trim(), line: i + 1, byDataEn });
  }
});
check(samples.length >= 60, `抽到首页中文文案 ${samples.length} 条（≥60）`);

const cn = /[\u4e00-\u9fa5]/;
const missed: string[] = [];
for (const s of samples) {
  if (s.byDataEn) continue; // 由 data-en 整段替换负责
  const out = translateText(s.text, 'en');
  if (cn.test(out)) missed.push(`L${s.line} ${JSON.stringify(s.text)} → ${JSON.stringify(out)}`);
}
check(missed.length === 0,
  `非 data-en 文案英文模式零中文残留${missed.length ? '：' + missed.slice(0, 6).join(' | ') : ''}`);

/* ── 2. 关键整句译文（绝不能靠短词拼贴） ───────────────────────── */
const KEY: Array<[string, string]> = [
  ['免费注册子域名，通过 NS 委托掌控解析。每个邮箱都有免费额度，超出后可随时在控制台购买额外配额。',
    'Register a free subdomain and manage DNS through NS delegation. Every email gets a free quota; buy more in the console any time.'],
  ['免费额度、自动配置、NS 委托和独立控制台，适合个人站点、Demo 和轻量服务。',
    'Free quota, automatic setup, NS delegation and a standalone console — built for personal sites, demos and lightweight services.'],
  ['服务概览', 'At a glance'],
  ['主导航', 'Main navigation'],
  ['站点数据', 'Site stats'],
  ['NS 委托', 'NS delegation'],
  ['长期有效', 'No expiry'],
];
for (const [zh, en] of KEY) {
  check(translateText(zh, 'en') === en, `整句/词条精确命中：${zh.slice(0, 18)}`);
}
check(!/ServicesOverview/.test(translateText('服务概览', 'en')),
  '「服务概览」不再被子串拼成 ServicesOverview');

/* ── 3. data-en 机制 ───────────────────────────────────────────── */
check(/function applyDataEn/.test(i18n), 'i18n 提供 data-en 整段替换');
check(/el\.querySelectorAll<Element>\('\[data-en\]'\)\.forEach\(applyDataEn\)/.test(i18n),
  '<pre><code> 内的 data-en 注释也能被翻译');
check(/t\.parentElement\?\.closest\?\.\('\[data-en\]'\)/.test(i18n),
  'MutationObserver 跳过 data-en 节点，切回中文可精确还原');
check((home.match(/data-en=/g) || []).length >= 4 &&
  /data-en="SUFFIX"/.test(home) && /data-en="DOMAINS"/.test(home) && /data-en="USERS"/.test(home),
  'Home.tsx 的 data-en 覆盖主标题 / 后缀段 / 代码注释 / 展开表头');
check(/data-en="Your own subdomain\."/.test(home), '主标题英文整句不含残留「专属」');
check(/data-en="# Check subdomain status \(public API\)"/.test(home) &&
      /data-en="# Example response"/.test(home), '代码块注释有英文整句');

/* ── 4. 词典文件本身 ───────────────────────────────────────────── */
check(dict.includes("'不限': 'Unlimited'"), '控制台「∞ 不限」也补了词条');

for (const m of ok) console.log('  ✓ ' + m);
for (const m of bad) console.error('  ✗ ' + m);
console.log(`首页 i18n 回归：${ok.length} 通过，${bad.length} 失败`);
if (bad.length) process.exit(1);
