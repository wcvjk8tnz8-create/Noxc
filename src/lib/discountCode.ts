/**
 * Noxc · DC 积分优惠码（注册域名时抵扣）
 *
 * 真实用途：管理员在「奖励中心」生成 DC-XXXXXX，用户申请子域名时填写，
 * 直接抵扣本次的积分消耗；同一账号对同一张券只能用一次。
 * 「奖励中心」里直接兑换成积分余额的旧路径保留兼容（见 routes/redeem.ts），
 * 两条路径共用同一张 redeem_codes / redeem_logs，去重口径完全一致。
 *
 * 校验与消耗拆成两步，方便注册接口在「域名写入前」先占位：
 *   1) resolveDiscountCode —— 纯读，算出 discount / payable，不写任何东西
 *   2) consumeDiscountCode —— 写 log + 条件 UPDATE used_count（并发安全）
 *   3) rollbackDiscountCode —— 域名写入失败时把占位还回去
 *
 * 原子性说明：D1 没有跨语句事务。消耗券放在域名 INSERT 之前，
 * 若 INSERT 因唯一约束失败就立刻回滚券；AI 驳回 / 积分不足 / 配额不足
 * 都在消耗之前拦下，券绝不会被白白吃掉。
 */

export interface DiscountResolution {
  /** 命中的券；null = 未填写 / 本次免费 / 不可用 */
  row: any | null;
  /** 本次实际抵扣的积分 */
  discount: number;
  /** 抵扣后仍需支付的积分 */
  payable: number;
  /** 不可用原因（空串 = 可用或未填写） */
  reason: string;
  /** 规范化后的码，供写日志与返回前端 */
  code: string;
}

/** 校验并规范化兑换码输入（大小写不敏感，去掉空白） */
export function normCode(raw: unknown): string {
  return String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * 解析一张 DC 码能抵扣多少。cost <= 0 时直接跳过（本次免费，不浪费券）。
 * 不抛错：所有失败都通过 reason 返回，由调用方决定是拦下还是忽略。
 */
export async function resolveDiscountCode(
  db: any,
  rawCode: unknown,
  userId: number,
  cost: number,
  nowMs: number = Date.now(),
): Promise<DiscountResolution> {
  const base: DiscountResolution = { row: null, discount: 0, payable: Math.max(0, Number(cost) || 0), reason: '', code: '' };
  const code = normCode(rawCode);
  if (!code) return base;
  base.code = code;
  if (cost <= 0) {
    return { ...base, reason: '本次申请不消耗积分，优惠码未使用' };
  }
  if (!/^DC-[A-Z0-9]{4,12}$/.test(code)) {
    return { ...base, reason: '积分优惠码格式应为 DC-XXXXXX' };
  }

  const row: any = await db.prepare('SELECT * FROM redeem_codes WHERE code = ?')
    .bind(code).first().catch(() => null);
  if (!row) return { ...base, reason: '优惠码不存在' };
  if (String(row.type) !== 'points') return { ...base, reason: '该兑换码不是积分优惠码（请使用 DC- 开头的码）' };
  if (String(row.status) !== 'active') return { ...base, reason: '该优惠码已被停用' };
  if (row.expires_at && Number(row.expires_at) < nowMs) return { ...base, reason: '该优惠码已过期' };

  const dup: any = await db.prepare('SELECT id FROM redeem_logs WHERE code = ? AND user_id = ?')
    .bind(code, userId).first().catch(() => null);
  if (dup) return { ...base, reason: '你已经使用过这个优惠码了' };
  if (Number(row.used_count) >= Number(row.max_uses)) return { ...base, reason: '该优惠码已被用完' };

  /* 只抵扣本次真正要付的部分：面值 3000 的券用在 60 分域名上，
     实际只抵 60 分，不会「找零」把积分余额凭空变多。 */
  const value = Math.max(0, Math.min(Number(row.value) || 0, 100000));
  const discount = Math.min(base.payable, value);
  return {
    row, discount, payable: base.payable - discount, reason: '', code,
  };
}

/**
 * 消耗一张券：先写兑换记录（本人去重的凭据），再条件累加用量。
 * 条件 UPDATE 保证并发下不会超发；失败会撤掉刚写的 log 并抛错。
 * @param applied 本次实际抵扣的积分（写进日志便于对账）
 */
export async function consumeDiscountCode(
  db: any,
  row: any,
  userId: number,
  applied: number,
  nowMs: number = Date.now(),
): Promise<void> {
  const code = String(row.code || '').toUpperCase();
  let logged = false;
  try {
    await db.prepare(
      'INSERT INTO redeem_logs (code, user_id, type, subdomain_id, value, created_at) VALUES (?,?,?,?,?,?)'
    ).bind(code, userId, 'points', null, applied, nowMs).run();
    logged = true;
    const upd: any = await db.prepare(
      'UPDATE redeem_codes SET used_count = used_count + 1 WHERE id = ? AND used_count < max_uses'
    ).bind(row.id).run();
    if (Number(upd?.meta?.changes || 0) <= 0) throw new Error('coupon_exhausted');
  } catch (e) {
    if (logged) {
      await db.prepare('DELETE FROM redeem_logs WHERE code = ? AND user_id = ? AND subdomain_id IS NULL')
        .bind(code, userId).run().catch(() => null);
    }
    throw e;
  }
}

/** 域名写入失败等场景：把上面的占位完整还回去。 */
export async function rollbackDiscountCode(db: any, row: any, userId: number): Promise<void> {
  const code = String(row.code || '').toUpperCase();
  await db.prepare('DELETE FROM redeem_logs WHERE code = ? AND user_id = ? AND subdomain_id IS NULL')
    .bind(code, userId).run().catch(() => null);
  await db.prepare('UPDATE redeem_codes SET used_count = MAX(0, used_count - 1) WHERE id = ?')
    .bind(row.id).run().catch(() => null);
}
