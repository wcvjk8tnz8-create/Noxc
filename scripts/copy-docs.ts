/**
 * 把 VitePress 产物并入 Worker 的静态资源目录。
 * wrangler.toml: [assets] directory = "dist/client"
 * 因此 /docs/* 对应 dist/client/docs/*；VitePress 的 base 也是 /docs/。
 */
import { cpSync, existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../docs-src/.vitepress/dist/', import.meta.url));
const client = fileURLToPath(new URL('../dist/client/', import.meta.url));
const dest = fileURLToPath(new URL('../dist/client/docs/', import.meta.url));

if (!existsSync(src) || !existsSync(fileURLToPath(new URL('../docs-src/.vitepress/dist/index.html', import.meta.url)))) {
  console.error('✗ VitePress 产物缺失，先跑 vitepress build docs-src');
  process.exit(1);
}
mkdirSync(client, { recursive: true });
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
const files = readdirSync(dest);
console.log('✓ 已并入 dist/client/docs/：' + files.length + ' 项（' + files.slice(0, 8).join(', ') + '…）');
