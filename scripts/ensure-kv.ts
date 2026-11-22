/**
 * 确保 Workers KV namespace 存在，并**自动绑定到 wrangler.toml**。
 *
 * 与 ensure-d1.ts / ensure-r2.ts 同一套约定：
 *  - 已存在（按 title 查找）→ 复用 id → 写入 [[kv_namespaces]]
 *  - 不存在 → 通过 Cloudflare API 创建 → 写入绑定
 *  - 任何失败（Token 缺 KV 权限 / 网络问题）→ 移除绑定并降级，绝不阻断部署
 *
 * 绑定名固定为 KV；业务代码全部判空使用（见 src/types.d.ts），
 * 没绑上时站点功能不受影响，/api/config 的 kvBound 会返回 false 便于排查。
 *
 * 环境变量：
 *   必需 CLOUDFLARE_ACCOUNT_ID、CLOUDFLARE_API_TOKEN
 *   可选 KV_NAMESPACE_TITLE（默认 noxc-kv）、KV_NAMESPACE_ID（直接复用已有 id，跳过 API）
 */
const BASE = process.env.CLOUDFLARE_API_BASE || 'https://api.cloudflare.com/client/v4';
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const TITLE = String(process.env.KV_NAMESPACE_TITLE || 'noxc-kv').trim();
const PRESET_ID = String(process.env.KV_NAMESPACE_ID || '').trim();
const TOML = new URL('../wrangler.toml', import.meta.url).pathname;

/** 按行定位 [[header]] 绑定块；块间注释必须保留，不能被整段正则吞掉 */
function bindingBlock(lines: string[], header: string): [number, number] | null {
  const start = lines.findIndex((l) => new RegExp(`^\\s*\\[\\[${header}\\]\\]`).test(l));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length) {
    const l = lines[end];
    if (/^\s*#/.test(l)) break;
    if (/^\s*\[(?:\[|[a-z_])/.test(l)) break;
    if (/^\s*$/.test(l) || /^\s*[A-Za-z_]+\s*=/.test(l)) { end++; continue; }
    break;
  }
  return [start, end];
}

async function disableKV(reason: string) {
  // 静默降级是刻意的，但「步骤绿 = 已绑定」会误导人：把原因显式写进
  // Job Summary 并打一条 warning annotation，保证在 CI 页面一眼可见。
  console.log(`::warning::KV 未自动绑定：${reason}`);
  try {
    const { appendFileSync } = await import('node:fs');
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `### ⚠ KV 未自动绑定\n\n原因：${reason}\n\n` +
      `修复：给 API Token 加 **Account → Workers KV Storage → Edit** 后重新部署；` +
      `或手动创建 namespace，把 id 填进仓库 Variables 的 \`KV_NAMESPACE_ID\` 再部署。\n`);
  } catch { /* summary 写不进不影响主流程 */ }
  console.log('');
  console.log('⚠ 未能准备好 KV namespace：' + reason);
  console.log('  → 本次部署将移除 KV 绑定：站点其它功能全部正常。');
  console.log('  如需启用，请给 API Token 加上 Account → Workers KV Storage → Edit 权限后重新部署；');
  console.log(`  或手动创建后把 id 填进 Variables 的 KV_NAMESPACE_ID：npx wrangler kv namespace create ${TITLE}`);
  try {
    const { readFileSync, writeFileSync } = await import('node:fs');
    const lines = readFileSync(TOML, 'utf8').split('\n');
    const range = bindingBlock(lines, 'kv_namespaces');
    if (range) {
      lines.splice(range[0], range[1] - range[0]);
      writeFileSync(TOML, lines.join('\n'));
      console.log('  ✓ 已从 wrangler.toml 移除 [[kv_namespaces]] 绑定');
    }
  } catch (e: any) {
    console.log('  · 移除绑定失败：' + e.message);
  }
  if (process.env.GITHUB_ENV) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_ENV, 'KV_ENABLED=false\n');
  }
  console.log('');
  process.exit(0); // 不阻断部署
}

