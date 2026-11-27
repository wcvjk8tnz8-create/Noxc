/**
 * SEUS DNS（s.eus）接入 · 专项回归
 *
 * 背景：用户要求「接入 seus dns 的 api（看 seus 社区应该有文档）」。
 * SEUS 开发者文档 https://s.eus/en/docs 把自动化注册子域 / 管理 DNS 记录列为
 * Domains & DNS APIs，但子页需站内会话，外部只能读到 Introduction；社区官方
 * 教程给出的自动化入口是 MCP：https://s.eus/api/mcp + 账户设置生成的 mbt_ Token
 * + Authorization: Bearer。MCP 的 DNS 工具面（dns_zones / dns_record_create /
 * dns_record_update / dns_record_delete / dns_records_import / dns_records_export）
 * 由官方服务器暴露，工具 schema 由第三方 MCP 目录实抓确认。
 *
 * 本回归两层：
 *   A. 真跑 src/lib/seusDns.ts + src/lib/providerDns.ts：mock Streamable HTTP
 *      （JSON / SSE 两种响应、initialize → session → tools/call），逐项核对
 *      鉴权头、会话复用、工具名、相对名称、TTL、NS、错误路径、Token 不外泄
 *   B. 静态断言：供应商列表、前端文案、CI、README、即将上线闸门不回退
 *
 * 运行：npx tsx scripts/seus-dns-regression.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { connectProvider, addRecord, recordTypesFor } from '../src/lib/providerDns.js';
import { SEUS_MCP_URL, SEUS_NS, SEUS_RECORD_TYPES } from '../src/lib/seusDns.js';

const ok: string[] = [];
const bad: string[] = [];
const check = (v: any, m: string) => (v ? ok.push(m) : bad.push(m));
const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf8');

const TOKEN = 'mbt_test_token_9f3ac1';
const DOMAIN = 'example.com';

/* ───────── A. Streamable HTTP mock ───────── */
type Req = { url: string; headers: Record<string, string>; body: any };
let requests: Req[] = [];
const state = {
  format: 'json' as 'json' | 'sse',
  authFail: false,
  toolError: false,
  zones: [] as any[],
  recordId: 'rec-seus-1',
};

function mk(status: number, headers: Record<string, string>, text: string, sse = false) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  if (sse) h.set('content-type', 'text/event-stream');
  return {
    status,
    headers: { get: (k: string) => h.get(k.toLowerCase()) ?? null },
    text: async () => (sse ? `event: message\ndata: ${text}\n\n` : text),
  } as any;
}

function rpcResult(id: number, result: any) {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

(globalThis as any).fetch = async (url: string, init: any) => {
  const body = JSON.parse(String(init?.body || '{}'));
  const headers = (init?.headers || {}) as Record<string, string>;
  requests.push({ url, headers, body });
  const sse = state.format === 'sse';
  const ct = { 'content-type': sse ? 'text/event-stream' : 'application/json' };

  if (state.authFail) return mk(401, ct, 'unauthorized', sse);
  if (body.method === 'initialize') {
    return mk(200, { ...ct, 'Mcp-Session-Id': 'sess-seus-1' }, rpcResult(body.id, {
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 's.eus', version: '1.0' },
    }), sse);
  }
  if (body.method === 'notifications/initialized') return mk(202, ct, '', sse);
  if (body.method === 'tools/call') {
    const name = body.params?.name;
    let result: any;
    if (state.toolError) {
      result = { isError: true, content: [{ type: 'text', text: 'Error: zone quota exceeded' }] };
    } else if (name === 'dns_zones') {
      result = { content: [{ type: 'text', text: JSON.stringify({ zones: state.zones }) }] };
    } else if (name === 'dns_record_create') {
      const a = body.params?.arguments || {};
      result = { content: [{ type: 'text', text: JSON.stringify({
        id: state.recordId, zoneId: a.zoneId, type: a.type, name: a.name, content: a.content, ttl: a.ttl,
      }) }] };
    } else {
      result = { isError: true, content: [{ type: 'text', text: `Unknown tool ${name}` }] };
    }
    return mk(200, ct, rpcResult(body.id, result), sse);
  }
  return mk(400, ct, rpcResult(body.id ?? 0, {}), sse);
};

function reset(format: 'json' | 'sse' = 'json') {
  requests = [];
  state.format = format;
  state.authFail = false;
  state.toolError = false;
  state.zones = [{ id: 'zone-seus-uuid', name: DOMAIN, status: 'active' }];
  state.recordId = 'rec-seus-1';
}

