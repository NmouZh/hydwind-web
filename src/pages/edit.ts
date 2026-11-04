import type { APIRoute } from 'astro';
import { getAllGuides } from '../lib/content';

/**
 * 站内「编辑此页」的跳转口。
 *
 * 页面 HTML 里不直接写 GitHub 地址，统一走这里，再跳到对应 Markdown 文件。
 * 只接受已发布的 Wiki 页面 slug，避免变成任意 URL 跳转。
 */
const REPO = 'NmouZh/hydwind-web';
const BRANCH = 'main';
const DIR = 'src/content/guides';

export const prerender = false;

export const GET: APIRoute = async ({ url, redirect }) => {
  const page = (url.searchParams.get('page') ?? '').trim();
  const folder = `https://github.com/${REPO}/tree/${BRANCH}/${DIR}`;

  if (!page) return redirect(folder, 302);

  const guides = await getAllGuides();
  if (!guides.some((guide) => guide.id === page)) return redirect(folder, 302);

  return redirect(`https://github.com/${REPO}/edit/${BRANCH}/${DIR}/${page}.md`, 302);
};
