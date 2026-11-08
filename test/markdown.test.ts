import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderMarkdown } from '../src/lib/markdown.ts';
import { renderBiographyHtml } from '../src/lib/biography-text.ts';

test('Markdown 先转义 HTML，不执行原始标签', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('危险链接协议降级为纯文本', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'vbscript:x']) {
    const html = renderMarkdown(`[点我](${url})`);
    assert.ok(!html.includes('href='), `不应生成链接：${url}`);
    assert.ok(html.includes('点我'));
  }
});

test('协议相对与反斜杠链接不当作站内路径', () => {
  for (const url of ['//evil.example/x', '/\\evil.example/x']) {
    const html = renderMarkdown(`[点我](${url})`);
    assert.ok(!html.includes('href='), `不应生成链接：${url}`);
  }
});

test('正常站内、锚点与 https 链接保留', () => {
  const html = renderMarkdown(
    '[站内](/people/x/) [锚点](#top) [外链](https://example.com/a?b=1)'
  );
  assert.ok(html.includes('href="/people/x/"'));
  assert.ok(html.includes('href="#top"'));
  assert.ok(html.includes('href="https://example.com/a?b=1"'));
  assert.ok(html.includes('rel="nofollow noopener noreferrer"'));
});

test('@提及只链接到已知人物', () => {
  const html = renderBiographyHtml('你好 @Alice，@Nobody', [
    { gameId: 'Alice', personId: 'alice' },
  ]);
  assert.ok(html.includes('href="/people/alice/"'));
  assert.ok(html.includes('@Nobody'));
  assert.ok(!html.includes('/people/nobody/'));
});

test('超深列表嵌套不会栈溢出', () => {
  const lines = Array.from({ length: 200 }, (_, index) => `${'  '.repeat(index)}- item`);
  assert.doesNotThrow(() => renderMarkdown(lines.join('\n')));
});
