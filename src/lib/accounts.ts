import { randomBytes, randomUUID, scrypt } from 'node:crypto';
import { mkdir, open, readFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { migrateBiographyOwner } from './biographies.ts';
import { timingSafeEqualString } from './timing-safe.ts';
import { isValidUsername } from './username.ts';

export { isValidUsername, USERNAME_PATTERN } from './username.ts';

/**
 * 账号存储层。
 *
 * 和 issues.ts 一样用 JSON 文件 + 串行写队列 + 原子写入，适合单实例 Node 部署。
 * 账号来源只有一条链路：群内 @机器人 发送「注册」→ 插件调 /api/auth/register
 * → 这里生成账号密码 → 插件私信玩家。站点上不开放自助注册。
 *
 * 关于注入：这一层没有 SQL，账号名在进库前就走 normalizeUsername 的白名单
 * （只留字母数字下划线、限长），所以不存在拼接式注入面。以后若要换成
 * SQLite/Postgres，所有查询必须用占位符参数（`?` / `$1`），不要把字符串拼进 SQL。
 */

const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 } as const;
/** 旧格式没有把参数写进哈希，只能用当年的 2^14 参数验证；登录成功后自动升级。 */
const SCRYPT_LEGACY_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const MAX_SCRYPT_N = 1 << 17;

export const ACCOUNT_ROLES = ['admin', 'player'] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export interface Account {
  username: string;
  nickname: string;
  /** 关联的平台身份，目前是 QQ 号，方便群里认人 */
  platform: string;
  platformId: string;
  role: AccountRole;
  /** scrypt 哈希，格式 `scrypt$N$r$p$salt$hash`；旧数据可能是 `scrypt$salt$hash` */
  passwordHash: string;
  /**
   * 会话代际。改密码时递增，旧 cookie 里的 v 对不上就视为未登录。
   * 老数据没有这个字段时按 0 处理。
   */
  sessionVersion?: number;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

interface AccountFile {
  version: 1;
  accounts: Account[];
}

const dataDir = () => process.env.HYDWIND_DATA_DIR ?? path.join(process.cwd(), 'data');
const dataFile = () => path.join(dataDir(), 'accounts.json');

const emptyFile = (): AccountFile => ({ version: 1, accounts: [] });

interface AccountFileCache {
  file: string;
  mtimeMs: number;
  size: number;
  data: AccountFile;
}

/**
 * 只读路径的解析缓存：账号文件每次登录都会重写 lastLoginAt，但读路径
 * （findAccount / listAccounts）在两次写之间会重复出现。用 stat 的
 * mtime + size 判断文件是否变化，命中时直接复用解析结果。
 *
 * 写路径用 `readFileData({ fresh: true })` 绕开缓存，避免把「还没落盘
 * 的修改」暴露给并发读请求，也避免写失败后缓存里留下脏数据。
 */
let cache: AccountFileCache | null = null;

const readFileData = async (options: { fresh?: boolean } = {}): Promise<AccountFile> => {
  const file = dataFile();
  try {
    const info = await stat(file);
    if (
      !options.fresh &&
      cache &&
      cache.file === file &&
      cache.mtimeMs === info.mtimeMs &&
      cache.size === info.size
    ) {
      return cache.data;
    }

    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as AccountFile;
    if (!parsed || !Array.isArray(parsed.accounts)) return emptyFile();
    const data: AccountFile = { version: 1, accounts: parsed.accounts };
    if (!options.fresh) cache = { file, mtimeMs: info.mtimeMs, size: info.size, data };
    return data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      if (!options.fresh) cache = null;
      return emptyFile();
    }
    throw error;
  }
};

