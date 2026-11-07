/**
 * 人物详情页的纯展示逻辑。
 *
 * 同一个模块被两边使用：
 * - SSR 页面在服务端算出标题回退、空状态文案和评论分组；
 * - 浏览器脚本保存传记 / 刷新评论后，用同一套规则重画，不会出现「服务端说一套、前端又一套」。
 *
 * 因此这里不能 import 任何 `node:*`、存储层或 DOM，只做输入到输出的映射。
 */

export type ViewerState = 'guest' | 'viewer' | 'owner';

export interface CommentViewer {
  username: string;
  role: string;
}

export interface CommentLike {
  id: string;
  authorGameId: string;
  authorDisplay: string;
  body: string;
  createdAt: string;
}

export interface CommentDayGroup<T extends { createdAt: string }> {
  /** 北京时间自然日，`YYYY-MM-DD` */
  date: string;
  comments: T[];
}

/** 主标题：空串 / 空白 / 没有传记记录时回退到 `<gameId>的人物传记`。 */
export const biographyTitle = (
  biography: { mainTitle?: string } | null | undefined,
  gameId: string
): string => {
  const title = typeof biography?.mainTitle === 'string' ? biography.mainTitle.trim() : '';
  return title || `${gameId.trim()}的人物传记`;
};

/** 正文没有可读内容时显示空状态（正文允许为空，不算错误）。 */
export const isBiographyEmpty = (
  biography: { body?: string } | null | undefined
): boolean => !(typeof biography?.body === 'string' && biography.body.trim());

/**
 * 这一页到底有没有可读正文：静态人物自带 Markdown 正文，账号看运行期传记。
 * 详情页和 /people 列表共用这条规则，避免列表说「有正文」、详情页却说「尚未填写」。
 */
export const hasReadableBody = (
  hasStaticBody: boolean,
  biographyBody?: string
): boolean => hasStaticBody || Boolean(typeof biographyBody === 'string' && biographyBody.trim());

/** 空状态文案：访客、已登录读者、传记主本人看到的下一步不一样。 */
export const biographyEmptyMessage = (gameId: string, state: ViewerState): string => {
  if (state === 'owner') return '正文尚未填写，写下你的故事吧。';
  if (state === 'viewer') return `${gameId} 的传记正文尚未填写。`;
  return `${gameId} 的传记正文尚未填写，登录后可以写下第一篇。`;
};

/** 评论署名：昵称和游戏 ID 不同就一起显示，免得只看到昵称认不出是谁。 */
export const commentAuthorLabel = (display: string, gameId: string): string => {
  const shown = typeof display === 'string' ? display.trim() : '';
  const id = typeof gameId === 'string' ? gameId.trim() : '';
  if (!shown) return id;
  if (!id || shown.toLowerCase() === id.toLowerCase()) return shown;
  return `${shown}（@${id}）`;
};

/**
 * 评论时间固定按北京时间（UTC+8）展示。
 * 用固定偏移而不是运行环境的本地时区，SSR 与浏览器才不会差几个小时。
 */
const COMMENT_OFFSET_MS = 8 * 60 * 60 * 1000;

const pad = (value: number): string => String(value).padStart(2, '0');

const shiftedDate = (iso: string): Date | null => {
  const time = typeof iso === 'string' ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(time) ? null : new Date(time + COMMENT_OFFSET_MS);
};

/** `2026-11-07T20:00:00Z` → `2026-11-08`（北京时间）。 */
export const commentDay = (iso: string): string => {
  const date = shiftedDate(iso);
  if (!date) return iso;
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

/** `2026-11-07T05:30:00Z` → `2026-11-07 13:30`（北京时间）。 */
export const formatCommentTime = (iso: string): string => {
  const date = shiftedDate(iso);
  if (!date) return iso;
  return `${commentDay(iso)} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
};

/** 按自然日分组；输入已按 createdAt 正序，输出保持顺序。 */
export const groupCommentsByDay = <T extends { createdAt: string }>(
  comments: readonly T[]
): CommentDayGroup<T>[] => {
  const groups: CommentDayGroup<T>[] = [];
  for (const comment of comments) {
    const date = commentDay(comment.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.date === date) last.comments.push(comment);
    else groups.push({ date, comments: [comment] });
  }
  return groups;
};

/**
 * 删除评论的唯一权限规则：作者本人或管理员。
 *
 * `authorUsername` 是存储层的归属键；页面展示层没有这个字段，所以
 * `canDeleteCommentForViewer` 用公开的 `authorGameId` 调用同一个核心。
 */
export const canDeleteCommentForAuthor = (
  authorUsername: string,
  viewer: CommentViewer | null
): boolean => {
  if (!viewer) return false;
  if (viewer.role === 'admin') return true;
  const author = typeof authorUsername === 'string' ? authorUsername.trim().toLowerCase() : '';
  return author !== '' && author === viewer.username.trim().toLowerCase();
};

/**
 * 删除按钮是否显示给当前访客。
 *
 * 真正的权限判断在 API（按 authorUsername + 账号 role 回查），这里只决定
 * 「要不要渲染按钮」；拿不到账号时一律不显示。
 */
export const canDeleteCommentForViewer = (
  comment: { authorGameId: string },
  viewer: CommentViewer | null
): boolean => canDeleteCommentForAuthor(comment.authorGameId, viewer);