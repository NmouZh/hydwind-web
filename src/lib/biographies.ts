import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseMentions } from './biography-text.ts';
import { consumeRateLimit } from './rate-limit.ts';

/**
 * 人物传记存储层。
 *
 * 和 issues.ts / accounts.ts 一样：单 JSON 文件 + 进程内串行写队列 + 原子替换。
 *
 * 新的领域模型按账号游戏 ID（`account.username`）存传记，一个玩家一篇；
 * 评论直接嵌在传记记录里。`gameId` 的比较一律忽略大小写。
 *
 * 旧版本按静态人物 slug（`personId`）存传记，另有 `refs/author/authorUsername`
 * 字段。页面和 API 迁移到新模型之前（B2–B6），文件里可能同时存在两种形状；
 * 新函数只认带 `gameId` 的记录，旧函数只认带 `personId` 的记录，互不覆盖。
 * 当前线上 `biographies.json` 不存在，所以不需要做形状迁移。
 */

export const MAX_BIO_BODY = 4000;
/** 新模型允许空正文；保留旧导出名给尚未迁移的页面使用。 */
export const MIN_BIO_BODY = 0;
export const MAX_BIO_REFS = 12;

export const MIN_BIO_TITLE = 2;
export const MAX_BIO_TITLE = 40;
export const MIN_COMMENT_BODY = 1;
export const MAX_COMMENT_BODY = 500;
/** 每个账号在窗口内最多发这么多条评论。 */
export const COMMENT_RATE_LIMIT = 5;
export const COMMENT_RATE_WINDOW_MS = 10 * 60_000;

const MAX_NAME = 32;

export interface Comment {
  id: string;
  /** 发表评论的账号名，用来判断「谁能删」 */
  authorUsername: string;
  /** 发表评论时的游戏 ID，展示与后续迁移用 */
  authorGameId: string;
  body: string;
  createdAt: string;
}

export interface Biography {
  /** 账号 username，也就是游戏 ID；比较时忽略大小写 */
  gameId: string;
  mainTitle: string;
  /** Markdown 正文，允许为空 */
  body: string;
  comments: Comment[];
  createdAt: string;
  updatedAt: string;
}

/** 旧模型记录，仅在页面/API 迁移完成前保留。 */
interface LegacyBiography {
  personId: string;
  body: string;
  refs: string[];
  author: string;
  authorUsername: string;
  createdAt: string;
  updatedAt: string;
}

type StoredBiography = LegacyBiography | Biography;

interface BiographyFile {
  version: 1;
  biographies: StoredBiography[];
}

const dataDir = () => process.env.HYDWIND_DATA_DIR ?? path.join(process.cwd(), 'data');
const dataFile = () => path.join(dataDir(), 'biographies.json');

const emptyFile = (): BiographyFile => ({ version: 1, biographies: [] });

/** 同一个进程内的串行队列，避免并发写坏 JSON。 */
let queue: Promise<unknown> = Promise.resolve();

const serialize = <T>(task: () => Promise<T>): Promise<T> => {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
};

const readFileData = async (): Promise<BiographyFile> => {
  try {
    const raw = await readFile(dataFile(), 'utf8');
    const parsed = JSON.parse(raw) as BiographyFile;
    if (!parsed || !Array.isArray(parsed.biographies)) return emptyFile();
    return { version: 1, biographies: parsed.biographies };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyFile();
    throw error;
  }
};

const writeFileData = async (data: BiographyFile): Promise<void> => {
  await mkdir(dataDir(), { recursive: true });
  const file = dataFile();
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
};

const clamp = (value: unknown, max: number): string => {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
};

/** 「字」按 Unicode 码点算，避免 emoji 被算成两个字。 */
const textLength = (value: string): number => [...value].length;

const isGameBiography = (entry: StoredBiography): entry is Biography =>
  typeof entry === 'object' &&
  entry !== null &&
  typeof (entry as Biography).gameId === 'string' &&
  typeof (entry as Biography).mainTitle === 'string';

const isLegacyBiography = (entry: StoredBiography): entry is LegacyBiography =>
  typeof entry === 'object' &&
  entry !== null &&
  typeof (entry as LegacyBiography).personId === 'string';

const gameBiographies = (data: BiographyFile): Biography[] =>
  data.biographies.filter(isGameBiography);

