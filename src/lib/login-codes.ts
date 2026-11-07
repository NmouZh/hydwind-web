import { randomInt, randomUUID } from 'node:crypto';

/**
 * 登录码：/gate 页面发给玩家的颜文字码 + ASCII 备用码。
 *
 * 两个码指向同一条记录，验证任意一个都会把整条记录标记为已用。
 * 存储先做进程内 Map，适合当前的单实例 Node 部署；接口抽成 LoginCodeStore，
 * 以后换 Redis / SQLite 时只需要传一个新的实现，生成和校验逻辑不用动。
 *
 * 这一层不碰 HTTP、不碰账号存储：账号名和游戏 ID 都以字符串传入，
 * 方便 /api/plugin/login/verify 在路由层做鉴权和参数校验。
 */

/** 默认 24 个候选。刻意不用空格、反引号、&、§，避免 shell / Markdown / 命令解析惹麻烦。 */
export const KAOMOJI_POOL = [
  '(＾▽＾)',
  '(◕‿◕)',
  '(๑•̀ㅂ•́)و✧',
  '(づ｡◕‿‿◕｡)づ',
  '٩(◕‿◕)۶',
  '(≧∇≦)ﾉ',
  '(╯°□°)╯︵┻━┻',
  '(｡•́︿•̀｡)',
  'ʕ•ᴥ•ʔ',
  '(•̀ᴗ•́)و',
  '(◍•ᴗ•◍)',
  '(≧ω≦)',
  '(￣▽￣)',
  '(´・ω・｀)',
  '(＠_＠)',
  '(°ロ°)',
  '(☞ﾟヮﾟ)☞',
  '☜(ﾟヮﾟ☜)',
  '(ง•̀_•́)ง',
  '(¬_¬)',
  '(๑˃̵ᴗ˂̵)',
  'ಠ_ಠ',
  '(ᵔᴥᵔ)',
  '(ʘ‿ʘ)',
] as const;

export const FALLBACK_PREFIX = 'HWG';
/** 去掉 0/O/1/I/L 等易混字符，玩家手抄备用码时不容易看错。 */
export const FALLBACK_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const LOGIN_CODE_TTL_MS = 5 * 60 * 1000;
export const LOGIN_CODE_MAX_ATTEMPTS = 5;
export const LOGIN_CODE_ATTEMPT_WINDOW_MS = 5 * 60 * 1000;

/**
 * 颜文字候选池可用 `LOGIN_CODE_KAOMOJI_POOL`（逗号分隔）覆盖。
 * 空值或全部是空白时退回默认 24 个；重复项去重，避免两个候选永远抽到同一个。
 */
export const getKaomojiPool = (): readonly string[] => {
  const raw = process.env.LOGIN_CODE_KAOMOJI_POOL;
  if (raw === undefined) return KAOMOJI_POOL;

  const items = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return items.length > 0 ? [...new Set(items)] : KAOMOJI_POOL;
};

