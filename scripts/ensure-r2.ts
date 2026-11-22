/**
 * 确保 R2 存储桶存在，并**自动绑定到 wrangler.toml**。
 *
 * 设计原则：**绝不阻断部署**。
 *  - 桶已存在 → 复用 → 自动写入 [[r2_buckets]] 绑定
 *  - 桶不存在 → 通过 Cloudflare API 自动创建 → 自动写入绑定
 *  - 任何失败（权限不足 / Authentication error / 网络问题）
 *        移除绑定并降级：站点全部功能正常，仅「上传自定义头像」不可用；
 *        内置 12 款头像与外链头像不受影响。
 *
 * 注意「绑定」与「开放上传」是两件事：
 *   · 本脚本只负责把桶备好并绑上（binding = AVATARS）
 *   · 头像**上传**功能是否开放，由 AVATAR_ENABLED 决定（见 src/routes/profile.js）
 *     未显式设为 "1" 时，即使已绑定 R2，上传接口仍按「未启用」返回 —— 这是刻意的。
 *     这样桶随时可用，又不会因为 R2 临时不可用而让站点报错。
 *
 * 关于「公网地址」：
 *   头像默认由 Worker 的 /api/avatar/<key> 代理读取，该 URL 本身即公网可访问，
 *   因此 R2 桶**不需要**开启公开访问，也无需绑定自定义域。
 *   如需外链直连以省 Worker 流量，可设置 R2_CUSTOM_DOMAIN / R2_PUBLIC_URL。
 *
 * 环境变量：
 *   必需 CLOUDFLARE_ACCOUNT_ID、CLOUDFLARE_API_TOKEN
 *   可选 R2_BUCKET_NAME（默认 meoy-avatars）、R2_CUSTOM_DOMAIN、CF_ZONE_ID
 */
const BASE = process.env.CLOUDFLARE_API_BASE || 'https://api.cloudflare.com/client/v4';
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const NAME = process.env.R2_BUCKET_NAME || 'meoy-avatars';
const CUSTOM = String(process.env.R2_CUSTOM_DOMAIN || '').trim();
const ZONE = String(process.env.CF_ZONE_ID || '').trim();
// 桶已在 Cloudflare 控制台手动创建、但 API Token 没有 R2 列桶权限时，
// 设为 1 可跳过 API 校验直接写绑定（KV 侧对应的是 KV_NAMESPACE_ID）。
const ASSUME = String(process.env.R2_ASSUME_EXISTS || '').trim() === '1';

const TOML = new URL('../wrangler.toml', import.meta.url).pathname;

/**
 * 定位 [[header]] 绑定块的行区间。
 * 旧版用「吃到下一个顶层节」的整段正则，会把块间的说明注释（例如 KV 的
 * # [[kv_namespaces]] 占位说明）一起吞掉；这里按行处理，注释一律保留。
 */
function bindingBlock(lines: string[], header: string): [number, number] | null {
  const start = lines.findIndex((l) => new RegExp(`^\\s*\\[\\[${header}\\]\\]`).test(l));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length) {
    const l = lines[end];
    if (/^\s*#/.test(l)) break;                       // 块间注释，保留
    if (/^\s*\[(?:\[|[a-z_])/.test(l)) break;         // 下一个顶层节
    if (/^\s*$/.test(l) || /^\s*[A-Za-z_]+\s*=/.test(l)) { end++; continue; }
    break;
  }
  return [start, end];
}

async function disableR2(reason) {
  // 与 ensure-kv.ts 一致：降级不阻断部署，但原因必须在 CI 页面可见，
  // 否则「步骤绿」会被误读成「已自动连接」。
  console.log(`::warning::R2 未自动绑定：${reason}`);
  try {
    const { appendFileSync } = await import('node:fs');
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `### ⚠ R2 未自动绑定\n\n原因：${reason}\n\n` +
      `修复：给 API Token 加 **Account → R2 → Edit** 后重新部署；` +
      `或先手动创建桶 \`${NAME}\`，确认存在后再部署。\n`);
  } catch { /* summary 写不进不影响主流程 */ }
  console.log('');
  console.log('⚠ 未能准备好 R2 存储桶：' + reason);
  console.log('  → 本次部署将移除 R2 绑定：站点其它功能全部正常，仅「上传自定义头像」暂不可用，');
  console.log('    内置 12 款头像与外链头像仍可正常使用。');
  console.log('  如需启用，请给 API Token 加上 Account → R2 → Edit 权限后重新部署；');
  console.log('  或手动创建：npx wrangler r2 bucket create ' + NAME);

  try {
    const { readFileSync, writeFileSync } = await import('node:fs');
    const lines = readFileSync(TOML, 'utf8').split('\n');
    const range = bindingBlock(lines, 'r2_buckets');
    if (range) {
      lines.splice(range[0], range[1] - range[0]);
      writeFileSync(TOML, lines.join('\n'));
      console.log('  ✓ 已从 wrangler.toml 移除 [[r2_buckets]] 绑定');
    }
  } catch (e) {
    console.log('  ✘ 移除绑定失败：' + e.message);
    console.log('    若部署仍报 bucket 不存在，请手动删除 wrangler.toml 里的 [[r2_buckets]] 区块。');
  }

  if (process.env.GITHUB_ENV) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_ENV, 'R2_ENABLED=false\n');
  }
  console.log('');
  process.exit(0); // 不阻断部署
}