const commentsOf = (biography: Biography): Comment[] =>
  Array.isArray(biography.comments) ? biography.comments.filter(isComment) : [];

const isComment = (value: unknown): value is Comment =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Comment).id === 'string' &&
  typeof (value as Comment).body === 'string' &&
  typeof (value as Comment).createdAt === 'string';

const findGame = (data: BiographyFile, gameId: string): Biography | undefined => {
  const target = gameId.trim().toLowerCase();
  if (!target) return undefined;
  return gameBiographies(data).find((entry) => entry.gameId.toLowerCase() === target);
};

export { parseMentions };

/* ------------------------------------------------------------------ *
 * 新领域模型
 * ------------------------------------------------------------------ */

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; message: string };

export type DomainFailureReason = 'invalid' | 'not_found' | 'forbidden' | 'rate_limited';

export type DomainResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason: DomainFailureReason;
      message: string;
      /** 仅 rate_limited 有值 */
      retryAfterMs?: number;
    };

export interface EditAccount {
  username: string;
  role: string;
}

export interface CommentAuthor {
  username: string;
  /** 账号 username 就是游戏 ID；留这个字段是为了兼容调用方显式传值 */
  gameId?: string;
}

export const defaultMainTitle = (gameId: string): string => `${gameId}的人物传记`;

export const validateMainTitle = (input: unknown, gameId: string): ValidationResult<string> => {
  const fallback = defaultMainTitle(gameId);
  if (input === undefined || input === null) return { ok: true, value: fallback };
  if (typeof input !== 'string') return { ok: false, message: '主标题需要是文本' };

  const value = input.trim();
  if (!value) return { ok: true, value: fallback };

  const length = textLength(value);
  if (length < MIN_BIO_TITLE) {
    return { ok: false, message: `主标题至少 ${MIN_BIO_TITLE} 个字` };
  }
  if (length > MAX_BIO_TITLE) {
    return { ok: false, message: `主标题最多 ${MAX_BIO_TITLE} 个字` };
  }
  return { ok: true, value };
};

export const validateBiographyBody = (input: unknown): ValidationResult<string> => {
  if (typeof input !== 'string') return { ok: false, message: '正文需要是文本' };
  const value = input.trim();
  if (textLength(value) > MAX_BIO_BODY) {
    return { ok: false, message: `正文最多 ${MAX_BIO_BODY} 个字` };
  }
  return { ok: true, value };
};

export const validateCommentBody = (input: unknown): ValidationResult<string> => {
  if (typeof input !== 'string') return { ok: false, message: '评论需要是文本' };
  const value = input.trim();
  const length = textLength(value);
  if (length < MIN_COMMENT_BODY) return { ok: false, message: '评论不能为空' };
  if (length > MAX_COMMENT_BODY) {
    return { ok: false, message: `评论最多 ${MAX_COMMENT_BODY} 个字` };
  }
  return { ok: true, value };
};

export interface BiographyInput {
  mainTitle?: unknown;
  body?: unknown;
}

export interface PreparedBiographyContent {
  mainTitle: string;
  body: string;
}

export const validateBiographyInput = (
  input: BiographyInput,
  gameId: string
): ValidationResult<PreparedBiographyContent> => {
  const mainTitle = validateMainTitle(input.mainTitle, gameId);
  if (!mainTitle.ok) return mainTitle;
  const body = validateBiographyBody(input.body);
  if (!body.ok) return body;
  return { ok: true, value: { mainTitle: mainTitle.value, body: body.value } };
};

/** 按账号 username 建默认传记；已有则原样返回（幂等）。 */
export const ensureBiographyForAccount = (account: { username: string }): Promise<Biography> =>
  serialize(async () => {
    const gameId = typeof account?.username === 'string' ? account.username.trim() : '';
    if (!gameId) throw new Error('账号 username 不能为空');

    const data = await readFileData();
    const existing = findGame(data, gameId);
    if (existing) {
      existing.comments = commentsOf(existing);
      return existing;
    }

    const now = new Date().toISOString();
    const created: Biography = {
      gameId,
      mainTitle: defaultMainTitle(gameId),
      body: '',
      comments: [],
      createdAt: now,
      updatedAt: now,
    };
    data.biographies.push(created);
    await writeFileData(data);
    return created;
  });

