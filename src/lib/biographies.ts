import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseMentions } from './biography-text';

/**
 * 人物传记存储层。
 *
 * 和 issues.ts / accounts.ts 一样：单 JSON 文件 + 进程内串行写队列 + 原子替换。
 * 一个玩家（person id）只有一份传记，谁写的谁可以改，站务可以改任何一篇。
 *
 * 传记正文是纯文本，空行分段；`@游戏ID` 是「引用他人」的写法，
 * 解析由 `parseMentions` 负责，落库时同时存一份 `refs`（person id 数组），
 * 这样列表和统计不用每次回头扫全文。
 */

export const MAX_BIO_BODY = 4000;
export const MIN_BIO_BODY = 20;
export const MAX_BIO_REFS = 12;
const MAX_NAME = 32;

export interface Biography {
  /** 人物 id（内容集合里的 slug），一篇传记对应一个玩家 */
  personId: string;
  body: string;
  /** 正文里引用到的人物 id，去重后按出现顺序 */
  refs: string[];
  /** 作者昵称，展示用 */
  author: string;
  /** 作者登录名，用来判断「谁能改」 */
  authorUsername: string;
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

export { parseMentions };

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

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; message: string };

export interface PreparedBiography {
  personId: string;
  body: string;
  refs: string[];
  author: string;
  authorUsername: string;
}

/**
 * 校验并归一化一次提交。
 * `selfId` 是传记主角，自己引用自己会去掉；引用到不存在的玩家直接报错，
 * 免得正文里留一个点不开的名字。
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

export const listBiographies = async (): Promise<Biography[]> => {
  const data = await readFileData();
  return data.biographies;
};

export const getBiography = async (personId: string): Promise<Biography | null> => {
  const data = await readFileData();
  return data.biographies.find((entry) => entry.personId === personId) ?? null;
};

/** 同一个玩家只保留一篇：存在就覆盖正文，同时保留最早的 createdAt。 */
export const saveBiography = (input: PreparedBiography): Promise<Biography> =>
  serialize(async () => {
    const data = await readFileData();
    const now = new Date().toISOString();
    const index = data.biographies.findIndex((entry) => entry.personId === input.personId);

    if (index >= 0) {
      const previous = data.biographies[index];
      const next: Biography = {
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

    const created: Biography = {
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

/** 只有作者本人和站务能改别人的传记。 */
export const canEditBiography = (
  biography: Biography | null,
  session: { username: string; role: string } | null
): boolean => {
  if (!session) return false;
  if (session.role === 'admin') return true;
  if (!biography) return true;
  return biography.authorUsername === session.username;
};
