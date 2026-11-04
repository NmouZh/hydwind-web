/**
 * 传记正文的 Markdown 编辑器内核（CodeMirror 6 的一层薄封装）。
 *
 * 为什么要单独一个文件：
 * - `scripts/biography.ts` 负责接口、草稿、引用和保存这些「业务」；
 * - 这里只管「把一段 Markdown 编辑得舒服」——光标、选区、撤销、快捷键、工具栏命令。
 *   两件事混在一个文件里，改编辑器的时候很容易碰到保存逻辑。
 *
 * 几条自己定下的规矩：
 * 1. 不做所见即所得。正文就是 Markdown 源码，发布后长什么样由 `renderMarkdown` 决定，
 *    预览和成品共用同一份渲染器，所以「预览对了、发出去不对」这种坑不存在。
 * 2. 工具栏命令一律走「包一层 / 加行前缀」两条路，跟旧版 textarea 的语义完全一致，
 *    换编辑器不会让保存下来的正文格式变样。
 * 3. 手机上字号钉在 16px：iOS 对 focus 时字号小于 16px 的输入框会自动放大页面，
 *    一放大就很难回到原来的排版。
 */

import {
  EditorView,
  keymap,
  placeholder as placeholderExt,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
  rectangularSelection,
  crosshairCursor,
} from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  undo,
} from '@codemirror/commands';
import {
  deleteMarkupBackward,
  insertNewlineContinueMarkup,
  markdown,
} from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { tags } from '@lezer/highlight';

/** 工具栏能发的命令。和页面上按钮的 `data-bio-cmd` 一一对应。 */
export type EditorCommand =
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
  | 'link'
  | 'table'
  | 'hr';

export interface EditorSelection {
  value: string;
  start: number;
  end: number;
}

export interface MarkdownEditorOptions {
  value: string;
  placeholder: string;
  maxLength: number;
  /** 内容变了（打字、命令、撤销都算）。调用方在这里同步字数、预览和草稿。 */
  onChange: () => void;
  /** Ctrl / ⌘ + Enter：交给调用方去提交表单。 */
  onSave: () => void;
}

export interface MarkdownEditor {
  getValue: () => string;
  getSelection: () => EditorSelection;
  /** 整段替换并指定新选区，保留撤销历史（工具栏命令都走这里）。 */
  setValue: (value: string, start: number, end: number) => void;
  exec: (command: EditorCommand) => void;
  insertText: (text: string) => void;
  undo: () => void;
  redo: () => void;
  focus: () => void;
  destroy: () => void;
}

/**
 * 主题全部用站里的 CSS 变量，换配色时不用回来改这份 TS。
 * 编辑器本体不给边框和背景：外框由页面上的 `.bio-input-shell` 画，
 * 这样编辑器嵌进卡片、抽屉还是全屏，样式都不用重写。
 */
const editorTheme = EditorView.theme({
  '&': {
    fontSize: '1rem',
    color: 'var(--md-sys-color-on-surface)',
    backgroundColor: 'transparent',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--md-sys-typescale-font)',
    lineHeight: '1.85',
    padding: 'var(--hw-space-3) 0',
    overflowY: 'auto',
  },
  '.cm-content': {
    padding: '0 var(--hw-space-4)',
    caretColor: 'var(--md-sys-color-primary)',
  },
  '.cm-line': { padding: '0' },
  '.cm-placeholder': { color: 'var(--md-sys-color-on-surface-variant)', opacity: '0.75' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    border: 'none',
    color: 'var(--md-sys-color-on-surface-variant)',
    fontSize: '0.75rem',
    paddingLeft: 'var(--hw-space-2)',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--md-sys-color-primary)' },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--md-sys-color-primary) 22%, transparent)',
  },
  '.cm-cursor': { borderLeftColor: 'var(--md-sys-color-primary)' },
  '.cm-selectionMatch': {
    backgroundColor: 'color-mix(in srgb, var(--md-sys-color-tertiary) 22%, transparent)',
  },
  '.cm-matchingBracket': {
    backgroundColor: 'color-mix(in srgb, var(--md-sys-color-primary) 18%, transparent)',
    outline: 'none',
  },
});

/**
 * Markdown 语法着色。
 * 只给「写的时候有用」的部分上色：标题、强调、代码、链接、引用。
 * 正文本身保持默认颜色，不然满屏彩色反而看不清自己在写什么。
 */
const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: '700', fontSize: '1.3em', color: 'var(--md-sys-color-on-surface)' },
  { tag: tags.heading2, fontWeight: '700', fontSize: '1.15em', color: 'var(--md-sys-color-on-surface)' },
  { tag: tags.heading3, fontWeight: '600', color: 'var(--md-sys-color-on-surface)' },
  { tag: tags.strong, fontWeight: '700', color: 'var(--md-sys-color-on-surface)' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--md-sys-color-primary)' },
  { tag: tags.url, color: 'var(--md-sys-color-primary)', textDecoration: 'underline' },
  { tag: tags.monospace, color: 'var(--md-sys-color-tertiary)' },
  { tag: tags.quote, color: 'var(--md-sys-color-on-surface-variant)' },
  { tag: tags.processingInstruction, color: 'var(--md-sys-color-outline)' },
  { tag: tags.contentSeparator, color: 'var(--md-sys-color-outline)' },
]);