export const findBiographyByGameId = async (gameId: string): Promise<Biography | null> => {
  const data = await readFileData();
  const biography = findGame(data, gameId);
  if (biography) biography.comments = commentsOf(biography);
  return biography ?? null;
};

export const listGameBiographies = async (): Promise<Biography[]> => {
  const data = await readFileData();
  return gameBiographies(data)
    .map((biography) => ({ ...biography, comments: commentsOf(biography) }))
    .sort((a, b) => a.gameId.localeCompare(b.gameId));
};

/**
 * 保存标题与正文。传记不存在时顺手建一份，调用方负责校验编辑权限。
 * 未传的字段保持原值（新建时则用默认值），空标题回退默认标题。
 */
export const updateBiography = (
  gameId: string,
  input: BiographyInput
): Promise<DomainResult<Biography>> =>
  serialize(async () => {
    const key = typeof gameId === 'string' ? gameId.trim() : '';
    if (!key) return { ok: false, reason: 'invalid', message: '缺少游戏 ID' };

    const data = await readFileData();
    const existing = findGame(data, key);
    const now = new Date().toISOString();

    const titleInput = input.mainTitle === undefined ? existing?.mainTitle ?? '' : input.mainTitle;
    const bodyInput = input.body === undefined ? existing?.body ?? '' : input.body;

    const title = validateMainTitle(titleInput, existing?.gameId ?? key);
    if (!title.ok) return { ok: false, reason: 'invalid', message: title.message };
    const body = validateBiographyBody(bodyInput);
    if (!body.ok) return { ok: false, reason: 'invalid', message: body.message };

    if (existing) {
      existing.mainTitle = title.value;
      existing.body = body.value;
      existing.updatedAt = now;
      await writeFileData(data);
      existing.comments = commentsOf(existing);
      return { ok: true, value: existing };
    }

    const created: Biography = {
      gameId: key,
      mainTitle: title.value,
      body: body.value,
      comments: [],
      createdAt: now,
      updatedAt: now,
    };
    data.biographies.push(created);
    await writeFileData(data);
    return { ok: true, value: created };
  });

/** 本人或管理员可以编辑。传记是否存在不影响判断，权限只看账号与目标游戏 ID。 */
export function canEditBiography(account: EditAccount | null, gameId: string): boolean;
/** @deprecated 旧 API 路由的签名；新代码请用 `(account, gameId)`。 */
export function canEditBiography(biography: LegacyBiography | null, session: EditAccount | null): boolean;
export function canEditBiography(
  subject: EditAccount | LegacyBiography | null,
  context: string | EditAccount | null
): boolean {
  if (typeof context === 'string') {
    const account = subject as EditAccount | null;
    if (!account) return false;
    if (account.role === 'admin') return true;
    return account.username.toLowerCase() === context.trim().toLowerCase();
  }

  // 旧签名：仍然修复「传记不存在时任何登录用户都能写」的漏洞。
  const biography = subject as LegacyBiography | null;
  const session = context;
  if (!session) return false;
  if (session.role === 'admin') return true;
  if (!biography) return false;
  return biography.authorUsername.toLowerCase() === session.username.toLowerCase();
}

/** 评论作者本人或管理员可以删除。 */
export const canDeleteComment = (comment: Comment, account: EditAccount | null): boolean => {
  if (!account) return false;
  if (account.role === 'admin') return true;
  return comment.authorUsername.toLowerCase() === account.username.toLowerCase();
};

export const listComments = async (gameId: string): Promise<Comment[]> => {
  const data = await readFileData();
  const biography = findGame(data, gameId);
  if (!biography) return [];
  return commentsOf(biography).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
};

export const addComment = (
  gameId: string,
  author: CommentAuthor,
  body: unknown
): Promise<DomainResult<Comment>> =>
  serialize(async () => {
    const key = typeof gameId === 'string' ? gameId.trim() : '';
    const username = typeof author?.username === 'string' ? author.username.trim() : '';
    if (!key || !username) {
      return { ok: false, reason: 'invalid', message: '缺少游戏 ID 或作者账号' };
    }

    const validated = validateCommentBody(body);
    if (!validated.ok) return { ok: false, reason: 'invalid', message: validated.message };

    const data = await readFileData();
    const biography = findGame(data, key);
    if (!biography) return { ok: false, reason: 'not_found', message: '没有找到这份传记' };

    const limit = consumeRateLimit(
      `biography-comment:${username.toLowerCase()}`,
      COMMENT_RATE_LIMIT,
      COMMENT_RATE_WINDOW_MS
    );
    if (!limit.ok) {
      return {
        ok: false,
        reason: 'rate_limited',
        message: '评论太频繁啦，过几分钟再试',
        retryAfterMs: limit.retryAfterMs,
      };
    }

    const now = new Date().toISOString();
    const comment: Comment = {
      id: randomUUID(),
      authorUsername: username,
      authorGameId: (author.gameId ?? username).trim() || username,
      body: validated.value,
      createdAt: now,
    };
    biography.comments = [...commentsOf(biography), comment];
    await writeFileData(data);
    return { ok: true, value: comment };
  });

