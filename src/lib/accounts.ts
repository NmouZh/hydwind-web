import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

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

const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

export const ACCOUNT_ROLES = ['admin', 'player'] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export interface Account {
  username: string;
  nickname: string;
  /** 关联的平台身份，目前是 QQ 号，方便群里认人 */
  platform: string;
  platformId: string;
  role: AccountRole;
  /** scrypt 哈希，格式 scrypt$salt$hash */
  passwordHash: string;
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

let queue: Promise<unknown> = Promise.resolve();

const serialize = <T>(task: () => Promise<T>): Promise<T> => {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
};

const readFileData = async (): Promise<AccountFile> => {
  try {
    const raw = await readFile(dataFile(), 'utf8');
    const parsed = JSON.parse(raw) as AccountFile;
    if (!parsed || !Array.isArray(parsed.accounts)) return emptyFile();
    return { version: 1, accounts: parsed.accounts };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyFile();
    throw error;
  }
};

const writeFileData = async (data: AccountFile): Promise<void> => {
  await mkdir(dataDir(), { recursive: true });
  const file = dataFile();
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
};

const hashPassword = (password: string): string => {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64, SCRYPT_OPTIONS).toString('hex');
  return `scrypt$${salt}$${hash}`;
};

const verifyHash = (password: string, stored: string): boolean => {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  if (expected.length !== 64) return false;
  const actual = scryptSync(password, salt, expected.length, SCRYPT_OPTIONS);
  return timingSafeEqual(expected, actual);
};

/**
 * 账号不存在时也跑一次 scrypt，让「没这个号」和「密码错」的耗时接近，
 * 免得有人靠响应时间把站内账号一个个试出来。
 */
let dummyHash: string | null = null;
const getDummyHash = (): string => (dummyHash ??= hashPassword(randomBytes(16).toString('hex')));

/** 密码上限：scrypt 不拒绝长输入，但没必要为一个 10KB 的「密码」耗 CPU。 */
const MAX_PASSWORD_LENGTH = 200;

/** 去掉容易混淆的 0/O/1/l/I，密码留给玩家手抄。 */
const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const generatePassword = (length = 10): string =>
  Array.from(randomBytes(length), (byte) => PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length]).join('');

/** 游戏 ID 直接当账号名，只保留字母数字下划线，避免奇怪字符进 JSON 和 URL。 */
export const normalizeUsername = (input: unknown): string => {
  if (typeof input !== 'string') return '';
  return input
    .trim()
    .replace(/\s+/g, '')
    .replace(/[^A-Za-z0-9_]/g, '')
    .slice(0, 16);
};

export const isValidUsername = (username: string): boolean => /^[A-Za-z0-9_]{3,16}$/.test(username);

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
      input.password.length >= 6 &&
      input.password.length <= MAX_PASSWORD_LENGTH
        ? input.password
        : '';

    if (!platformId) return { ok: false, message: '缺少平台身份（QQ 号）' };
    if (!isValidUsername(username)) {
      return { ok: false, message: '账号名需要 3-16 位，只能包含字母、数字和下划线' };
    }

    const data = await readFileData();
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

      byPlatform.username = username;
      if (nickname) byPlatform.nickname = nickname;
      byPlatform.passwordHash = hashPassword(password);
      byPlatform.updatedAt = now;
      await writeFileData(data);
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
      passwordHash: hashPassword(password),
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
    });
    await writeFileData(data);
    return { ok: true, value: { username, password, role, created: true } };
  });

export const verifyLogin = (username: string, password: string): Promise<Account | null> =>
  serialize(async () => {
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
    const matched = verifyHash(candidate, account?.passwordHash ?? getDummyHash());

    if (!account || !matched) return null;
    if (password.length === 0 || password.length > MAX_PASSWORD_LENGTH) return null;

    account.lastLoginAt = new Date().toISOString();
    await writeFileData(data);
    return account;
  });

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
    const data = await readFileData();
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
