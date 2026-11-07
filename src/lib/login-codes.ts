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

/** 24 个候选。刻意不用空格、反引号、&、§，避免 shell / Markdown / 命令解析惹麻烦。 */
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

const FALLBACK_PATTERN = /^HWG-[A-Za-z0-9]{4}$/i;

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
  /** ASCII 备用码，大写 HWG-XXXX */
  ascii: string;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
}

export interface AttemptResult {
  allowed: boolean;
  retryAfterMs: number;
}

/**
 * 可替换的存储接口。所有方法都是同步的，内存实现够用；
 * 以后接数据库时把方法改成 Promise 即可，届时同步修改调用方。
 */
export interface LoginCodeStore {
  insert(record: StoredLoginCode): void;
  /** 按颜文字码或 ASCII 备用码查找；已用、已过期的记录也要能查出来，才能给出准确原因。 */
  find(code: string): StoredLoginCode | undefined;
  markUsed(id: string, at: number): void;
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

export type VerifyLoginCodeResult =
  | { ok: true; username: string; gameId: string }
  | { ok: false; reason: LoginCodeFailureReason; retryAfterMs?: number };

export interface LoginCodeOptions {
  store?: LoginCodeStore;
  now?: () => number;
  ttlMs?: number;
  maxAttempts?: number;
  attemptWindowMs?: number;
}

/** NFC 归一化 + 去首尾空白。内部空白保留，避免把打错的码当成正确码。 */
export const normalizeLoginCode = (input: unknown): string => {
  if (typeof input !== 'string') return '';
  return input.normalize('NFC').trim();
};

const normalizeIdentity = (input: unknown): string => {
  if (typeof input !== 'string') return '';
  return input.normalize('NFC').trim();
};

/**
 * 查询键：ASCII 备用码的大小写不敏感。
 * 只对 HWG-XXXX 形态做 upper，避免误伤含字母的颜文字。
 */
const lookupKey = (input: unknown): string => {
  const code = normalizeLoginCode(input);
  return FALLBACK_PATTERN.test(code) ? code.toUpperCase() : code;
};

/** 已过期记录保留一段时间，让玩家看到「过期」而不是「无效码」。 */
const RETENTION_MS = 60 * 60 * 1000;

export const createMemoryLoginCodeStore = (): LoginCodeStore => {
  const records = new Map<string, StoredLoginCode>();
  const aliases = new Map<string, string>();
  const attempts = new Map<string, number[]>();

  const purge = (now: number): void => {
    for (const [id, record] of records) {
      if (record.expiresAt + RETENTION_MS >= now) continue;
      records.delete(id);
      aliases.delete(normalizeLoginCode(record.kaomoji));
      aliases.delete(record.ascii);
    }
  };

  return {
    insert(record) {
      purge(record.createdAt);
      records.set(record.id, record);
      aliases.set(normalizeLoginCode(record.kaomoji), record.id);
      aliases.set(record.ascii.toUpperCase(), record.id);
    },

    find(code) {
      const id = aliases.get(lookupKey(code));
      if (!id) return undefined;
      const record = records.get(id);
      if (!record) {
        aliases.delete(lookupKey(code));
        return undefined;
      }
      return record;
    },

    markUsed(id, at) {
      const record = records.get(id);
      if (record) record.usedAt = at;
    },

    consumeAttempt(gameId, now, windowMs, limit) {
      purge(now);
      if (attempts.size > 10_000) attempts.clear();

      const key = gameId.normalize('NFC').trim().toLowerCase();
      const hits = (attempts.get(key) ?? []).filter((at) => now - at < windowMs);

      if (hits.length >= limit) {
        const oldest = hits[0] ?? now;
        attempts.set(key, hits);
        return { allowed: false, retryAfterMs: Math.max(0, windowMs - (now - oldest)) };
      }

      hits.push(now);
      attempts.set(key, hits);
      return { allowed: true, retryAfterMs: 0 };
    },
  };
};

const defaultStore = createMemoryLoginCodeStore();

const pick = <T>(items: readonly T[]): T => {
  const item = items[randomInt(items.length)];
  if (item === undefined) throw new Error('登录码候选池为空');
  return item;
};

const randomKaomojiCode = (): string => {
  const firstIndex = randomInt(KAOMOJI_POOL.length);
  const first = KAOMOJI_POOL[firstIndex];
  if (first === undefined) throw new Error('登录码候选池为空');

  // 取两个不同的候选，避免出现「(◕‿◕)(◕‿◕)」这种可读性较差的码
  let secondIndex = randomInt(KAOMOJI_POOL.length - 1);
  if (secondIndex >= firstIndex) secondIndex += 1;
  const second = KAOMOJI_POOL[secondIndex];
  if (second === undefined) throw new Error('登录码候选池为空');

  return first + second;
};

const randomFallbackCode = (): string => {
  let suffix = '';
  for (let index = 0; index < 4; index += 1) suffix += pick(FALLBACK_ALPHABET);
  return `${FALLBACK_PREFIX}-${suffix}`;
};

/**
 * 生成一组登录码。返回的 code / fallback 指向同一条存储记录。
 *
 * 候选池很小（24 取 2），并发高时可能撞码，所以插入前检查并重试；
 * 真把 552 种组合用完了就抛错，而不是让两个玩家共用一个码。
 */
export const generateLoginCodes = (
  input: GenerateLoginCodeInput,
  options: LoginCodeOptions = {}
): GeneratedLoginCodes => {
  const store = options.store ?? defaultStore;
  const now = options.now?.() ?? Date.now();
  const ttlMs = options.ttlMs ?? LOGIN_CODE_TTL_MS;

  const username = normalizeIdentity(input.username);
  if (!username) throw new Error('生成登录码需要账号名');

  const gameId = normalizeIdentity(input.gameId ?? username) || username;
  const expiresAt = now + ttlMs;

  let code = '';
  let fallback = '';

  for (let attempt = 0; attempt < 100; attempt += 1) {
    code = randomKaomojiCode();
    fallback = randomFallbackCode();

    const codeTaken = store.find(code);
    const fallbackTaken = store.find(fallback);
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
 */
export const verifyLoginCode = (
  input: VerifyLoginCodeInput,
  options: LoginCodeOptions = {}
): VerifyLoginCodeResult => {
  const store = options.store ?? defaultStore;
  const now = options.now?.() ?? Date.now();
  const maxAttempts = options.maxAttempts ?? LOGIN_CODE_MAX_ATTEMPTS;
  const attemptWindowMs = options.attemptWindowMs ?? LOGIN_CODE_ATTEMPT_WINDOW_MS;
  const gameId = normalizeIdentity(input.gameId);

  const attempt = store.consumeAttempt(gameId, now, attemptWindowMs, maxAttempts);
  if (!attempt.allowed) {
    return { ok: false, reason: 'rate_limited', retryAfterMs: attempt.retryAfterMs };
  }

  const record = store.find(input.code);
  if (!record) return { ok: false, reason: 'invalid_code' };
  if (record.gameId.toLowerCase() !== gameId.toLowerCase()) {
    return { ok: false, reason: 'game_id_mismatch' };
  }
  if (now >= record.expiresAt) return { ok: false, reason: 'expired' };
  if (record.usedAt !== null) return { ok: false, reason: 'used' };

  store.markUsed(record.id, now);
  return { ok: true, username: record.username, gameId: record.gameId };
};
