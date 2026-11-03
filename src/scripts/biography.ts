/**
 * 人物传记的浏览器侧逻辑。
 *
 * 人物页是构建期静态 HTML，传记正文由 `/api/people/:id/biography` 在运行时补齐：
 * - 读：任何人都能看；
 * - 写：只有登录账号能写，作者本人和站务能改，服务端才是最终裁判；
 * - 引用：编辑器里的「引用他人」按钮插入 `@游戏ID`，保存后正文里渲染成人物链接。
 *
 * 这里不做 markdown，只按空行分段 —— 传记是散文，加太多语法反而劝退写的人。
 */

interface BiographyRef {
  personId: string;
  gameId: string;
}

declare global {
  interface Window {
    hydwindToast?: (message: string) => void;
  }
}

interface BiographyPayload {
  body: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  refs: BiographyRef[];
}

const MENTION_PATTERN = /@([A-Za-z0-9_-]{1,32})/g;

/**
 * 人物页地址。用 join 拼而不是模板串：构建检查脚本会把内联脚本当成
 * HTML 的一部分扫站内链接，模板串里的 `${…}` 会被误判成坏链接。
 */
const personPath = (personId: string): string =>
  ['', 'people', encodeURIComponent(personId), ''].join('/');

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const formatDate = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
};

/** 正文 → 段落 HTML，`@游戏ID` 换成能点开的人物链接。 */
const renderBody = (body: string, refs: BiographyRef[]): string => {
  const byGameId = new Map(refs.map((ref) => [ref.gameId, ref.personId]));

  return body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => {
      const html = escapeHtml(paragraph).replace(MENTION_PATTERN, (match, gameId: string) => {
        const personId = byGameId.get(gameId);
        if (!personId) return match;
        return `<a class="bio-mention" href="${personPath(personId)}">${match}</a>`;
      });
      return `<p>${html.replaceAll('\n', '<br />')}</p>`;
    })
    .join('');
};

export const initBiography = (): void => {
  const root = document.querySelector<HTMLElement>('[data-biography]');
  if (!root) return;

  const personId = root.dataset.personId ?? '';
  if (!personId) return;

  const bodyHost = root.querySelector<HTMLElement>('[data-bio-body]');
  const emptyHost = root.querySelector<HTMLElement>('[data-bio-empty]');
  const metaHost = root.querySelector<HTMLElement>('[data-bio-meta]');
  const editButton = root.querySelector<HTMLButtonElement>('[data-bio-edit]');
  const form = root.querySelector<HTMLFormElement>('[data-bio-editor]');
  const input = root.querySelector<HTMLTextAreaElement>('[data-bio-input]');
  const status = root.querySelector<HTMLElement>('[data-bio-status]');
  const submit = root.querySelector<HTMLButtonElement>('[data-bio-submit]');
  const cancel = root.querySelector<HTMLButtonElement>('[data-bio-cancel]');

  let current: BiographyPayload | null = null;
  let signedIn = false;

  const setStatus = (message: string, tone: 'error' | 'ok' = 'error'): void => {
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
    status.dataset.state = tone;
  };

  const render = (): void => {
    if (!bodyHost || !emptyHost || !metaHost) return;

    if (!current) {
      bodyHost.hidden = true;
      bodyHost.innerHTML = '';
      emptyHost.hidden = false;
      metaHost.hidden = true;
      return;
    }

    bodyHost.innerHTML = renderBody(current.body, current.refs);
    bodyHost.hidden = false;
    emptyHost.hidden = true;
    metaHost.hidden = false;
    const edited = current.updatedAt !== current.createdAt;
    metaHost.textContent = edited
      ? `${current.author} 写于 ${formatDate(current.createdAt)}，最后改了 ${formatDate(current.updatedAt)}`
      : `${current.author} 写于 ${formatDate(current.createdAt)}`;
  };

  const syncEditButton = (): void => {
    if (!editButton) return;
    editButton.hidden = !signedIn;
    editButton.textContent = current ? '编辑这篇传记' : '写一篇传记';
  };

  const openEditor = (): void => {
    if (!form || !input) return;
    input.value = current?.body ?? '';
    form.hidden = false;
    setStatus('');
    editButton?.setAttribute('hidden', '');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  };

  const closeEditor = (): void => {
    if (!form) return;
    form.hidden = true;
    setStatus('');
    syncEditButton();
  };

  editButton?.addEventListener('click', openEditor);
  cancel?.addEventListener('click', closeEditor);

  // 「引用他人」：在光标处插入 @游戏ID，不打断正在写的位置
  root.querySelectorAll<HTMLButtonElement>('[data-bio-mention]').forEach((chip) => {
    chip.addEventListener('click', () => {
      if (!input) return;
      const mention = chip.dataset.bioMention ?? '';
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      const before = input.value.slice(0, start);
      const after = input.value.slice(end);
      const spacer = before === '' || /\s$/.test(before) ? '' : ' ';
      const insert = `${spacer}${mention} `;
      input.value = `${before}${insert}${after}`;
      const caret = before.length + insert.length;
      input.focus();
      input.setSelectionRange(caret, caret);
      setStatus('');
    });
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!input || !submit) return;

    const body = input.value.trim();
    if (body.length < 20) {
      setStatus('至少写 20 个字，多留一点故事给后面的人看');
      return;
    }

    submit.disabled = true;
    setStatus('保存中…', 'ok');

    try {
      const response = await fetch(`/api/people/${encodeURIComponent(personId)}/biography`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ body }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        biography?: BiographyPayload;
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        setStatus(payload.error ?? `保存失败（${response.status}）`);
        return;
      }

      current = payload.biography ?? current;
      render();
      closeEditor();
      setStatus(payload.message ?? '传记保存好了', 'ok');
      window.hydwindToast?.('传记已保存');
    } catch {
      setStatus('网络不太顺，稍后再试一次');
    } finally {
      submit.disabled = false;
      syncEditButton();
    }
  });

  const load = async (): Promise<void> => {
    try {
      const response = await fetch(`/api/people/${encodeURIComponent(personId)}/biography`, {
        headers: { accept: 'application/json' },
      });
      if (response.ok) {
        const payload = (await response.json()) as { biography: BiographyPayload | null };
        current = payload.biography;
      }
    } catch {
      /* 传记拉不到就当没有，页面其余内容照常读 */
    }
    render();
    syncEditButton();
  };

  const checkSession = async (): Promise<void> => {
    try {
      const response = await fetch('/api/auth/me', {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
      });
      signedIn = response.ok;
    } catch {
      signedIn = false;
    }
    syncEditButton();
  };

  void Promise.all([load(), checkSession()]);
};
