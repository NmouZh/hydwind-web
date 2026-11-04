/**
 * 人物传记的浏览器侧逻辑。
 *
 * 分工先说清楚，免得和三处重复：
 * - 正文第一次出现在 HTML 里（构建期渲染），所以打开页面就有内容，不等接口；
 * - `GET /api/people/:id/biography` 只负责两件事：刷新最新正文、告诉前端「你能不能改」；
 * - 保存走 `PUT`，服务端是最终裁判，前端只做即时反馈。
 *
 * 入口三态都在这一层收口：
 * - 未登录 → 保留 HTML 里那条「登录后写一篇」链接，不做任何替换；
 * - 已登录可写 → 换成「写一篇传记 / 编辑这篇传记」主按钮；
 * - 已登录但改不了别人的 → 两个入口都收起，说明谁写的。
 *
 * 编辑器是一层很薄的壳：正文本来就是 Markdown，`renderBiographyHtml` 构建期和这里共用一份，
 * 所以「预览」和发布后的样子一定一致。工具栏只发命令，不做所见即所得的富文本改写。
 */

import {
  createMentionPattern,
  formatBiographyDate,
  parseMentions,
  renderBiographyHtml,
  type BiographyRef,
} from '../lib/biography-text';
import type { MarkdownEditor } from './markdown-editor';

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

interface BiographyResponse {
  signedIn?: boolean;
  canEdit?: boolean;
  limits?: { min: number; max: number; refs: number };
  biography?: BiographyPayload | null;
  error?: string;
  message?: string;
}

type ViewMode = 'edit' | 'preview';

type Command =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'h2'
  | 'h3'
  | 'quote'
  | 'ul'
  | 'ol'
  | 'task'
  | 'table'
  | 'link'
  | 'hr'
  | 'mention';

/** 每个命令只在写这一处：`wrap` 包住选中文字，`line` 给整行加前缀。 */
const COMMANDS: Record<Command, { wrap?: [string, string, string]; line?: (index: number) => string }> =
  {
    bold: { wrap: ['**', '**', '加粗'] },
    italic: { wrap: ['*', '*', '斜体'] },
    strike: { wrap: ['~~', '~~', '删除'] },
    code: { wrap: ['`', '`', '代码'] },
    quote: { line: () => '> ' },
    ul: { line: () => '- ' },
    ol: { line: (index) => `${index + 1}. ` },
    task: { line: () => '- [ ] ' },
    hr: { line: () => '--- ' },
    h2: { line: () => '## ' },
    h3: { line: () => '### ' },
    link: { wrap: ['[', '](https://)', '链接文字'] },
    mention: { wrap: ['@', '', ''] },
  };

const draftKey = (personId: string): string => `hydwind:bio-draft:${personId}`;

const readDraft = (personId: string): string | null => {
  try {
    return window.localStorage.getItem(draftKey(personId));
  } catch {
    return null;
  }
};

const writeDraft = (personId: string, value: string): void => {
  try {
    if (value.trim()) window.localStorage.setItem(draftKey(personId), value);
    else window.localStorage.removeItem(draftKey(personId));
  } catch {
    /* 隐私模式下 localStorage 会抛错，写不进去就算了，正文照常能写 */
  }
};

const clearDraft = (personId: string): void => {
  try {
    window.localStorage.removeItem(draftKey(personId));
  } catch {
    /* 同上 */
  }
};