const writeFileData = async (data: AccountFile): Promise<void> => {
  await mkdir(dataDir(), { recursive: true, mode: 0o700 });
  const file = dataFile();
  const tmp = `${file}.${randomUUID()}.tmp`;
  // 账号文件里有 scrypt 哈希和 QQ 号，不能沿用 umask 给的 0644。
  const handle = await open(tmp, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmp, file);
  // 目录 fsync 保证 rename 在掉电后仍然可见；部分文件系统不支持，失败只忽略。
  try {
    const directory = await open(dataDir(), 'r');
    await directory.sync();
    await directory.close();
  } catch {
    /* best effort */
  }
  // 下一次读会重新 stat；不在写成功后把缓存直接指向 data，避免调用方
  // 在写之后继续修改同一个对象时缓存和磁盘悄悄分叉。
  cache = null;
};

/** 同一个进程内的串行队列，避免并发写坏 JSON。 */
let queue: Promise<unknown> = Promise.resolve();

const serialize = <T>(task: () => Promise<T>): Promise<T> => {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
};

/**
 * 异步 scrypt：哈希在 libuv 线程池里跑，不占事件循环。
 *
 * 登录是公开接口，sync 版本在并发登录时会把整个 Node 进程卡住——
 * 攻击者用几十个请求就能让静态资源、SSR 页面和插件校验一起排队。
 * `serialize` 只用来串行化文件写，不再包住 CPU 计算。
 */
const scryptAsync = (
  password: string,
  salt: string,
  keylen: number,
  options: Readonly<{ N: number; r: number; p: number; maxmem: number }>
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });

const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scryptAsync(password, salt, 64, SCRYPT_OPTIONS)).toString('hex');
  // 把参数写进哈希，将来调高 N 时旧密码仍然能验证和自动升级。
  return `scrypt$${SCRYPT_OPTIONS.N}$${SCRYPT_OPTIONS.r}$${SCRYPT_OPTIONS.p}$${salt}$${hash}`;
};

interface ParsedHash {
  salt: string;
  hash: string;
  options: { N: number; r: number; p: number; maxmem: number };
}

const parseHash = (stored: string): ParsedHash | null => {
  const parts = stored.split('$');
  if (parts[0] !== 'scrypt') return null;

  if (parts.length === 6) {
    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
    if (n < 2 || n > MAX_SCRYPT_N || (n & (n - 1)) !== 0) return null;
    if (r < 1 || r > 32 || p < 1 || p > 16) return null;
    if (!parts[4] || !parts[5]) return null;
    return {
      salt: parts[4],
      hash: parts[5],
      options: { N: n, r, p, maxmem: 128 * 1024 * 1024 },
    };
  }

  // 旧格式 scrypt$salt$hash；参数固定为当年写入时的值。
  if (parts.length === 3 && parts[1] && parts[2]) {
    return {
      salt: parts[1],
      hash: parts[2],
      options: SCRYPT_LEGACY_OPTIONS,
    };
  }
  return null;
};

const verifyHash = async (password: string, stored: string): Promise<boolean> => {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  const expected = Buffer.from(parsed.hash, 'hex');
  if (expected.length !== 64) return false;
  const actual = await scryptAsync(password, parsed.salt, expected.length, parsed.options);
  return timingSafeEqualString(actual.toString('hex'), parsed.hash);
};

const needsRehash = (stored: string): boolean => {
  const parsed = parseHash(stored);
  return parsed === null || parsed.options.N < SCRYPT_OPTIONS.N;
};

/**
 * 账号不存在时也跑一次 scrypt，让「没这个号」和「密码错」的耗时接近，
 * 免得有人靠响应时间把站内账号一个个试出来。
 */
let dummyHash: Promise<string> | null = null;
const getDummyHash = (): Promise<string> =>
  (dummyHash ??= hashPassword(randomBytes(16).toString('hex')));

/** 密码上限：scrypt 不拒绝长输入，但没必要为一个 10KB 的「密码」耗 CPU。 */
const MAX_PASSWORD_LENGTH = 200;