export const createMarkdownEditor = (
  parent: HTMLElement,
  options: MarkdownEditorOptions
): MarkdownEditor => {
  /** 每次命令都从这里取最新视图，避免闭包里拿到已经被销毁的实例。 */
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: options.value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        crosshairCursor(),
        EditorState.allowMultipleSelections.of(true),
        EditorView.lineWrapping,
        markdown(),
        syntaxHighlighting(markdownHighlight),
        highlightSelectionMatches(),
        placeholderExt(options.placeholder),
        EditorView.contentAttributes.of({ 'aria-label': '传记正文', spellcheck: 'false' }),
        /**
         * 长度上限沿用 textarea 的 maxlength 语义：超了直接拒绝这次输入。
         * 拦截点放在 `EditorState.changeFilter`，撤销、粘贴、输入法上屏都会被它挡住。
         */
        EditorState.changeFilter.of((transaction) =>
          transaction.newDoc.length <= options.maxLength
        ),
        keymap.of([
          // Ctrl/⌘ + B/I/K：和页面上按钮同一套命令，记忆成本一份
          {
            key: 'Mod-b',
            run: () => (execCommand('bold'), true),
          },
          {
            key: 'Mod-i',
            run: () => (execCommand('italic'), true),
          },
          {
            key: 'Mod-k',
            run: () => (execCommand('link'), true),
          },
          {
            key: 'Mod-Enter',
            run: () => (options.onSave(), true),
          },
          // 列表里回车自动续标记、空条目回车退出：写长清单不靠手打字
          { key: 'Enter', run: insertNewlineContinueMarkup },
          { key: 'Backspace', run: deleteMarkupBackward },
          ...searchKeymap,
          ...historyKeymap,
          ...defaultKeymap,
          indentWithTab,
        ]),
        editorTheme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) options.onChange();
        }),
      ],
    }),
  });

  const selection = (): EditorSelection => {
    const { from, to } = view.state.selection.main;
    return { value: view.state.doc.toString(), start: from, end: to };
  };

  /** 整段替换：用一次 dispatch 覆盖全文，撤销历史不会被清空。 */
  const setValue = (value: string, start: number, end: number): void => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      selection: { anchor: start, head: end },
      scrollIntoView: true,
    });
  };

  /** 在光标处包一层标记；没有选中就把占位词选中，方便直接改写。 */
  const wrapSelection = (before: string, after: string, sample: string): void => {
    const { value, start, end } = selection();
    const inner = value.slice(start, end) || sample;
    const from = start + before.length;
    setValue(
      `${value.slice(0, start)}${before}${inner}${after}${value.slice(end)}`,
      from,
      from + inner.length
    );
  };

  /** 只动选中的那几行：换行前缀都走这里，行内光标位置不会丢。 */
  const mapLines = (mapper: (line: string, index: number) => string): void => {
    const { value, start, end } = selection();
    const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    const breakAt = value.indexOf('\n', end);
    const lineEnd = breakAt === -1 ? value.length : breakAt;
    const next = value
      .slice(lineStart, lineEnd)
      .split('\n')
      .map((line, index) => mapper(line, index))
      .join('\n');
    setValue(
      `${value.slice(0, lineStart)}${next}${value.slice(lineEnd)}`,
      lineStart,
      lineStart + next.length
    );
  };

  /** 前缀是「切换」而不是「叠加」：再点一次就把这一行的标记收回去。 */
  const togglePrefix = (prefix: string, pattern: RegExp): void => {
    mapLines((line) =>
      pattern.test(line) ? line.replace(pattern, '') : `${prefix}${line.replace(/^\s+/, '')}`
    );
  };

  const execCommand = (command: EditorCommand): void => {
    switch (command) {
      case 'bold':
        wrapSelection('**', '**', '加粗');
        return;
      case 'italic':
        wrapSelection('*', '*', '斜体');
        return;
      case 'strike':
        wrapSelection('~~', '~~', '删除');
        return;
      case 'code':
        wrapSelection('`', '`', '代码');
        return;
      case 'link': {
        const { value, start, end } = selection();
        const label = value.slice(start, end) || '链接文字';
        const insert = `[${label}](https://)`;
        const urlFrom = start + label.length + 3;
        setValue(`${value.slice(0, start)}${insert}${value.slice(end)}`, urlFrom, urlFrom + 8);
        return;
      }
      case 'h2':
        togglePrefix('## ', /^##\s+/);
        return;
      case 'h3':
        togglePrefix('### ', /^###\s+/);
        return;
      case 'quote':
        togglePrefix('> ', /^>\s+/);
        return;
      case 'ul':
        togglePrefix('- ', /^[-*+]\s+/);
        return;
      case 'task':
        togglePrefix('- [ ] ', /^[-*+]\s+\[[ xX]\]\s+/);
        return;
      case 'ol':
        mapLines((line, index) => line.replace(/^\s*\d{1,9}[.)]\s+/, index === 0 ? '1. ' : `${index + 1}. `));
        return;
      case 'table': {
        const { value, start, end } = selection();
        const table = ['| 小标题 | 想到的事 |', '| --- | --- |', '|  |  |'].join('\n');
        const insert = `\n${table}\n`;
        setValue(`${value.slice(0, start)}${insert}${value.slice(end)}`, start + insert.length, start + insert.length);
        return;
      }
      case 'hr': {
        const { value, start, end } = selection();
        const insert = '\n---\n';
        setValue(`${value.slice(0, start)}${insert}${value.slice(end)}`, start + insert.length, start + insert.length);
        return;
      }
      default:
        return;
    }
  };

  /** 引用候选按钮：插到光标处，顺手补一个空格，别把上一句话黏住。 */
  const insertText = (text: string): void => {
    const { value, start, end } = selection();
    const before = value.slice(0, start);
    const spacer = before === '' || /\s$/.test(before) ? '' : ' ';
    const insert = `${spacer}${text} `;
    const caret = before.length + insert.length;
    setValue(`${before}${insert}${value.slice(end)}`, caret, caret);
  };

  return {
    getValue: () => view.state.doc.toString(),
    getSelection: selection,
    setValue,
    exec: execCommand,
    insertText,
    undo: () => void undo(view),
    redo: () => void redo(view),
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
};