/** 备用码前缀可用 `LOGIN_CODE_FALLBACK_PREFIX` 覆盖，空值退回 `HWG`。 */
export const getFallbackPrefix = (): string => {
  const raw = process.env.LOGIN_CODE_FALLBACK_PREFIX?.trim();
  return raw ? raw : FALLBACK_PREFIX;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 由当前前缀派生，改前缀后匹配不会失效；大小写不敏感。 */
const fallbackPattern = (): RegExp =>
  new RegExp(`^${escapeRegExp(getFallbackPrefix())}-[A-Za-z0-9]{4}$`, 'i');

export type LoginCodeFailureReason =
  | 'invalid_code'
  | 'expired'
  | 'used'
  | 'game_id_mismatch'
  | 'rate_limited';

export interface StoredLoginCode {
  id: string;
  /** 绑定账号名（= 网站账号） */
  username: string;
  /** 生成时指定的游戏 ID，默认等于 username */
  gameId: string;
  /** 颜文字码，两个候选直接拼接 */
  kaomoji: string;
  /** ASCII 备用码，大写 <prefix>-XXXX */
  ascii: string;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
}

export interface AttemptResult {
  allowed: boolean;
  retryAfterMs: number;
  /** 本次尝试之后，当前窗口内还剩多少次机会；被限流时为 0。 */
  attemptsRemaining: number;
}

export type ConsumeResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_code' | 'expired' | 'used' };

/**
 * 可替换的存储接口。所有方法都是同步的，内存实现够用；
 * 以后接数据库时把方法改成 Promise 即可，届时同步修改调用方。
 */
export interface LoginCodeStore {
  insert(record: StoredLoginCode): void;
  /** 只查不改。已用、已过期的记录也要能查出来，才能给出准确原因。 */
  peek(code: string): StoredLoginCode | undefined;
  /**
   * 按 id 原子作废：记录不存在 / 已过期 / 已用时返回失败原因，不修改记录。
   * 校验流程在账号存在性等外部检查通过后才调用它，避免失败尝试烧掉有效码。
   */
  confirm(id: string, at: number): ConsumeResult;
  /** 记一次尝试；窗口内达到上限时 allowed=false。 */
  consumeAttempt(gameId: string, now: number, windowMs: number, limit: number): AttemptResult;
}

export interface GenerateLoginCodeInput {
  /** 网站账号名，登录码绑定到这一个人 */
  username: string;
  /** 预期使用的游戏 ID；不传则默认与账号名相同 */
  gameId?: string;
}

export interface GeneratedLoginCodes {
  code: string;
  fallback: string;
  expiresAt: number;
}

export interface VerifyLoginCodeInput {
  code: string;
  gameId: string;
}

export interface VerifyLoginCodeFailure {
  ok: false;
  reason: LoginCodeFailureReason;
  retryAfterMs?: number;
  attemptsRemaining?: number;
  /** reason=game_id_mismatch 时，告诉调用方这个码/账号期望的游戏 ID。 */
  expectedGameId?: string;
}

export type VerifyLoginCodeResult = { ok: true; username: string; gameId: string } | VerifyLoginCodeFailure;

export interface LoginCodeOptions {
  store?: LoginCodeStore;
  now?: () => number;
  ttlMs?: number;
  maxAttempts?: number;
  attemptWindowMs?: number;
}

/** 作废前的最终检查：true 表示可以消费，否则原样返回失败原因且不消费。 */
export type FinalCheck = true | { reason: LoginCodeFailureReason; expectedGameId?: string };

export interface VerifyLoginCodeOptions extends LoginCodeOptions {
  /**
   * 账号是否存在、游戏 ID 是否与账号名一致等外部检查。
   * 它在 markUsed 之前执行，返回失败时登录码保持未使用，玩家改对 ID 后还能继续用。
   */
  beforeConsume?: (record: StoredLoginCode) => FinalCheck | Promise<FinalCheck>;
}

/** NFC 归一化 + 去首尾空白。内部空白保留，避免把打错的码当成正确码。 */
export const normalizeLoginCode = (input: unknown): string => {
  if (typeof input !== 'string') return '';
  return input.normalize('NFC').trim();
};

/**
 * 查询键：ASCII 备用码的大小写不敏感。
 * 只对当前前缀的备用码形态做 upper，避免误伤含字母的颜文字。
 */
const lookupKey = (input: unknown): string => {
  const code = normalizeLoginCode(input);
  return fallbackPattern().test(code) ? code.toUpperCase() : code;
};

/** 已过期记录保留一段时间，让玩家看到「过期」而不是「无效码」。 */
const RETENTION_MS = 60 * 60 * 1000;

export const createMemoryLoginCodeStore = (): LoginCodeStore => {
  const records = new Map<string, StoredLoginCode>();
  const aliases = new Map<string, string>();
  const attempts = new Map<string, number[]>();

  /**
   * 清理过期很久的记录。
   * 删除别名前先确认它仍指向这条记录：颜文字可能已经被新记录复用，
   * 无条件 delete 会把新记录的别名一起删掉。
   */
  const purge = (now: number): void => {
    for (const [id, record] of records) {
      if (record.expiresAt + RETENTION_MS >= now) continue;
      records.delete(id);

      for (const key of [normalizeLoginCode(record.kaomoji), record.ascii.toUpperCase()]) {
        if (aliases.get(key) === id) aliases.delete(key);
      }
    }
  };

  return {
    insert(record) {
      purge(record.createdAt);
      records.set(record.id, record);
      aliases.set(normalizeLoginCode(record.kaomoji), record.id);
      aliases.set(record.ascii.toUpperCase(), record.id);
    },

    peek(code) {
      const key = lookupKey(code);
      const id = aliases.get(key);
      if (!id) return undefined;
      const record = records.get(id);
      if (!record) {
        aliases.delete(key);
        return undefined;
      }
      return record;
    },

    confirm(id, at) {
      const record = records.get(id);
      if (!record) return { ok: false, reason: 'invalid_code' };
      if (at >= record.expiresAt) return { ok: false, reason: 'expired' };
      if (record.usedAt !== null) return { ok: false, reason: 'used' };
      record.usedAt = at;
      return { ok: true };
    },

    consumeAttempt(gameId, now, windowMs, limit) {
      purge(now);
      if (attempts.size > 10_000) attempts.clear();

      const key = normalizeLoginCode(gameId).toLowerCase();
      const hits = (attempts.get(key) ?? []).filter((at) => now - at < windowMs);

      if (hits.length >= limit) {
        const oldest = hits[0] ?? now;
        attempts.set(key, hits);
        return {
          allowed: false,
          retryAfterMs: Math.max(0, windowMs - (now - oldest)),
          attemptsRemaining: 0,
        };
      }

      hits.push(now);
      attempts.set(key, hits);
      return {
        allowed: true,
        retryAfterMs: 0,
        attemptsRemaining: Math.max(0, limit - hits.length),
      };
    },
  };
};

const defaultStore = createMemoryLoginCodeStore();

/** 唯一的空池/候选不足保护：调用方不要各自再判一遍。 */
const pick = <T>(items: readonly T[]): T => {
  if (items.length === 0) throw new Error('登录码候选池需要至少两个不同候选');
  return items[randomInt(items.length)];
};

const randomKaomojiCode = (): string => {
  const pool = getKaomojiPool();
  const first = pick(pool);

  // 取两个不同的候选，避免出现「(◕‿◕)(◕‿◕)」这种可读性较差的码
  const rest = pool.filter((item) => item !== first);
  return first + pick(rest);
};

const randomFallbackCode = (): string => {
  let suffix = '';
  for (let index = 0; index < 4; index += 1) suffix += pick(FALLBACK_ALPHABET);
  return `${getFallbackPrefix()}-${suffix}`;
};

/**
 * 生成一组登录码。返回的 code / fallback 指向同一条存储记录。
 *
 * 候选池默认很小（24 取 2），并发高时可能撞码，所以插入前检查并重试；
 * 真把组合用完了就抛错，而不是让两个玩家共用一个码。
 */
export const generateLoginCodes = (
  input: GenerateLoginCodeInput,
  options: LoginCodeOptions = {}
): GeneratedLoginCodes => {
  const store = options.store ?? defaultStore;
  const now = options.now?.() ?? Date.now();
  const ttlMs = options.ttlMs ?? LOGIN_CODE_TTL_MS;

  const username = normalizeLoginCode(input.username);
  if (!username) throw new Error('生成登录码需要账号名');

  const gameId = normalizeLoginCode(input.gameId ?? username) || username;
  const expiresAt = now + ttlMs;

  let code = '';
  let fallback = '';

  for (let attempt = 0; attempt < 100; attempt += 1) {
    code = randomKaomojiCode();
    fallback = randomFallbackCode();

    const codeTaken = store.peek(code);
    const fallbackTaken = store.peek(fallback);
    const stillActive = (record: StoredLoginCode | undefined): boolean =>
      Boolean(record && record.expiresAt > now);

    if (!stillActive(codeTaken) && !stillActive(fallbackTaken)) break;
    if (attempt === 99) throw new Error('登录码候选池暂时用尽，请稍后重试');
  }

  store.insert({
    id: randomUUID(),
    username,
    gameId,
    kaomoji: code,
    ascii: fallback,
    createdAt: now,
    expiresAt,
    usedAt: null,
  });

  return { code, fallback, expiresAt };
};

/**
 * 校验登录码。
 *
 * 限流先于查码：同一游戏 ID 在窗口内的每次尝试都计数，防止拿字典刷颜文字。
 * 游戏 ID 不匹配不会作废登录码，方便玩家改对 ID 后继续使用。
 * 账号存在性等外部检查通过 beforeConsume 在作废前执行——任一检查失败都不消费码。
 */
export const verifyLoginCode = async (
  input: VerifyLoginCodeInput,
  options: VerifyLoginCodeOptions = {}
): Promise<VerifyLoginCodeResult> => {
  const store = options.store ?? defaultStore;
  const now = options.now?.() ?? Date.now();
  const maxAttempts = options.maxAttempts ?? LOGIN_CODE_MAX_ATTEMPTS;
  const attemptWindowMs = options.attemptWindowMs ?? LOGIN_CODE_ATTEMPT_WINDOW_MS;
  const gameId = normalizeLoginCode(input.gameId);

  const attempt = store.consumeAttempt(gameId, now, attemptWindowMs, maxAttempts);
  if (!attempt.allowed) {
    return {
      ok: false,
      reason: 'rate_limited',
      retryAfterMs: attempt.retryAfterMs,
      attemptsRemaining: attempt.attemptsRemaining,
    };
  }

  const record = store.peek(input.code);
  if (!record) return { ok: false, reason: 'invalid_code' };
  if (record.gameId.toLowerCase() !== gameId.toLowerCase()) {
    return { ok: false, reason: 'game_id_mismatch', expectedGameId: record.gameId };
  }
  if (now >= record.expiresAt) return { ok: false, reason: 'expired' };
  if (record.usedAt !== null) return { ok: false, reason: 'used' };

  if (options.beforeConsume) {
    const check = await options.beforeConsume(record);
    if (check !== true) return { ok: false, ...check };
  }

  // 原子确认：并发的第二次校验会在这里拿到 used，而不是也成功。
  const consumed = store.confirm(record.id, now);
  if (!consumed.ok) return { ok: false, reason: consumed.reason };

  return { ok: true, username: record.username, gameId: record.gameId };
};