/** 把 [[r2_buckets]] 绑定写入 wrangler.toml（已存在则更新 bucket_name） */
async function enableR2(bucketName) {
  const { readFileSync, writeFileSync } = await import('node:fs');
  let t = readFileSync(TOML, 'utf8');
  const block = `[[r2_buckets]]\nbinding = "AVATARS"\nbucket_name = "${bucketName}"`;
  const lines = t.split('\n');
  const range = bindingBlock(lines, 'r2_buckets');

  if (range) {
    lines.splice(range[0], range[1] - range[0], ...block.split('\n'));
    writeFileSync(TOML, lines.join('\n'));
    console.log(`✔ 已更新 wrangler.toml 的 R2 绑定：AVATARS → ${bucketName}`);
  } else {
    // 不存在：追加到 [[d1_databases]] 之前（与其他绑定放一起）
    const marker = '\n[[d1_databases]]';
    if (t.includes(marker)) {
      t = t.replace(marker, '\n' + block + '\n\n[[d1_databases]]');
    } else {
      t = t.replace(/\n\[vars\]/, '\n' + block + '\n\n[vars]');
    }
    writeFileSync(TOML, t);
    console.log(`✔ 已自动绑定 R2 到 wrangler.toml：AVATARS → ${bucketName}`);
  }

  try {
    if (process.env.GITHUB_STEP_SUMMARY) {
      const { appendFileSync } = await import('node:fs');
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ✅ R2 已自动绑定：\`AVATARS\` → \`${bucketName}\`\n`);
    }
  } catch { /* 忽略 */ }
  if (process.env.GITHUB_ENV) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_ENV, 'R2_ENABLED=true\n');
  }
}

// 兜底路径：桶已手动建好，只是 Token 调不了 R2 API。R2 绑定只需要桶名，
// 不需要 namespace id，所以跳过校验直接写绑定；若桶实际不存在，
// wrangler deploy 会明确报错（不会静默丢失绑定，也不会带病上线）。
if (ASSUME) {
  console.log(`✔ 按 Variables 配置跳过 R2 API 校验，直接绑定桶「${NAME}」`);
  console.log('  · 若该桶实际不存在，wrangler deploy 会报错，请在控制台创建后重试。');
  await enableR2(NAME);
  process.exit(0);
}

if (!ACCOUNT || !TOKEN) {
  await disableR2('缺少 CLOUDFLARE_ACCOUNT_ID 或 CLOUDFLARE_API_TOKEN');
}

const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function cf(path, method = 'GET', body) {
  let r;
  try {
    r = await fetch(`${BASE}${path}`, {
      method,
      headers: H,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error('网络请求失败：' + e.message);
  }
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`Cloudflare 返回无法解析的内容（HTTP ${r.status}）`); }
  if (!r.ok || !json.success) {
    // 与 ensure-kv.ts 一致：code 10000 也可能是「token 有效但缺 R2 权限」
    const msg = (json.errors || []).map((e) =>
      `${e.message || 'Cloudflare error'}${e.code ? ` (code ${e.code})` : ''}`).join('；') || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return json.result;
}

// ---------- 1. 确保桶存在 ----------
let bucket = null;
try {
  const list = await cf(`/accounts/${ACCOUNT}/r2/buckets?per_page=100`);
  bucket = (list?.buckets || []).find((b) => b.name === NAME) || null;
} catch (e) {
  await disableR2('查询存储桶失败：' + e.message);
}

if (bucket) {
  console.log(`✔ 复用已存在的 R2 存储桶「${NAME}」`);
  await enableR2(NAME);
} else {
  try {
    bucket = await cf(`/accounts/${ACCOUNT}/r2/buckets`, 'POST', { name: NAME });
    console.log(`✔ 已创建 R2 存储桶「${NAME}」`);
    await enableR2(NAME);
  } catch (e) {
    // 创建失败（多为 Token 缺 R2:Edit 权限）→ 降级，不阻断
    await disableR2('创建存储桶失败：' + e.message);
  }
}

// ---------- 2. 可选：绑定自定义域（失败仅提示） ----------
if (CUSTOM && ZONE) {
  try {
    await cf(`/accounts/${ACCOUNT}/r2/buckets/${NAME}/domains/custom`, 'PUT', {
      domain: CUSTOM, zoneId: ZONE, minTLS: '1.0', enabled: true,
    });
    console.log(`✔ 已为 R2 桶绑定自定义域：https://${CUSTOM}`);
    if (process.env.GITHUB_ENV) {
      const { appendFileSync } = await import('node:fs');
      appendFileSync(process.env.GITHUB_ENV, `R2_PUBLIC_URL=https://${CUSTOM}\n`);
    }
  } catch (e) {
    console.log(`• 自定义域绑定未成功（${e.message}）`);
    console.log(`  可到控制台手动绑定：R2 → ${NAME} → Settings → Custom Domains`);
    console.log('  · 头像仍可通过 /api/avatar/<key> 正常访问，不影响使用。');
  }
} else {
  console.log('• 未配置 R2_CUSTOM_DOMAIN，头像通过 /api/avatar/<key> 代理读取（无需 R2 公网地址）');
}
