/**
 * 人物详情页的浏览器侧逻辑：编辑传记 + 评论。
 *
 * 页面本身是 SSR 的，首屏已经带着传记、空状态和评论；这里只补三件事：
 * 1. 本人 / 管理员保存主标题与正文（PUT `/api/people/:id/biography`）；
 * 2. 登录玩家发表评论（POST 评论接口）；
 * 3. 评论作者 / 管理员删除评论（DELETE 评论接口），并在每次变更后重新拉列表。
 *
 * 展示规则（空状态、评论署名、时间、分组、删除按钮）全部来自
 * `lib/person-page.ts`，和 SSR 页面共用一份，避免两边说法不一样。
 */

import { formatBiographyDate, renderBiographyHtml, type BiographyRef } from '../lib/biography-text.ts';
import {
  MAX_BIO_BODY,
  MAX_BIO_TITLE,
  MAX_COMMENT_BODY,
  MIN_BIO_TITLE,
} from '../lib/biography-limits.ts';
import {
  canDeleteCommentForViewer,
  commentAuthorLabel,
  formatCommentTime,
  groupCommentsByDay,
  hasReadableBody,
} from '../lib/person-page.ts';

declare global {
  interface Window {
    hydwindToast?: (message: string) => void;
  }
}

interface BiographyResponse {
  mainTitle?: string;
  body?: string;
  updatedAt?: string | null;
  message?: string;
  error?: string;
}

interface CommentPayload {
  id: string;
  authorGameId: string;
  authorDisplay: string;
  body: string;
  createdAt: string;
}

interface CommentsResponse {
  comments?: CommentPayload[];
  error?: string;
}

const textLength = (value: string): number => [...value].length;

const setStatus = (
  element: HTMLElement | null,
  message: string,
  tone: 'ok' | 'error' = 'error'
): void => {
  if (!element) return;
  element.textContent = message;
  element.dataset.tone = tone;
};

