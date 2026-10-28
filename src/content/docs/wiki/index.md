---
title: Hydwind Wiki
description: Hydwind 生存服的官方知识库：加入流程、服务器规则、世界地图与玩法机制。
sidebar:
  order: 0
---

Hydwind 是一个以城市、建筑与长期生存为核心的 Minecraft Java 服务器。这里是它的官方知识库，
所有条目都以 Markdown 维护在仓库中，改完推送即发布，没有后台数据库。

## 从哪里开始

<div class="hw-cards">
  <a class="hw-card" href="/wiki/start/join/">
    <span class="hw-card-idx">01</span>
    <strong>加入服务器</strong>
    <span>版本要求、客户端准备、首次进服流程。</span>
  </a>
  <a class="hw-card" href="/wiki/rules/">
    <span class="hw-card-idx">02</span>
    <strong>服务器规则</strong>
    <span>建筑、交易、红石与社群的边界，共四节。</span>
  </a>
  <a class="hw-card" href="/wiki/world/map/">
    <span class="hw-card-idx">03</span>
    <strong>世界与坐标</strong>
    <span>主城、市场、资源世界门的坐标速览。</span>
  </a>
  <a class="hw-card" href="/orgs/">
    <span class="hw-card-idx">04</span>
    <strong>公开组织</strong>
    <span>城镇、公会与建设团体，含招募状态。</span>
  </a>
</div>

## 服务器速览

| 项目 | 内容 |
| --- | --- |
| 版本 | Java 1.21.x（原版生存 + 少量辅助插件） |
| 地址 | `play.hydwind.com` |
| 周目 | 第八周目，主世界长期保留 |
| 定位 | 城市与建筑为核心，半公益，不做数值付费 |

## 这份 Wiki 的维护方式

- 每篇文档对应 `src/content/docs/wiki/` 下的一个 Markdown 文件。
- 侧边栏、目录、全文搜索都由 **Starlight** 自动生成，不需要手写导航。
- 组织与玩家档案是另外两类内容，使用内容集合（Content Collections）管理，字段由 schema 校验。
- 如果你只想改文字，直接在 GitHub 网页上编辑对应 `.md` 文件即可，提交后站点会自动重建。

:::note[关于占位内容]
服务器地址、在线人数、周目名称等仍为示例值，换成真实信息后即可对外发布。
:::

<style>
  .hw-cards {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0;
    margin: 1.8em 0 2.2em;
    border-top: 1px solid var(--hw-line);
    border-left: 1px solid var(--hw-line);
  }

  .hw-card {
    display: flex;
    flex-direction: column;
    gap: 0.5em;
    padding: 1.15rem 1.1rem;
    border-right: 1px solid var(--hw-line);
    border-bottom: 1px solid var(--hw-line);
    background: #0b0d10;
    text-decoration: none !important;
    transition: background 0.2s ease;
  }

  .hw-card:hover {
    background: #111419;
  }

  .hw-card-idx {
    font-family: var(--hw-font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.18em;
    color: var(--hw-accent);
  }

  .hw-card strong {
    font-family: var(--hw-font-serif);
    font-size: 1.05rem;
    color: #f2f0ec;
  }

  .hw-card span:last-child {
    font-size: 0.82rem;
    line-height: 1.7;
    color: #8f959d;
  }
</style>