/** 去掉容易混淆的 0/O/1/l/I，密码留给玩家手抄。 */
const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * 拒绝采样，避免 `byte % 55` 的取模偏置（256 不是 55 的整数倍）。
 * 10 位密码的熵从约 57.4 bit 提到约 57.6 bit；真正的收益是没有偏好的字符。
 */
export const generatePassword = (length = 10): string => {
  const threshold = 256 - (256 % PASSWORD_ALPHABET.length);
  let password = '';
  while (password.length < length) {
    for (const byte of randomBytes(length - password.length)) {
      if (byte >= threshold) continue;
      password += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length];
      if (password.length === length) break;
    }
  }
  return password;
};

/** 游戏 ID 直接当账号名，只保留字母数字下划线，避免奇怪字符进 JSON 和 URL。 */
export const normalizeUsername = (input: unknown): string => {
  if (typeof input !== 'string') return '';
  return input
    .trim()
    .replace(/\s+/g, '')
    .replace(/[^A-Za-z0-9_]/g, '')
    .slice(0, 16);
};


const normalizePlatform = (input: unknown): string => {
  if (typeof input !== 'string') return 'qq';
  const value = input.trim().toLowerCase();
  return value || 'qq';
};

const normalizePlatformId = (input: unknown): string => {
  if (typeof input === 'string') return input.trim().slice(0, 64);
  if (typeof input === 'number') return String(input);
  return '';
};

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; message: string };

export interface RegisterInput {
  /** 游戏 ID，同时作为登录账号 */
  username: unknown;
  /** QQ 号等平台身份，必填，用来做唯一性判断 */
  platformId: unknown;
  platform?: unknown;
  nickname?: unknown;
  /** 不传就自动生成 */
  password?: unknown;
  role?: unknown;
}

export interface RegisteredAccount {
  username: string;
  password: string;
  role: AccountRole;
  created: boolean;
}

/**
 * 注册（或找回）一个账号。
 *
 * 同一个平台身份重复注册时直接重置密码并回给插件，避免玩家换个昵称就注册出一堆账号。
 */
export const registerAccount = (input: RegisterInput): Promise<ValidationResult<RegisteredAccount>> =>
  serialize(async () => {
    const username = normalizeUsername(input.username);
    const platform = normalizePlatform(input.platform);
    const platformId = normalizePlatformId(input.platformId);
    const nickname = typeof input.nickname === 'string' ? input.nickname.trim().slice(0, 32) : '';
    const role: AccountRole = (ACCOUNT_ROLES as readonly string[]).includes(String(input.role))
      ? (input.role as AccountRole)
      : 'player';
    const providedPassword =
      typeof input.password === 'string' &&
      input.password.length >= 10 &&
      input.password.length <= MAX_PASSWORD_LENGTH
        ? input.password
        : '';

    if (!platformId) return { ok: false, message: '缺少平台身份（QQ 号）' };
    if (!isValidUsername(username)) {
      return { ok: false, message: '账号名需要 3-16 位，只能包含字母、数字和下划线' };
    }

    const data = await readFileData({ fresh: true });
    const now = new Date().toISOString();
    const password = providedPassword || generatePassword();

    const byPlatform = data.accounts.find(
      (account) => account.platform === platform && account.platformId === platformId
    );

    if (byPlatform) {
      // 老账号：账号名以这次提供的游戏 ID 为准，方便玩家换 ID 后仍用同一个 QQ 登录
      const clash = data.accounts.find(
        (account) => account !== byPlatform && account.username.toLowerCase() === username.toLowerCase()
      );
      if (clash) return { ok: false, message: `账号名 ${username} 已被其他玩家占用` };

      const previousUsername = byPlatform.username;
      byPlatform.username = username;
      if (nickname) byPlatform.nickname = nickname;
      byPlatform.passwordHash = await hashPassword(password);
      // 机器人重置密码后，旧会话必须立刻失效；否则拿到过旧密码的人
      // 还能用 30 天有效的 cookie 继续登录。
      byPlatform.sessionVersion = (byPlatform.sessionVersion ?? 0) + 1;
      byPlatform.updatedAt = now;
      await writeFileData(data);

      // 账号名就是传记键：改名后把旧记录和评论作者信息迁到新名字。
      // 迁移失败不该阻止玩家重新注册，脏数据留待下次登录补建时处理。
      if (previousUsername.toLowerCase() !== username.toLowerCase()) {
        await migrateBiographyOwner(previousUsername, username).catch((error) => {
          console.error('[accounts] 迁移传记键失败', error);
        });
      }

      return { ok: true, value: { username, password, role: byPlatform.role, created: false } };
    }

    const byName = data.accounts.find((account) => account.username.toLowerCase() === username.toLowerCase());
    if (byName) return { ok: false, message: `账号名 ${username} 已被占用` };

    data.accounts.push({
      username,
      nickname: nickname || username,
      platform,
      platformId,
      role,
      passwordHash: await hashPassword(password),
      sessionVersion: 0,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
    });
    await writeFileData(data);
    return { ok: true, value: { username, password, role, created: true } };
  });

