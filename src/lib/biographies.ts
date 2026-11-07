import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { consumeRateLimit } from './rate-limit.ts';
import { canDeleteCommentForAuthor } from './person-page.ts';
import {
  MAX_BIO_BODY,
  MAX_BIO_TITLE,
  MIN_BIO_TITLE,
  MAX_COMMENT_BODY,
  MIN_COMMENT_BODY,
} from './biography-limits.ts';

/**
 * 人物传记存储层。
 *
 * 和 issues.ts / accounts.ts 一样：单 JSON 文件 + 进程内串行写队列 + 原子替换。
 *
 * 按账号游戏 ID（`account.username`）存传记，一个玩家一篇；
 * 评论直接嵌在传记记录里。`gameId` 的比较一律忽略大小写。
 * 当前线上 `biographies.json` 不存在，所以不需要做形状迁移。
 */

// 长度限制放在纯模块里，浏览器端预校验与服务端共用同一组数字。
export {
  MAX_BIO_BODY,
  MAX_BIO_TITLE,
  MIN_BIO_TITLE,
  MAX_COMMENT_BODY,
  MIN_COMMENT_BODY,
} from './biography-limits.ts';

/** 每个账号在窗口内最多发这么多条评论。 */
export const COMMENT_RATE_LIMIT = 5;
export const COMMENT_RATE_WINDOW_MS = 10 * 60_000;

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

interface BiographyFile {
  version: 1;
  biographies: Biography[];
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
    return { version: 1, biographies: parsed.biographies.filter(isGameBiography) };
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

/** 「字」按 Unicode 码点算，避免 emoji 被算成两个字。 */
const textLength = (value: string): number => [...value].length;

const isGameBiography = (entry: unknown): entry is Biography =>
  typeof entry === 'object' &&
  entry !== null &&
  typeof (entry as Biography).gameId === 'string' &&
  typeof (entry as Biography).mainTitle === 'string';

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
  return data.biographies.find((entry) => entry.gameId.toLowerCase() === target);
};

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
  /** 账号 username，也就是评论作者的游戏 ID。 */
  username: string;
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
  // 保存时保留作者写的首尾空行；trim 只用来判断空正文和计算长度。
  if (textLength(input.trim()) > MAX_BIO_BODY) {
    return { ok: false, message: `正文最多 ${MAX_BIO_BODY} 个字` };
  }
  return { ok: true, value: input };
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
  return data.biographies
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
export const canEditBiography = (account: EditAccount | null, gameId: string): boolean => {
  if (!account) return false;
  if (account.role === 'admin') return true;
  return account.username.toLowerCase() === gameId.trim().toLowerCase();
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
      authorGameId: username,
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
    if (!canDeleteCommentForAuthor(comment.authorUsername, actor)) {
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
        const oldDefaultTitle = defaultMainTitle(source.gameId);
        source.gameId = newName;
        // 默认标题里带着游戏 ID；账号改名后要同步，不然会留下旧 ID。
        // 自定义标题属于作者内容，保持原样。
        if (source.mainTitle === oldDefaultTitle) source.mainTitle = defaultMainTitle(newName);
        source.updatedAt = now;
        migrated = true;
      }
    }

    let commentsUpdated = 0;
    for (const biography of data.biographies) {
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