export const initBiography = (): void => {
  const root = document.querySelector<HTMLElement>('[data-biography]');
  if (!root) return;

  const personId = root.dataset.personId ?? '';
  if (!personId) return;

  const bodyHost = root.querySelector<HTMLElement>('[data-bio-body]');
  const emptyHost = root.querySelector<HTMLElement>('[data-bio-empty]');
  const metaHost = root.querySelector<HTMLElement>('[data-bio-meta]');
  const noteHost = root.querySelector<HTMLElement>('[data-bio-note]');
  const signinEntry = root.querySelector<HTMLElement>('[data-bio-entry="signin"]');
  const editButton = root.querySelector<HTMLButtonElement>('[data-bio-entry="edit"]');
  const form = root.querySelector<HTMLFormElement>('[data-bio-editor]');
  const input = root.querySelector<HTMLTextAreaElement>('[data-bio-input]');
  const status = root.querySelector<HTMLElement>('[data-bio-status]');
  const submit = root.querySelector<HTMLButtonElement>('[data-bio-submit]');
  const cancel = root.querySelector<HTMLButtonElement>('[data-bio-cancel]');
  const counter = root.querySelector<HTMLElement>('[data-bio-count]');
  const refCount = root.querySelector<HTMLElement>('[data-bio-ref-count]');
  const picked = root.querySelector<HTMLElement>('[data-bio-picked]');
  const search = root.querySelector<HTMLInputElement>('[data-bio-ref-search]');
  const refList = root.querySelector<HTMLElement>('[data-bio-ref-list]');
  const refEmpty = root.querySelector<HTMLElement>('[data-bio-refs-empty]');
  const panes = root.querySelector<HTMLElement>('[data-bio-panes]');
  const previewBody = root.querySelector<HTMLElement>('[data-bio-preview-body]');
  const previewEmpty = root.querySelector<HTMLElement>('[data-bio-preview-empty]');
  const editorHost = root.querySelector<HTMLElement>('[data-bio-editor-host]');
  const focusToggle = root.querySelector<HTMLButtonElement>('[data-bio-focus]');
  const tocList = root.querySelector<HTMLElement>('[data-bio-toc-list]');
  const readMeta = root.querySelector<HTMLElement>('[data-bio-read]');

  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[data-bio-view]')];
  const tools = [...root.querySelectorAll<HTMLButtonElement>('[data-bio-cmd]')];
  const chips = [...root.querySelectorAll<HTMLButtonElement>('[data-bio-mention]')];

  const maxRefs = Number(refCount?.dataset.max ?? 12) || 12;
  const maxLength = input?.maxLength && input.maxLength > 0 ? input.maxLength : 4000;
  const gameId = root.dataset.gameId ?? '';

  /** 游戏 ID → 人物 id：预览里把 `@` 变成人物链接，靠的是这张表 */
  const personByGameId = new Map<string, string>();
  for (const chip of chips) {
    const mention = chip.dataset.bioMention?.slice(1) ?? '';
    const person = chip.dataset.bioPerson ?? '';
    if (mention && person) personByGameId.set(mention, person);
  }

  let current: BiographyPayload | null = null;
  let signedIn = false;
  let canEdit = false;
  let renderedAt = '';
  let previewTimer: number | undefined;
  /** CodeMirror 实例：第一次点开编辑时才创建，读完一页就走的访客不为它付任何代价。 */
  let editor: MarkdownEditor | null = null;
  let editorLoading = false;

  const setStatus = (message: string, tone: 'error' | 'ok' = 'error'): void => {
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
  };

  /** 正文变成 refs：只留认得的玩家，顺序按出现位置。 */
  const refsOf = (body: string): BiographyRef[] =>
    parseMentions(body)
      .filter((id) => personByGameId.has(id))
      .map((id) => ({ personId: personByGameId.get(id) ?? id, gameId: id }));

  const renderBodyHtml = (body: string): string => renderBiographyHtml(body, refsOf(body));

  /**
   * 长文目录：只收 h2 / h3，粘在正文右侧。
   * 标题 id 在这里补，构建期渲染的 HTML 不用为此多带一份数据；
   * 小节少于两个就不显示 —— 三个字的传记不需要目录。
   */
  const buildToc = (): void => {
    if (!tocList || !bodyHost) return;
    const headings = [...bodyHost.querySelectorAll<HTMLElement>('h2, h3')];
    tocList.innerHTML = '';
    headings.forEach((heading, index) => {
      const id = `bio-section-${index + 1}`;
      heading.id = id;
      const link = document.createElement('a');
      link.className = 'bio-toc-link';
      link.dataset.depth = heading.tagName === 'H3' ? '3' : '2';
      link.href = `#${id}`;
      link.textContent = heading.textContent ?? '';
      tocList.append(link);
    });
    const toc = tocList.closest<HTMLElement>('[data-bio-toc]');
    if (toc) toc.hidden = headings.length < 2;
  };

  /** 字数与阅读时长：写在署名那一行，帮访客决定「现在读还是收藏」。 */
  const renderReadingMeta = (): void => {
    if (!readMeta) return;
    const text = current?.body ?? '';
    const chars = text.replace(/\s+/g, '').length;
    if (!chars) {
      readMeta.textContent = '';
      return;
    }
    readMeta.textContent = `${chars} 字 · 约 ${Math.max(1, Math.round(chars / 350))} 分钟读完`;
  };

  /** 正文只在内容真的变了时才重画，避免刷新接口回来闪一下。 */
  const render = (): void => {
    if (!bodyHost || !emptyHost || !metaHost) return;

    if (!current) {
      bodyHost.innerHTML = '';
      emptyHost.hidden = false;
      metaHost.hidden = true;
      metaHost.textContent = '';
      if (readMeta) readMeta.textContent = '';
      const toc = tocList?.closest<HTMLElement>('[data-bio-toc]');
      if (toc) toc.hidden = true;
      return;
    }

    const stamp = `${current.updatedAt}:${current.body.length}`;
    if (stamp !== renderedAt) {
      bodyHost.innerHTML = renderBodyHtml(current.body);
      renderedAt = stamp;
      buildToc();
    }
    renderReadingMeta();
    emptyHost.hidden = true;
    metaHost.hidden = false;
    metaHost.textContent =
      current.updatedAt === current.createdAt
        ? `${current.author} 写于 ${formatBiographyDate(current.createdAt)}`
        : `${current.author} 写于 ${formatBiographyDate(current.createdAt)}，最后改了 ${formatBiographyDate(current.updatedAt)}`;
  };

  /** 入口、空态文案、作者说明：全部由这一个函数决定，别在别处再改一次。 */
  const syncEntry = (): void => {
    if (editButton) {
      editButton.hidden = !canEdit;
      editButton.textContent = current ? '编辑这篇传记' : '写一篇传记';
    }
    if (signinEntry) signinEntry.hidden = signedIn;

    if (emptyHost && !current) {
      emptyHost.textContent = signedIn
        ? `还没有人给 ${gameId} 写传记，你可以写第一篇。`
        : `还没有人给 ${gameId} 写传记，登录后可以写第一篇。`;
    }

    if (noteHost) {
      const blocked = signedIn && !canEdit && current;
      noteHost.hidden = !blocked;
      noteHost.textContent = blocked
        ? '这篇传记只有作者本人和站务能改，想补充可以找站务。'
        : '';
    }
  };

  const renderPreview = (): void => {
    if (!input || !previewBody) return;
    const body = input.value.trim();
    previewBody.innerHTML = body ? renderBodyHtml(body) : '';
    if (previewEmpty) previewEmpty.hidden = body.length > 0;
  };

  const schedulePreview = (): void => {
    if (previewTimer !== undefined) window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => {
      previewTimer = undefined;
      renderPreview();
    }, 90);
  };

  /** 正文框跟着内容长高：手机上写完一段是一段，不用在小框里找光标。 */
  const autosize = (): void => {
    // CodeMirror 自己管高度，再按 scrollHeight 撑一次会把它算成无限长
    if (!input || editor) return;
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  };

  const syncCounter = (): void => {
    if (!counter || !input) return;
    const length = input.value.trim().length;
    counter.textContent = `${length} / ${maxLength}`;
    counter.dataset.state = length > maxLength ? 'over' : length >= 20 ? 'ok' : 'short';
  };

  const knownGameIds = new Map(chips.map((chip) => [chip.dataset.bioMention?.slice(1) ?? '', true]));

  /** 正文里的 @ 列举成可移除的标签，数量同步给上限提示。 */
  const syncPicked = (): void => {
    if (!input) return;
    const mentioned = parseMentions(input.value).filter((id) => knownGameIds.has(id));

    if (refCount) {
      refCount.textContent = `已引用 ${mentioned.length} / ${maxRefs}`;
      refCount.dataset.state = mentioned.length > maxRefs ? 'over' : mentioned.length > 0 ? 'ok' : '';
    }

    if (!picked) return;
    picked.innerHTML = '';
    picked.hidden = mentioned.length === 0;
    for (const id of mentioned) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'bio-picked-chip';
      chip.dataset.bioRemove = id;
      chip.innerHTML = `<span>@${id}</span><span aria-hidden="true">×</span>`;
      chip.setAttribute('aria-label', `移除对 ${id} 的引用`);
      picked.append(chip);
    }
  };

  /** 每次改完正文都要走这一趟：字数、引用、预览、草稿、高度。 */
  const afterEdit = (): void => {
    if (!input) return;
    syncCounter();
    syncPicked();
    schedulePreview();
    autosize();
    writeDraft(personId, input.value);
    setStatus('');
  };

  const selection = (): { value: string; start: number; end: number } => {
    if (editor) return editor.getSelection();
    const value = input?.value ?? '';
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? start;
    return { value, start, end };
  };

  /**
   * 唯一一处「写回正文」。
   * 编辑器就位后由 CodeMirror 派发变更（撤销历史保住），变更再经 updateListener
   * 把值同步回 textarea —— 表单提交、字数、草稿仍然只认那一份 value。
   */
  const commit = (value: string, caretStart: number, caretEnd: number): void => {
    if (editor) {
      editor.setValue(value, caretStart, caretEnd);
      editor.focus();
      return;
    }
    if (!input) return;
    input.value = value;
    input.focus();
    input.setSelectionRange(caretStart, caretEnd);
    afterEdit();
  };

  const wrapSelection = (before: string, after: string, placeholder: string): void => {
    const { value, start, end } = selection();
    const inner = value.slice(start, end) || placeholder;
    const insert = `${before}${inner}${after}`;
    const from = start + before.length;
    commit(`${value.slice(0, start)}${insert}${value.slice(end)}`, from, from + inner.length);
  };

  /** 只动选中的那几行：加前缀、换标题层级都走这里，行内位置不会丢。 */
  const updateLines = (mapper: (line: string, index: number) => string): void => {
    const { value, start, end } = selection();
    const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    const breakAt = value.indexOf('\n', end);
    const lineEnd = breakAt === -1 ? value.length : breakAt;
    const block = value.slice(lineStart, lineEnd);
    const next = block
      .split('\n')
      .map((line, index) => mapper(line, index))
      .join('\n');
    commit(`${value.slice(0, lineStart)}${next}${value.slice(lineEnd)}`, lineStart, lineStart + next.length);
  };

  const prefixLines = (lineFor: (index: number) => string): void =>
    updateLines((line, index) => `${lineFor(index)}${line}`);

  const toggleHeading = (): void => {
    updateLines((line) => (line.startsWith('## ') ? line.slice(3) : `## ${line.replace(/^#{1,6}\s+/, '')}`));
  };

  const insertLink = (): void => {
    const { value, start, end } = selection();
    const label = value.slice(start, end) || '链接文字';
    const insert = `[${label}](https://)`;
    const urlFrom = start + label.length + 3;
    commit(`${value.slice(0, start)}${insert}${value.slice(end)}`, urlFrom, urlFrom + 8);
  };

  const runCommand = (command: Command): void => {
    if (command === 'link') {
      insertLink();
      return;
    }
    if (command === 'h2') {
      toggleHeading();
      return;
    }
    if (command === 'table') {
      const { value, start, end } = selection();
      const table = ['| 小标题 | 想到的事 |', '| --- | --- |', '|  |  |'].join('\n');
      const insert = `\n${table}\n`;
      const caret = start + insert.length;
      commit(`${value.slice(0, start)}${insert}${value.slice(end)}`, caret, caret);
      return;
    }
    const spec = COMMANDS[command];
    if (spec.wrap) wrapSelection(spec.wrap[0], spec.wrap[1], spec.wrap[2]);
    else if (spec.line) prefixLines(spec.line);
  };

  const setView = (view: ViewMode): void => {
    if (panes) panes.dataset.view = view;
    for (const tab of tabs) {
      const active = tab.dataset.bioView === view;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    }
    if (view === 'preview') renderPreview();
  };

  /**
   * 把 textarea 换成 CodeMirror。
   *
   * textarea 不删，只藏起来：它仍然是「值的中转站」—— 表单提交、字数统计、草稿
   * 全都还读 `input.value`，编辑器每次变更都往回写一份。这样就算 CodeMirror 因为
   * 任何原因没起来，退回原生 textarea 也照样能写完保存。
   */
  const mountEditor = async (): Promise<boolean> => {
    if (editor) return true;
    if (editorLoading || !input || !editorHost) return false;
    editorLoading = true;
    try {
      // 编辑器只在有人真要写的时候才下载：读完一页就走的访客不该为它付流量
      const { createMarkdownEditor } = await import('./markdown-editor');
      editor = createMarkdownEditor(editorHost, {
        value: input.value,
        placeholder: input.placeholder,
        maxLength,
        onChange: () => {
          if (!input || !editor) return;
          input.value = editor.getValue();
          afterEdit();
        },
        onSave: () => form?.requestSubmit(),
      });
      form?.classList.add('is-enhanced');
      return true;
    } catch {
      editor = null;
      form?.classList.remove('is-enhanced');
      return false;
    } finally {
      editorLoading = false;
    }
  };

  const setFocusMode = (on: boolean): void => {
    if (!form || !focusToggle) return;
    form.classList.toggle('is-focus', on);
    focusToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
    focusToggle.setAttribute('aria-label', on ? '退出专注模式' : '进入专注模式');
    document.documentElement.classList.toggle('is-bio-focus', on);
    if (on) editor?.focus();
  };

  const openEditor = async (): Promise<void> => {
    if (!form || !input) return;
    const saved = current?.body ?? '';
    const draft = readDraft(personId);
    const restored = draft !== null && draft.trim() !== saved.trim();
    input.value = restored ? draft : saved;
    form.hidden = false;
    editButton?.setAttribute('hidden', '');
    setStatus(restored ? '已恢复上次没保存的草稿' : '', restored ? 'ok' : 'error');
    setView('edit');
    syncCounter();
    syncPicked();
    renderPreview();
    autosize();

    if ((await mountEditor()) && editor) {
      editor.setValue(input.value, input.value.length, input.value.length);
      editor.focus();
    } else {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
    form.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  const closeEditor = (): void => {
    if (!form) return;
    setFocusMode(false);
    form.hidden = true;
    setStatus('');
    syncEntry();
  };

  const filterChips = (): void => {
    if (!search || !refList) return;
    const query = search.value.trim().toLowerCase();
    let shown = 0;
    for (const chip of chips) {
      const key = chip.dataset.bioKey ?? '';
      const hit = query === '' || key.includes(query);
      chip.hidden = !hit;
      if (hit) shown += 1;
    }
    if (refEmpty) refEmpty.hidden = shown > 0;
  };

  editButton?.addEventListener('click', openEditor);
  cancel?.addEventListener('click', () => {
    if (input) writeDraft(personId, input.value.trim() === (current?.body ?? '').trim() ? '' : input.value);
    closeEditor();
  });
  search?.addEventListener('input', filterChips);

  for (const tool of tools) {
    tool.addEventListener('click', () => {
      const command = tool.dataset.bioCmd;
      if (!command) return;
      // 撤销 / 重做只有编辑器能提供真正的历史栈，textarea 那版没有这个能力
      if (command === 'undo' || command === 'redo') {
        if (editor) command === 'undo' ? editor.undo() : editor.redo();
        return;
      }
      runCommand(command as Command);
    });
  }

  focusToggle?.addEventListener('click', () => {
    setFocusMode(!form?.classList.contains('is-focus'));
  });

  // Esc 退出专注模式：手机上全屏写作时，需要一个不用瞄准的出口
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && form?.classList.contains('is-focus')) {
      event.preventDefault();
      setFocusMode(false);
    }
  });

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      const view = tab.dataset.bioView === 'preview' ? 'preview' : 'edit';
      setView(view);
      if (view === 'edit') {
        if (editor) editor.focus();
        else input?.focus();
      }
    });
  }

  // 候选按钮：插到光标处，不打断正在写的位置
  for (const chip of chips) {
    chip.addEventListener('click', () => {
      if (!input) return;
      const mention = chip.dataset.bioMention ?? '';
      const { value, start, end } = selection();
      const before = value.slice(0, start);
      const spacer = before === '' || /\s$/.test(before) ? '' : ' ';
      const insert = `${spacer}${mention} `;
      const caret = before.length + insert.length;
      commit(`${before}${insert}${value.slice(end)}`, caret, caret);
    });
  }

  // 已引用标签上的 × ：把那条 @ 从正文里删掉
  picked?.addEventListener('click', (event) => {
    const target = (event.target as Element | null)?.closest<HTMLElement>('[data-bio-remove]');
    const id = target?.dataset.bioRemove;
    if (!id || !input) return;

    const next = input.value
      .replace(createMentionPattern(), (match: string, mentioned: string) =>
        mentioned === id ? '' : match
      )
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .trimStart();
    const caret = next.length;
    commit(next, caret, caret);
  });

  input?.addEventListener('input', afterEdit);

  input?.addEventListener('keydown', (event) => {
    if (event.isComposing) return;

    if (event.metaKey || event.ctrlKey) {
      const key = event.key.toLowerCase();
      if (key === 'b' || key === 'i' || key === 'k') {
        event.preventDefault();
        runCommand(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'link');
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        form?.requestSubmit();
      }
      return;
    }

    // 列表 / 引用里回车自动续上标记；空条目再回车就退出，不用手动删那个「-」
    if (event.key !== 'Enter' || event.shiftKey || event.altKey) return;

    const { value, start, end } = selection();
    if (start !== end) return;

    const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    const line = value.slice(lineStart, start);
    const bullet = /^(\s*)([-*+])\s+/.exec(line);
    const numbered = /^(\s*)(\d{1,9})([.)])\s+/.exec(line);
    const quote = /^(\s*)>\s?/.exec(line);
    if (!bullet && !numbered && !quote) return;

    event.preventDefault();
    const content = line.replace(/^\s*(?:[-*+]|\d{1,9}[.)]|>)\s+/, '').trim();

    if (content === '') {
      commit(`${value.slice(0, lineStart)}${value.slice(start)}`, lineStart, lineStart);
      return;
    }

    const marker = bullet
      ? `${bullet[1]}${bullet[2]} `
      : numbered
        ? `${numbered[1]}${Number(numbered[2]) + 1}${numbered[3]} `
        : `${quote?.[1] ?? ''}> `;
    const insert = `\n${marker}`;
    const caret = start + insert.length;
    commit(`${value.slice(0, start)}${insert}${value.slice(end)}`, caret, caret);
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!input || !submit) return;

    const body = input.value.trim();
    if (body.length < 20) {
      setStatus('至少写 20 个字，多留一点故事给后面的人看');
      input.focus();
      return;
    }
    if (body.length > maxLength) {
      setStatus(`正文最多 ${maxLength} 个字，先删一点`);
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
      const payload = (await response.json().catch(() => ({}))) as BiographyResponse;

      if (!response.ok) {
        setStatus(payload.error ?? `保存失败（${response.status}）`);
        return;
      }

      current = payload.biography ?? current;
      canEdit = true;
      renderedAt = '';
      clearDraft(personId);
      render();
      closeEditor();
      syncEntry();
      setStatus(payload.message ?? '传记保存好了', 'ok');
      window.hydwindToast?.('传记已保存');
    } catch {
      setStatus('网络不太顺，稍后再试一次');
    } finally {
      submit.disabled = false;
      syncEntry();
    }
  });

  const load = async (): Promise<void> => {
    try {
      const response = await fetch(`/api/people/${encodeURIComponent(personId)}/biography`, {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
      });
      if (!response.ok) return;

      const payload = (await response.json()) as BiographyResponse;
      signedIn = Boolean(payload.signedIn);
      canEdit = Boolean(payload.canEdit);
      // 接口这次没带传记、页面却有构建期的内容时，保留页面上的那份
      if (payload.biography !== undefined && payload.biography !== null) {
        current = payload.biography;
      }
    } catch {
      /* 拉不到就用构建期的那份 HTML，页面照常可读 */
    }
    render();
    syncEntry();
    syncCounter();
    syncPicked();
  };

  void load();
};
