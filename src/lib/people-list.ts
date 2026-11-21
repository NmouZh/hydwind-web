import { biographyTitle, hasReadableBody } from './person-page.ts';

/**
 * /people 列表的纯逻辑与类型。
 *
 * 合并静态 curated 人物（src/content/people/*.md）与注册账号的动作已经搬到
 * hydwind-api 的 `GET /api/people`；Web 只消费返回的 PersonListItem。
 * 这里的合并函数继续保留，作为同一套排序 / 搜索 / 标题回退规则的纯实现与
 * 测试接缝，不读文件、不依赖 Astro。
 */

/** 列表需要的静态人物字段；页面负责从 content collection 映射过来。 */
export interface StaticPersonInput {
  /** 静态内容 id，也就是详情页 URL 的 slug。 */
  id: string;
  gameId: string;
  role: string;
  tags: string[];
  avatar: string;
  updated: string | Date;
  /** 静态内容集的 Markdown 正文是否非空；详情页用同一条判断决定空状态。 */
  hasBody: boolean;
}

/** 列表需要的账号字段。 */
export interface AccountInput {
  username: string;
  nickname?: string;
  createdAt?: string;
}

/** 列表需要的传记字段；由 hydwind-api 的 /api/people 返回，Web 不再读存储。 */
export interface BiographyInput {
  gameId: string;
  mainTitle?: string;
  body?: string;
  createdAt?: string;
  updatedAt?: string | Date | null;
  comments?: unknown[];
}

export interface PeopleListSource {
  staticPeople: StaticPersonInput[];
  accounts: AccountInput[];
  biographies: BiographyInput[];
}

export interface PersonListItem {
  /** 详情页 slug：静态人物沿用原 id，账号用 username 的小写形式。 */
  slug: string;
  gameId: string;
  nickname: string;
  /** 玩家可编辑的主标题；没有记录时回退成 `<gameId>的人物传记`。 */
  mainTitle: string;
  avatar: string;
  /** 静态人物保留人工维护的角色；账号为空。 */
  role: string;
  /** 静态人物保留人工维护的标签；账号为空。 */
  tags: string[];
  /** 静态人物自带 Markdown 正文；账号看传记 body 是否为空。 */
  hasBody: boolean;
  /** ISO 时间字符串，取传记更新时间 → 静态人物 updated → 账号创建时间。 */
  updatedAt: string | null;
  commentCount: number;
  source: 'static' | 'account';
}

const keyOf = (gameId: string): string => gameId.trim().toLowerCase();

/**
 * 账号没有上传头像时走同源的默认头像接口：有正版皮肤就显示本人，
 * 否则服务端回退到本地默认 Steve / Alex。页面本身不直连第三方。
 */
export const accountAvatar = (gameId: string): string =>
  `/api/avatar/${encodeURIComponent(gameId)}`;

const isoOrNull = (value: string | Date | null | undefined): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
};

const commentCountOf = (biography: BiographyInput | undefined): number =>
  Array.isArray(biography?.comments) ? biography.comments.length : 0;

const hasText = (value: string | undefined): boolean =>
  typeof value === 'string' && value.trim().length > 0;

export const buildPeopleList = ({
  staticPeople,
  accounts,
  biographies,
}: PeopleListSource): PersonListItem[] => {
  const biographyByKey = new Map<string, BiographyInput>();
  for (const biography of biographies) {
    const key = keyOf(biography.gameId);
    if (!biographyByKey.has(key)) biographyByKey.set(key, biography);
  }

  const accountByKey = new Map<string, AccountInput>();
  for (const account of accounts) {
    const key = keyOf(account.username);
    if (!accountByKey.has(key)) accountByKey.set(key, account);
  }

  const items = new Map<string, PersonListItem>();

  // 先放静态人物：保留人工维护的 slug、角色、标签和头像。
  for (const person of staticPeople) {
    const key = keyOf(person.gameId);
    if (items.has(key)) continue;
    const account = accountByKey.get(key);
    const biography = biographyByKey.get(key);
    const gameId = person.gameId;

    items.set(key, {
      slug: person.id,
      gameId,
      nickname: account?.nickname?.trim() ?? '',
      mainTitle: biographyTitle(biography, gameId),
      avatar: person.avatar,
      role: person.role,
      tags: [...person.tags],
      hasBody: hasReadableBody(person.hasBody, biography?.body),
      updatedAt:
        isoOrNull(biography?.updatedAt) ??
        isoOrNull(person.updated) ??
        isoOrNull(account?.createdAt),
      commentCount: commentCountOf(biography),
      source: 'static',
    });
  }

  // 再补所有账号；已经由静态人物占用的 gameId 不重复添加。
  for (const account of accounts) {
    const key = keyOf(account.username);
    if (items.has(key)) continue;
    const biography = biographyByKey.get(key);
    const gameId = account.username;

    items.set(key, {
      slug: gameId.toLowerCase(),
      gameId,
      nickname: account.nickname?.trim() ?? '',
      mainTitle: biographyTitle(biography, gameId),
      avatar: accountAvatar(gameId),
      role: '',
      tags: [],
      hasBody: hasText(biography?.body),
      updatedAt:
        isoOrNull(biography?.updatedAt) ?? isoOrNull(account.createdAt),
      commentCount: commentCountOf(biography),
      source: 'account',
    });
  }

  return sortPeopleByGameId([...items.values()]);
};

/** 默认按 gameId 忽略大小写排序；相同则用 slug 兜底保证顺序稳定。 */
export const sortPeopleByGameId = (
  items: PersonListItem[]
): PersonListItem[] =>
  [...items].sort(
    (a, b) =>
      a.gameId.localeCompare(b.gameId, 'en', { sensitivity: 'base' }) ||
      a.slug.localeCompare(b.slug)
  );

/** q 只搜索 gameId 和昵称，忽略首尾空白与大小写。 */
export const filterPeopleList = (
  items: PersonListItem[],
  query: string | null | undefined
): PersonListItem[] => {
  const needle = (query ?? '').trim().toLowerCase();
  if (!needle) return items;
  return items.filter(
    (item) =>
      item.gameId.toLowerCase().includes(needle) ||
      item.nickname.toLowerCase().includes(needle)
  );
};