export const deleteComment = (
  gameId: string,
  commentId: string,
  actor: EditAccount | null
): Promise<DomainResult<Comment>> =>
  serialize(async () => {
    if (!actor) return { ok: false, reason: 'forbidden', message: '先登录再删除评论' };

    const data = await readFileData();
    const biography = findGame(data, gameId);
    if (!biography) return { ok: false, reason: 'not_found', message: '没有找到这份传记' };

    const comments = commentsOf(biography);
    const index = comments.findIndex((comment) => comment.id === commentId);
    if (index < 0) return { ok: false, reason: 'not_found', message: '没有找到这条评论' };

    const comment = comments[index];
    if (!canDeleteComment(comment, actor)) {
      return { ok: false, reason: 'forbidden', message: '只能删除自己的评论' };
    }

    comments.splice(index, 1);
    biography.comments = comments;
    await writeFileData(data);
    return { ok: true, value: comment };
  });

/* ------------------------------------------------------------------ *
 * slug 解析与账号改名迁移
 * ------------------------------------------------------------------ */

export interface StaticPersonRef {
  id: string;
  gameId: string;
}

export interface SlugLookup {
  /** 静态内容集合里的人物；调用方负责从 astro:content 取。 */
  staticPeople: ReadonlyArray<StaticPersonRef>;
  /** 按账号名查找；调用方通常传 `findAccount`。 */
  findAccount: (username: string) => Promise<{ username: string } | undefined>;
}

export interface ResolvedPerson {
  /** 规范化的 URL slug */
  slug: string;
  gameId: string;
  source: 'static' | 'account';
  /** 静态人物才有 */
  personId?: string;
}

/**
 * slug → 人物。静态人物 entry id 优先（保留 `/people/nz-173/`），
 * 其次匹配账号 username（忽略大小写）。都没有返回 null。
 */
export const resolvePersonBySlug = async (
  slug: string,
  lookup: SlugLookup
): Promise<ResolvedPerson | null> => {
  const value = typeof slug === 'string' ? slug.trim() : '';
  if (!value) return null;

  const person = lookup.staticPeople.find((entry) => entry.id === value);
  if (person) {
    return { slug: person.id, gameId: person.gameId, source: 'static', personId: person.id };
  }

  const account = await lookup.findAccount(value);
  if (!account?.username) return null;
  return { slug: account.username.toLowerCase(), gameId: account.username, source: 'account' };
};

export interface MigrationResult {
  /** 传记键是否真的改了名 */
  migrated: boolean;
  /** 同步了多少条评论的 authorUsername/authorGameId */
  commentsUpdated: number;
}

/**
 * 账号 username 变更后迁移传记键，并把所有评论里的旧作者信息改成新用户名。
 * 目标键已有别的传记时不动传记（避免重复键），但仍然同步评论。
 */
export const migrateBiographyOwner = (
  oldUsername: string,
  newUsername: string
): Promise<MigrationResult> =>
  serialize(async () => {
    const oldName = typeof oldUsername === 'string' ? oldUsername.trim() : '';
    const newName = typeof newUsername === 'string' ? newUsername.trim() : '';
    if (!oldName || !newName) return { migrated: false, commentsUpdated: 0 };

    const data = await readFileData();
    const now = new Date().toISOString();
    const oldKey = oldName.toLowerCase();
    let migrated = false;

    if (oldKey !== newName.toLowerCase()) {
      const source = findGame(data, oldName);
      const target = findGame(data, newName);
      if (source && (!target || target === source)) {
        source.gameId = newName;
        source.updatedAt = now;
        migrated = true;
      }
    }

    let commentsUpdated = 0;
    for (const biography of gameBiographies(data)) {
      const comments = commentsOf(biography);
      let changed = false;
      for (const comment of comments) {
        let touched = false;
        if (comment.authorUsername.toLowerCase() === oldKey) {
          comment.authorUsername = newName;
          touched = true;
        }
        if (comment.authorGameId.toLowerCase() === oldKey) {
          comment.authorGameId = newName;
          touched = true;
        }
        if (touched) {
          changed = true;
          commentsUpdated += 1;
        }
      }
      if (changed) biography.comments = comments;
    }

    if (migrated || commentsUpdated > 0) await writeFileData(data);
    return { migrated, commentsUpdated };
  });