/** 把 [[kv_namespaces]] 写入 wrangler.toml（已存在则更新 id） */
async function enableKV(id: string) {
  const { readFileSync, writeFileSync } = await import('node:fs');
  let t = readFileSync(TOML, 'utf8');
  const block = `[[kv_namespaces]]\nbinding = "KV"\nid = "${id}"`;
  const lines = t.split('\n');
  const range = bindingBlock(lines, 'kv_namespaces');

  if (range) {
    lines.splice(range[0], range[1] - range[0], ...block.split('\n'));
    writeFileSync(TOML, lines.join('\n'));
    console.log(`✔ 已更新 wrangler.toml 的 KV 绑定：KV → ${id}`);
  } else {
    // 优先插在 [[d1_databases]] 之前，与其他绑定放一起
    if (t.includes('\n[[d1_databases]]')) {
      t = t.replace('\n[[d1_databases]]', '\n' + block + '\n\n[[d1_databases]]');
    } else {
      t = t.replace(/\n\[vars\]/, '\n' + block + '\n\n[vars]');
    }
    writeFileSync(TOML, t);
    console.log(`✔ 已自动绑定 KV 到 wrangler.toml：KV → ${id}`);
  }
  try {
    if (process.env.GITHUB_STEP_SUMMARY) {
      const { appendFileSync } = await import('node:fs');
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ✅ KV 已自动绑定：\`KV\` → \`${id}\`\n`);
    }
  } catch { /* 忽略 */ }
  if (process.env.GITHUB_ENV) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_ENV, `KV_ENABLED=true\nKV_NAMESPACE_ID=${id}\n`);
  }
}

// 已经知道 id（管理员在 Variables 里手填）→ 直接写绑定，不调 API
if (PRESET_ID) {
  console.log(`✔ 复用 Variables 里配置的 KV namespace id：${PRESET_ID}`);
  await enableKV(PRESET_ID);
  process.exit(0);
}

if (!ACCOUNT || !TOKEN) {
  await disableKV('缺少 CLOUDFLARE_ACCOUNT_ID 或 CLOUDFLARE_API_TOKEN');
}

const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
async function cf(pathname: string, method = 'GET', body?: unknown): Promise<any> {
  let r: any;
  try {
    r = await fetch(`${BASE}${pathname}`, {
      method,
      headers: H,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e: any) {
    throw new Error('网络请求失败：' + e.message);
  }
  const text = await r.text();
  let j: any;
  try { j = JSON.parse(text); }
  catch { throw new Error(`Cloudflare 返回无法解析的内容（HTTP ${r.status}）`); }
  if (!r.ok || !j.success) {
    // Cloudflare 对「token 有效但缺该资源权限」也常返回 10000 Authentication error，
    // 把 code 一起带出来，避免被误读成 token 过期。
    const msg = (j.errors || []).map((e: any) =>
      `${e.message || 'Cloudflare error'}${e.code ? ` (code ${e.code})` : ''}`).join('；') || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return j.result;
}

// 1. 按 title 查找（KV 列表接口分页，最多翻 20 页）
let id = '';
try {
  for (let page = 1; page <= 20 && !id; page++) {
    const list: any = await cf(`/accounts/${ACCOUNT}/storage/kv/namespaces?per_page=100&page=${page}`);
    const arr: any[] = Array.isArray(list) ? list : (list?.namespaces || []);
    const hit = arr.find((n: any) => String(n.title || '') === TITLE);
    if (hit?.id) id = String(hit.id);
    if (arr.length < 100) break;
  }
  if (id) console.log(`✔ 复用已存在的 KV namespace「${TITLE}」`);
} catch (e: any) {
  await disableKV('查询 namespace 失败：' + e.message);
}

// 2. 不存在则创建
if (!id) {
  try {
    const created: any = await cf(`/accounts/${ACCOUNT}/storage/kv/namespaces`, 'POST', { title: TITLE });
    id = String(created?.id || '');
    if (!id) throw new Error('创建成功但未返回 id');
    console.log(`✔ 已创建 KV namespace「${TITLE}」`);
  } catch (e: any) {
    await disableKV('创建 namespace 失败：' + e.message);
  }
}

await enableKV(id);