export const initPersonPage = (): void => {
  const root = document.querySelector<HTMLElement>('[data-person-page]');
  if (!root) return;

  const slug = root.dataset.slug ?? '';
  if (!slug) return;

  const viewerName = root.dataset.viewer ?? '';
  const isAdmin = root.dataset.viewerAdmin === 'true';
  const hasStaticBody = root.dataset.hasStaticBody === 'true';
  const viewer = viewerName ? { username: viewerName, role: isAdmin ? 'admin' : 'player' } : null;

  const refs: BiographyRef[] = (() => {
    try {
      const parsed: unknown = JSON.parse(root.dataset.refs ?? '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (ref): ref is BiographyRef =>
          Boolean(ref) &&
          typeof (ref as BiographyRef).gameId === 'string' &&
          typeof (ref as BiographyRef).personId === 'string'
      );
    } catch {
      return [];
    }
  })();

  const titleHost = root.querySelector<HTMLElement>('[data-bio-title]');
  const bodyHost = root.querySelector<HTMLElement>('[data-bio-body]');
  const emptyHost = root.querySelector<HTMLElement>('[data-bio-empty]');
  const updatedHost = root.querySelector<HTMLElement>('[data-bio-updated]');
  const editor = root.querySelector<HTMLFormElement>('[data-bio-editor]');
  const titleInput = root.querySelector<HTMLInputElement>('[data-bio-title-input]');
  const bodyInput = root.querySelector<HTMLTextAreaElement>('[data-bio-input]');
  const saveButton = root.querySelector<HTMLButtonElement>('[data-bio-submit]');
  const bioStatus = root.querySelector<HTMLElement>('[data-bio-status]');

  const commentList = root.querySelector<HTMLElement>('[data-comment-list]');
  const commentEmpty = root.querySelector<HTMLElement>('[data-comment-empty]');
  const commentCount = root.querySelector<HTMLElement>('[data-comment-count]');
  const commentForm = root.querySelector<HTMLFormElement>('[data-comment-form]');
  const commentInput = root.querySelector<HTMLTextAreaElement>('[data-comment-input]');
  const commentButton = root.querySelector<HTMLButtonElement>('[data-comment-submit]');
  const commentStatus = root.querySelector<HTMLElement>('[data-comment-status]');

  const biographyUrl = `/api/people/${encodeURIComponent(slug)}/biography`;
  const commentsUrl = `/api/people/${encodeURIComponent(slug)}/comments`;

  /** 保存成功后原地更新首屏，不整页刷新。 */
  const applyBiography = (mainTitle: string, body: string, updatedAt?: string | null): void => {
    if (titleHost) titleHost.textContent = mainTitle;
    const hasBody = hasReadableBody(hasStaticBody, body);
    if (bodyHost) {
      bodyHost.innerHTML = renderBiographyHtml(body, refs);
      // 运行期正文单独渲染；静态正文在上面的资料区，不在这里重复显示。
      bodyHost.hidden = !body.trim();
    }
    if (emptyHost) emptyHost.hidden = hasBody;
    if (updatedHost) {
      updatedHost.hidden = !updatedAt;
      updatedHost.textContent = updatedAt ? `最后更新：${formatBiographyDate(updatedAt)}` : '';
    }
    document.title = `${mainTitle} · 人物 · 氢风 Hydwind`;
  };

  editor?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!titleInput || !bodyInput || !saveButton) return;

    const mainTitle = titleInput.value.trim();
    const body = bodyInput.value;
    const titleLength = textLength(mainTitle);
    const bodyLength = textLength(body.trim());

    if (titleLength > 0 && titleLength < MIN_BIO_TITLE) {
      setStatus(bioStatus, `主标题至少 ${MIN_BIO_TITLE} 个字`);
      titleInput.focus();
      return;
    }
    if (titleLength > MAX_BIO_TITLE) {
      setStatus(bioStatus, `主标题最多 ${MAX_BIO_TITLE} 个字`);
      titleInput.focus();
      return;
    }
    if (bodyLength > MAX_BIO_BODY) {
      setStatus(bioStatus, `正文最多 ${MAX_BIO_BODY} 个字，先删一点`);
      bodyInput.focus();
      return;
    }

    saveButton.disabled = true;
    setStatus(bioStatus, '保存中…', 'ok');

    try {
      const response = await fetch(biographyUrl, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ mainTitle, body }),
      });
      const payload = (await response.json().catch(() => ({}))) as BiographyResponse;

      if (!response.ok) {
        setStatus(bioStatus, payload.error ?? `保存失败（${response.status}）`);
        return;
      }

      applyBiography(
        payload.mainTitle ?? mainTitle,
        payload.body ?? body,
        payload.updatedAt ?? null
      );
      setStatus(bioStatus, payload.message ?? '传记保存好了', 'ok');
      window.hydwindToast?.('传记已保存');
    } catch {
      setStatus(bioStatus, '网络不太顺，稍后再试一次');
    } finally {
      saveButton.disabled = false;
    }
  });

  const commentArticle = (comment: CommentPayload): HTMLElement => {
    const article = document.createElement('article');
    article.className = 'comment';
    article.dataset.commentId = comment.id;

    const head = document.createElement('header');
    head.className = 'comment-head';

    const author = document.createElement('span');
    author.className = 'comment-author';
    author.textContent = commentAuthorLabel(comment.authorDisplay, comment.authorGameId);

    const time = document.createElement('time');
    time.className = 'comment-time';
    time.dateTime = comment.createdAt;
    time.textContent = formatCommentTime(comment.createdAt);

    head.append(author, time);
    article.append(head);

    const body = document.createElement('p');
    body.className = 'comment-body';
    body.textContent = comment.body;
    article.append(body);

    if (canDeleteCommentForViewer(comment, viewer)) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'text-button comment-delete';
      remove.dataset.commentDelete = comment.id;
      remove.textContent = '删除';
      article.append(remove);
    }

    return article;
  };

  const renderComments = (comments: CommentPayload[]): void => {
    if (!commentList) return;
    commentList.replaceChildren();

    for (const group of groupCommentsByDay(comments)) {
      const day = document.createElement('div');
      day.className = 'comment-day';

      const label = document.createElement('p');
      label.className = 'hw-label comment-day-label';
      label.textContent = group.date;
      day.append(label);

      for (const comment of group.comments) day.append(commentArticle(comment));
      commentList.append(day);
    }

    if (commentEmpty) commentEmpty.hidden = comments.length > 0;
    if (commentCount) commentCount.textContent = String(comments.length);
  };

  const loadComments = async (): Promise<void> => {
    try {
      const response = await fetch(commentsUrl, {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
      });
      if (!response.ok) return;
      const payload = (await response.json()) as CommentsResponse;
      if (Array.isArray(payload.comments)) renderComments(payload.comments);
    } catch {
      /* 拉不到就保留 SSR 渲染好的列表 */
    }
  };

  commentForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!commentInput || !commentButton) return;

    const body = commentInput.value.trim();
    if (!body) {
      setStatus(commentStatus, '评论不能为空');
      commentInput.focus();
      return;
    }
    if (textLength(body) > MAX_COMMENT_BODY) {
      setStatus(commentStatus, `评论最多 ${MAX_COMMENT_BODY} 个字`);
      commentInput.focus();
      return;
    }

    commentButton.disabled = true;
    setStatus(commentStatus, '发表中…', 'ok');

    try {
      const response = await fetch(commentsUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ body }),
      });
      const payload = (await response.json().catch(() => ({}))) as CommentsResponse;
      if (!response.ok) {
        setStatus(commentStatus, payload.error ?? `发表失败（${response.status}）`);
        return;
      }

      commentInput.value = '';
      await loadComments();
      setStatus(commentStatus, '评论已发表', 'ok');
    } catch {
      setStatus(commentStatus, '网络不太顺，稍后再试一次');
    } finally {
      commentButton.disabled = false;
    }
  });

  commentList?.addEventListener('click', async (event) => {
    const target = (event.target as Element | null)?.closest<HTMLElement>('[data-comment-delete]');
    const id = target?.dataset.commentDelete;
    if (!target || !id) return;
    if (!window.confirm('删除这条评论？删除后无法恢复。')) return;

    target.disabled = true;
    try {
      const response = await fetch(`${commentsUrl}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
      });
      const payload = (await response.json().catch(() => ({}))) as CommentsResponse;
      if (!response.ok) {
        setStatus(commentStatus, payload.error ?? `删除失败（${response.status}）`);
        target.disabled = false;
        return;
      }
      await loadComments();
      setStatus(commentStatus, '评论已删除', 'ok');
    } catch {
      setStatus(commentStatus, '网络不太顺，稍后再试一次');
      target.disabled = false;
    }
  });

  // 评论列表已由 SSR 渲染；只有发表/删除成功后才重新拉取，避免每次访问多打一次接口。
};