/* ------------------------------------------------------------------ *
 * 旧模型（页面 / API 迁移完成后删除）
 * ------------------------------------------------------------------ */

export interface MentionResolver {
  /** 游戏 ID → 人物 id */
  byGameId: Map<string, string>;
}

export interface NewBiographyInput {
  personId: unknown;
  body: unknown;
  author: unknown;
  authorUsername: unknown;
}

export interface PreparedBiography {
  personId: string;
  body: string;
  refs: string[];
  author: string;
  authorUsername: string;
}

/**
 * @deprecated 旧模型提交校验。新代码用 `validateMainTitle` / `validateBiographyBody`。
 */
export const validateBiography = (
  input: NewBiographyInput,
  resolver: MentionResolver,
  selfId: string
): ValidationResult<PreparedBiography> => {
  const personId = clamp(input.personId, 64);
  const body = clamp(input.body, MAX_BIO_BODY);
  const author = clamp(input.author, MAX_NAME) || '匿名玩家';
  const authorUsername = clamp(input.authorUsername, MAX_NAME);

  if (!personId) return { ok: false, message: '缺少人物 id' };
  if (body.length < MIN_BIO_BODY) {
    return { ok: false, message: `正文至少 ${MIN_BIO_BODY} 个字，写详细一点再保存` };
  }

  const refs: string[] = [];
  for (const gameId of parseMentions(body)) {
    const personIdOfMention = resolver.byGameId.get(gameId);
    if (!personIdOfMention) {
      return { ok: false, message: `没有找到叫「${gameId}」的玩家，引用前先确认游戏 ID` };
    }
    if (personIdOfMention === selfId) continue;
    if (!refs.includes(personIdOfMention)) refs.push(personIdOfMention);
  }

  if (refs.length > MAX_BIO_REFS) {
    return { ok: false, message: `一篇传记最多引用 ${MAX_BIO_REFS} 位玩家` };
  }

  return { ok: true, value: { personId, body, refs, author, authorUsername } };
};

/** @deprecated 旧模型记录列表；新代码用 `listGameBiographies`。 */
export const listBiographies = async (): Promise<LegacyBiography[]> => {
  const data = await readFileData();
  return data.biographies.filter(isLegacyBiography);
};

/** @deprecated 按静态人物 slug 读取；新代码用 `findBiographyByGameId`。 */
export const getBiography = async (personId: string): Promise<LegacyBiography | null> => {
  const data = await readFileData();
  return data.biographies.find(
    (entry): entry is LegacyBiography => isLegacyBiography(entry) && entry.personId === personId
  ) ?? null;
};

/** @deprecated 旧模型保存；新代码用 `updateBiography`。 */
export const saveBiography = (input: PreparedBiography): Promise<LegacyBiography> =>
  serialize(async () => {
    const data = await readFileData();
    const now = new Date().toISOString();
    const index = data.biographies.findIndex(
      (entry) => isLegacyBiography(entry) && entry.personId === input.personId
    );

    if (index >= 0) {
      const previous = data.biographies[index] as LegacyBiography;
      const next: LegacyBiography = {
        ...previous,
        body: input.body,
        refs: input.refs,
        // 作者归属只在创建时确定：管理员编辑不能把别人的传记“过户”给自己
        updatedAt: now,
      };
      data.biographies[index] = next;
      await writeFileData(data);
      return next;
    }

    const created: LegacyBiography = {
      personId: input.personId,
      body: input.body,
      refs: input.refs,
      author: input.author,
      authorUsername: input.authorUsername,
      createdAt: now,
      updatedAt: now,
    };
    data.biographies.push(created);
    await writeFileData(data);
    return created;
  });