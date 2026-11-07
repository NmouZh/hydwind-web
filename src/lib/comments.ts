import { findAccount } from './accounts.ts';
import { resolvePersonBySlug, type Comment } from './biographies.ts';
import { loadStaticPeople } from './static-people.ts';

/**
 * 评论接口的共享辅助。
 *
 * `initials` 这类展示信息不在存储里冗余保存：读取时回查账号昵称，
 * 账号改名或删号后评论仍能显示合理名字。
 */

/** slug（静态人物 entry id 或账号 username）→ 传记键 gameId。 */
export const gameIdForSlug = async (slug: string): Promise<string | null> => {
  const resolved = await resolvePersonBySlug(slug, {
    staticPeople: await loadStaticPeople(),
    findAccount,
  });
  return resolved?.gameId ?? null;
};

/** 对外只暴露展示所需字段，`authorUsername` 是内部归属键，不返回给访客。 */
export const presentComment = async (comment: Comment) => {
  const author = await findAccount(comment.authorUsername);
  return {
    id: comment.id,
    authorGameId: comment.authorGameId,
    authorDisplay: author?.nickname || comment.authorGameId,
    body: comment.body,
    createdAt: comment.createdAt,
  };
};

/** 带 Origin 的浏览器写操作必须同源；没有 Origin 的（curl、服务端调用）交给登录态管。 */
export const isSameOrigin = (request: Request): boolean => {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
};
