/**
 * 把两份根域名落地页与服务文档导出成可上传的静态文件。
 * 产物落在 dist/root-pages/（不入库）：想继续用 CNAME / Pages / R2 直接挂时跑一次即可。
 * 若把 v-1.top、meoy.top 的流量指到本 Worker，则不需要这一步，Worker 按 Host 直出。
 * /docs 同样既可由 Worker 直出，也可导出 docs.html 挂任意静态托管。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { meoyTopHtml } from '../src/html/root-meoy.ts';
import { v1TopHtml } from '../src/html/root-v1.ts';
import { docsHtml } from '../src/html/docs.ts';

const out = new URL('../dist/root-pages/', import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL('meoy.top.html', out), meoyTopHtml, 'utf8');
writeFileSync(new URL('v-1.top.html', out), v1TopHtml, 'utf8');
writeFileSync(new URL('docs.html', out), docsHtml, 'utf8');
console.log('✓ 已导出 dist/root-pages/meoy.top.html、v-1.top.html 与 docs.html');
