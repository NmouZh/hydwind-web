import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * 议题（Issue）系统的最小存储层。
 *
 * 用 JSON 文件保存，适合单实例 Node 部署（EdgeOne 自建容器 / 小型 VPS）。
 * 如果以后换成 Serverless 多实例，需要把这一层换成数据库或对象存储。
 */

export const ISSUE_CATEGORIES = ['bug', 'suggestion', 'other'] as const;
export const ISSUE_STATUSES = ['pending', 'open', 'rejected', 'done'] as const;

export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export interface IssueReply {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  /** 群内 / 站务回复标记，前端可用不同底色 */
  staff: boolean;
}

export interface Issue {
  id: number;
  title: string;
  body: string;
  author: string;
  category: IssueCategory;
  status: IssueStatus;
  createdAt: string;
  updatedAt: string;
  replies: IssueReply[];
}

export interface IssueList {
  version: 1;
  nextId: number;
  issues: Issue[];
}

const MAX_TITLE = 80;
const MAX_BODY = 2000;
const MAX_AUTHOR = 32;

const dataDir = () => process.env.HYDWIND_DATA_DIR ?? path.join(process.cwd(), 'data');
const dataFile = () => path.join(dataDir(), 'issues.json');

const emptyList = (): IssueList => ({ version: 1, nextId: 1, issues: [] });

/** 同一个进程内的串行队列，避免并发写坏 JSON。 */
let queue: Promise<unknown> = Promise.resolve();

const serialize = <T>(task: () => Promise<T>): Promise<T> => {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
};

const readList = async (): Promise<IssueList> => {
  try {
    const raw = await readFile(dataFile(), 'utf8');
    const parsed = JSON.parse(raw) as IssueList;
    if (!parsed || !Array.isArray(parsed.issues)) return emptyList();
    return { version: 1, nextId: parsed.nextId ?? 1, issues: parsed.issues };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyList();
    throw error;
  }
};

const writeList = async (list: IssueList): Promise<void> => {
  await mkdir(dataDir(), { recursive: true });
  const file = dataFile();
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
};

const clamp = (value: unknown, max: number): string => {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
};

export interface NewIssueInput {
  title: unknown;
  body: unknown;
  author: unknown;
  category: unknown;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; message: string };

export const validateNewIssue = (
  input: NewIssueInput
): ValidationResult<{ title: string; body: string; author: string; category: IssueCategory }> => {
  const title = clamp(input.title, MAX_TITLE);
  const body = clamp(input.body, MAX_BODY);
  const author = clamp(input.author, MAX_AUTHOR) || '匿名玩家';
  const category = (ISSUE_CATEGORIES as readonly string[]).includes(String(input.category))
    ? (input.category as IssueCategory)
    : 'other';

  if (title.length < 4) return { ok: false, message: '标题至少 4 个字' };
  if (body.length < 10) return { ok: false, message: '描述至少 10 个字，方便我们定位问题' };

  return { ok: true, value: { title, body, author, category } };
};

export const createIssue = (
  input: { title: string; body: string; author: string; category: IssueCategory }
): Promise<Issue> =>
  serialize(async () => {
    const list = await readList();
    const now = new Date().toISOString();
    const issue: Issue = {
      id: list.nextId,
      title: input.title,
      body: input.body,
      author: input.author,
      category: input.category,
      // 站内提交后先进待审队列，群里「通过」后才公开成 open
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      replies: [],
    };
    list.issues.push(issue);
    list.nextId += 1;
    await writeList(list);
    return issue;
  });

/** 未登录访客只看得到非 pending 的议题；pending 只在站务视角可见。 */
export const listIssues = async (options: { includePending?: boolean } = {}): Promise<Issue[]> => {
  const list = await readList();
  const issues = options.includePending
    ? list.issues
    : list.issues.filter((issue) => issue.status !== 'pending');
  return [...issues].sort((a, b) => b.id - a.id);
};

export const getIssue = async (id: number): Promise<Issue | undefined> => {
  const list = await readList();
  return list.issues.find((issue) => issue.id === id);
};

export const updateIssueStatus = (
  id: number,
  status: IssueStatus
): Promise<Issue | undefined> =>
  serialize(async () => {
    const list = await readList();
    const issue = list.issues.find((item) => item.id === id);
    if (!issue) return undefined;
    issue.status = status;
    issue.updatedAt = new Date().toISOString();
    await writeList(list);
    return issue;
  });

export const addIssueReply = (
  id: number,
  reply: { author: string; body: string; staff?: boolean }
): Promise<Issue | undefined> =>
  serialize(async () => {
    const list = await readList();
    const issue = list.issues.find((item) => item.id === id);
    if (!issue) return undefined;
    const now = new Date().toISOString();
    issue.replies.push({
      id: randomUUID(),
      author: reply.author,
      body: reply.body,
      staff: Boolean(reply.staff),
      createdAt: now,
    });
    issue.updatedAt = now;
    await writeList(list);
    return issue;
  });

export const isIssueStatus = (value: unknown): value is IssueStatus =>
  (ISSUE_STATUSES as readonly string[]).includes(String(value));