async function main() {
  /* ── A1. 连接：JSON 响应 ── */
  reset('json');
  const conn: any = await connectProvider('seus', TOKEN, DOMAIN);
  check(conn?.ok === true, 'SEUS 连接成功（找到托管区域）');
  check(String(conn?.zoneId) === 'zone-seus-uuid', 'zoneId 取自 dns_zones 返回的托管区域');
  check(JSON.stringify(conn?.ns) === JSON.stringify([...SEUS_NS]),
    `返回官方 NS ${SEUS_NS.join(' / ')}`);
  check(/NS/.test(String(conn?.note || '')), 'note 明确提示 NS 未生效前记录不会全球解析');

  const initReq = requests.find((r) => r.body?.method === 'initialize');
  check(initReq?.url === SEUS_MCP_URL, `落在官方 MCP 端点 ${SEUS_MCP_URL}`);
  check(initReq?.headers?.Authorization === `Bearer ${TOKEN}`, 'Authorization: Bearer mbt_ Token');
  check(/text\/event-stream/.test(String(initReq?.headers?.Accept || '')),
    'Accept 同时接受 application/json 与 text/event-stream');
  check(initReq?.body?.params?.protocolVersion === '2025-06-18', 'initialize 带 MCP 协议版本');
  check(requests.some((r) => r.body?.method === 'notifications/initialized'),
    'initialize 后发送 notifications/initialized');
  const callReqs = requests.filter((r) => r.body?.method === 'tools/call');
  check(callReqs.length === 1 && callReqs[0].body?.params?.name === 'dns_zones',
    '连接阶段只调 dns_zones（不猜、不自动建区）');
  check(callReqs[0]?.headers?.['Mcp-Session-Id'] === 'sess-seus-1',
    'tools/call 复用 initialize 返回的 Mcp-Session-Id');
  check(!requests.some((r) => /mbt_test_token/.test(JSON.stringify(r.body))),
    'Token 只出现在 Authorization 头，不进 JSON-RPC 参数');

  /* ── A2. 写记录：JSON 响应，区顶点 + 子域 ── */
  reset('json');
  const apex: any = await addRecord('seus', TOKEN, DOMAIN, 'zone-seus-uuid', {
    type: 'ALIAS', name: '@', content: 'worker.example.net', ttl: 3600,
  });
  check(apex?.ok === true && String(apex.id) === 'rec-seus-1', 'SEUS 写入 ALIAS 记录成功并返回记录 id');
  const create = requests.find((r) => r.body?.params?.name === 'dns_record_create');
  check(create?.body?.params?.arguments?.name === '@',
    '区顶点传相对名称 @（不是完整 FQDN，避免 SEUS 再拼一次后缀）');
  check(create?.body?.params?.arguments?.zoneId === 'zone-seus-uuid'
    && create?.body?.params?.arguments?.type === 'ALIAS'
    && create?.body?.params?.arguments?.content === 'worker.example.net'
    && create?.body?.params?.arguments?.ttl === 3600,
    'tools/call 参数：zoneId / type / name / content / ttl 一一对应');
  check(/a\.ns\.fs5\.net/.test(String(apex?.note || '')), '写记录后的提示仍带官方 NS 前提');

  reset('json');
  const sub: any = await addRecord('seus', TOKEN, DOMAIN, 'zone-seus-uuid', {
    type: 'HTTPS', name: 'www.' + DOMAIN, content: '1 . alpn=h2', ttl: 60,
  });
  const create2 = requests.find((r) => r.body?.params?.name === 'dns_record_create');
  check(sub?.ok === true && create2?.body?.params?.arguments?.name === 'www',
    '子域转成相对标签 www（完整 FQDN 不外传）');

  /* ── A3. SSE 响应也吃得下 ── */
  reset('sse');
  const sseConn: any = await connectProvider('seus', TOKEN, DOMAIN);
  check(sseConn?.ok === true && sseConn?.zoneId === 'zone-seus-uuid',
    'text/event-stream 响应同样解析成功');
  reset('sse');
  const sseRec: any = await addRecord('seus', TOKEN, DOMAIN, 'zone-seus-uuid', {
    type: 'TXT', name: '@', content: 'hello', ttl: 300,
  });
  check(sseRec?.ok === true, 'SSE 下的 dns_record_create 同样成功');

  /* ── A4. 失败路径 ── */
  reset('json'); state.authFail = true;
  const auth: any = await connectProvider('seus', TOKEN, DOMAIN);
  check(auth?.ok === false && /鉴权|mbt_|dns:write/.test(String(auth?.error || '')),
    '401 → 明确提示检查 mbt_ Token 与 dns:write 权限，不假装成功');

  reset('json'); state.toolError = true;
  const toolErr: any = await addRecord('seus', TOKEN, DOMAIN, 'zone-seus-uuid', {
    type: 'A', name: '@', content: '1.2.3.4', ttl: 300,
  });
  check(toolErr?.ok === false && /执行失败|quota/.test(String(toolErr?.error || '')),
    '工具 isError → 原文透传，明确失败');

  reset('json'); state.zones = [];
  const noZone: any = await connectProvider('seus', TOKEN, DOMAIN);
  check(noZone?.ok === false && /KYC|BYOS|a\.ns\.fs5\.net/.test(String(noZone?.error || '')),
    '找不到托管区域 → 提示 BYOS 条件，不自动建区、不假装已托管');

  reset('json');
  const badType: any = await addRecord('seus', TOKEN, DOMAIN, 'zone-seus-uuid', {
    type: 'BOGUS', name: '@', content: 'x', ttl: 300,
  });
  check(badType?.ok === false && /不支持的记录类型/.test(String(badType?.error || '')),
    '非法记录类型被本地拦掉，不打给 SEUS');
  const badName: any = await addRecord('seus', TOKEN, DOMAIN, 'zone-seus-uuid', {
    type: 'A', name: 'evil.org', content: '1.2.3.4', ttl: 300,
  });
  check(badName?.ok === false && /必须属于/.test(String(badName?.error || '')),
    '越域名称被拦掉，本站不会变成任意 zone 的写接口');
  const noZoneId: any = await addRecord('seus', TOKEN, DOMAIN, '', {
    type: 'A', name: '@', content: '1.2.3.4', ttl: 300,
  });
  check(noZoneId?.ok === false && /zone id/.test(String(noZoneId?.error || '')),
    '缺 zone id 时明确提示先连接');

  /* ── A5. Token 不外泄 ── */
  const allReturns = [conn, apex, sub, sseConn, sseRec, auth, toolErr, noZone, badType, badName, noZoneId];
  check(!allReturns.some((r) => JSON.stringify(r).includes(TOKEN)),
    '任何返回值里都不含 mbt_ Token');

  /* ── A6. 记录类型集 ── */
  check(recordTypesFor('seus').includes('ALIAS')
    && recordTypesFor('seus').includes('HTTPS')
    && recordTypesFor('seus').includes('SVCB')
    && !recordTypesFor('cloudflare').includes('ALIAS'),
    'SEUS 扩展类型集（ALIAS/HTTPS/SVCB），Cloudflare / DNSHE 保持原集合');
  check(SEUS_RECORD_TYPES.includes('TXT') && SEUS_RECORD_TYPES.includes('MX'),
    'SEUS 类型集覆盖 TXT 所有权验证与常见 MX');

  /* ── B. 静态断言 ── */
  const pd = read('src/lib/providerDns.ts');
  const sd = read('src/lib/seusDns.ts');
  const ed = read('src/routes/externalDomains.ts');
  const dash = read('src/app/pages/Dashboard.tsx') + '\n' + read('src/app/pages/ExternalDomains.tsx');
  const reg = read('src/app/pages/Register.tsx');
  const deploy = read('.github/workflows/deploy.yml');
  const readme = read('README.md');
  const hc = read('scripts/health-check.ts');

  check(/'seus'/.test(pd) && /'anyns'/.test(pd) && /cloudflare/.test(pd)
    && /recordTypesFor/.test(pd),
    '供应商适配层仍保留四家（NS 委派用）；第三方接入主流程已固定 SEUS');
  check(/seusConnect/.test(ed) && /validateExternalDomain/.test(ed)
    && /'seus'/.test(ed),
    '接入主流程：gTLD 校验 + SEUS API 连接，固定 SEUS DNS');
  check(/s\.eus\/api\/mcp/.test(sd) && /dns_record_create/.test(sd) && /dns_zones/.test(sd),
    '适配器只调官方 MCP 工具，不猜裸 REST 路径');
  check(/Mcp-Session-Id/.test(sd) && /notifications\/initialized/.test(sd),
    '完整 Streamable HTTP 握手（initialize → session → initialized）');
  check(/mbt_/.test(sd) && /不落库|只在本次调用/.test(sd), 'Token 只在内存里用');
  check(/SEUS DNS/.test(dash) && /SEUS DNS/.test(reg) && /mbt_/.test(dash),
    '控制台 / 注册页都写明固定 SEUS DNS 与 mbt_ Token 口径');
  check(/verifyGate/.test(read('src/routes/externalDomains.ts'))
    && /app\.post\('\/:id\/verify'/.test(read('src/routes/externalDomains.ts')),
    '第三方接入先 TXT 验证再改 NS，SEUS 连接接口有顺序守卫');
  check(/seus-dns-regression\.ts/.test(deploy), 'SEUS DNS 回归挂进 CI');
  check(/SEUS DNS/.test(readme) && /s\.eus\/api\/mcp/.test(readme), 'README 记录 SEUS 接入');
  check(/SEUS|seus/.test(hc), '健康巡检含 SEUS 防回流断言');
  check(!/comingSoon|EXTERNAL_DOMAINS_COMING_SOON/.test(ed)
    && !/即将上线/.test(ed),
    '「即将上线」闸门已撤：第三方域名接入按站长定版流程开放');
  check(/站长/.test(ed) && /approve|批准/.test(read('src/routes/admin.ts')),
    '接入申请由站长在站点设置里批准');

  for (const m of ok) console.log('  ✓ ' + m);
  for (const m of bad) console.error('  ✗ ' + m);
  console.log(`SEUS DNS 接入回归：${ok.length} 通过，${bad.length} 失败`);
  if (bad.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
