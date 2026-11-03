import type { APIRoute } from 'astro';
import { findAccount } from '../../../../lib/accounts';
import {
  canEditBiography,
  getBiography,
  saveBiography,
  validateBiography,
  type MentionResolver,
} from '../../../../lib/biographies';
import { getPublishedPeople } from '../../../../lib/content';
import { consumeRateLimit } from '../../../../lib/rate-limit';
import { readSessionFromRequest } from '../../../../lib/session';

/**
 * 人物传记接口。
 *
 * 人物页是构建期静态产物，传记要能随时改，所以正文由浏览器拉这一条接口渲染，
 * 和议题列表同一个思路：静态壳 + 运行时数据。
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

/** 人物 id ↔ 游戏 ID 的映射，正文里的 `@游戏ID` 靠它落到具体人物。 */
const loadPeople = async () => {
  const people = await getPublishedPeople();
  const byGameId = new Map<string, string>();
  const byId = new Map<string, string>();
  for (const person of people) {
    byGameId.set(person.data.gameId, person.id);
    byId.set(person.id, person.data.gameId);
  }
  return { people, byGameId, byId };
};

export const GET: APIRoute = async ({ params }) => {
  const personId = params.id ?? '';
  const { byId } = await loadPeople();
  const gameId = byId.get(personId);
  if (!gameId) return json({ error: '没有这个人物' }, 404);

  const biography = await getBiography(personId);
  if (!biography) return json({ biography: null });

  return json({
    biography: {
      body: biography.body,
      author: biography.author,
      createdAt: biography.createdAt,
      updatedAt: biography.updatedAt,
      refs: biography.refs.map((id) => ({ personId: id, gameId: byId.get(id) ?? id })),
    },
  });
};

/** PUT /api/people/:id/biography → 保存（没有就新建，有就覆盖） */
export const PUT: APIRoute = async ({ params, request, clientAddress }) => {
  const session = readSessionFromRequest(request);
  if (!session) return json({ error: '先登录再写传记' }, 401);

  const personId = params.id ?? '';
  const { byGameId, byId } = await loadPeople();
  if (!byId.has(personId)) return json({ error: '没有这个人物' }, 404);

  const limit = consumeRateLimit(`bio:${session.username}:${clientAddress ?? '-'}`, 12, 10 * 60_000);
  if (!limit.ok) return json({ error: '保存太频繁啦，过几分钟再试' }, 429);

  const existing = await getBiography(personId);
  if (!canEditBiography(existing, session)) {
    return json({ error: `这篇传记是 ${existing?.author ?? '别人'} 写的，只有作者本人能改` }, 403);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: '请求体不是合法 JSON' }, 400);
  }

  const account = await findAccount(session.username);
  const resolver: MentionResolver = { byGameId };
  const parsed = validateBiography(
    {
      personId,
      body: (payload as { body?: unknown })?.body,
      author: account?.nickname || session.username,
      authorUsername: session.username,
    },
    resolver,
    personId
  );
  if (!parsed.ok) return json({ error: parsed.message }, 422);

  const saved = await saveBiography(parsed.value);
  return json({
    biography: {
      body: saved.body,
      author: saved.author,
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt,
      refs: saved.refs.map((id) => ({ personId: id, gameId: byId.get(id) ?? id })),
    },
    message: '传记保存好了',
  });
};