/**
 * 校验账号密码。
 *
 * scrypt 在串行队列之外异步执行：并发登录只排队写文件，不排队算哈希。
 * 账号不存在或密码错误时也跑一次假哈希，保持耗时接近，避免账号枚举。
 */
export const verifyLogin = async (username: string, password: string): Promise<Account | null> => {
  const data = await readFileData();
  const name = normalizeUsername(username).toLowerCase();
  const account = name
    ? data.accounts.find((item) => item.username.toLowerCase() === name)
    : undefined;

  // 空密码和超长密码不交给 scrypt，但仍然比对一次哈希，耗时和正常失败保持一致
  const candidate =
    password.length > 0 && password.length <= MAX_PASSWORD_LENGTH
      ? password
      : randomBytes(12).toString('hex');
  const stored = account?.passwordHash ?? (await getDummyHash());
  const matched = await verifyHash(candidate, stored);

  if (!account || !matched) return null;
  if (password.length === 0 || password.length > MAX_PASSWORD_LENGTH) return null;

  // 先记住校验通过时的哈希：排队等写文件期间如果密码被重置，这次登录作废。
  const verifiedHash = account.passwordHash;
  // 旧格式（没有参数段）在登录成功时升级到当前 scrypt 参数；失败不影响登录。
  const upgradedHash = needsRehash(verifiedHash)
    ? await hashPassword(password)
    : null;

  return serialize(async () => {
    const fresh = await readFileData({ fresh: true });
    const live = name
      ? fresh.accounts.find((item) => item.username.toLowerCase() === name)
      : undefined;
    if (!live || live.passwordHash !== verifiedHash) return null;

    if (upgradedHash) live.passwordHash = upgradedHash;
    live.lastLoginAt = new Date().toISOString();
    await writeFileData(fresh);
    return live;
  });
};

export const findAccount = async (username: string): Promise<Account | undefined> => {
  const data = await readFileData();
  return data.accounts.find(
    (item) => item.username.toLowerCase() === normalizeUsername(username).toLowerCase()
  );
};

export const listAccounts = async (): Promise<Omit<Account, 'passwordHash'>[]> => {
  const data = await readFileData();
  return data.accounts
    .map(({ passwordHash: _hash, ...rest }) => rest)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
};

export const setAccountRole = (username: string, role: AccountRole): Promise<boolean> =>
  serialize(async () => {
    const data = await readFileData({ fresh: true });
    const account = data.accounts.find(
      (item) => item.username.toLowerCase() === normalizeUsername(username).toLowerCase()
    );
    if (!account) return false;
    account.role = role;
    account.updatedAt = new Date().toISOString();
    await writeFileData(data);
    return true;
  });

export const publicAccount = (account: Account) => ({
  username: account.username,
  nickname: account.nickname,
  role: account.role,
  createdAt: account.createdAt,
  lastLoginAt: account.lastLoginAt,
});
