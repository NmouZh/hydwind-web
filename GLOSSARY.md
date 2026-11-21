# Hydwind 官网

氢风（Hydwind）生存服官网的领域词汇与内容约定。后端接口与存储实现在独立仓库 `hydwind-api`，插件侧词汇见 `hydwind-gate` 的 GLOSSARY。

## 名称

**氢风（Hydwind）**:
本站服务的 Minecraft Java 生存服务器。中文正文写作“氢风”，英文品牌与代码标识写作“Hydwind”。
_Avoid_: Hydrogen Wind

## 离线服务器

**离线服务器（offline-mode server）**:
不要求 Mojang 正版验证的 Minecraft Java 服务器。玩家用任意客户端用户名即可进入。
_Avoid_: 盗版服

## 测试期

**测试期（testing period）**:
服务器正式稳定开放前的筹备阶段。期间世界可能重置，版本、收费与安排都可能调整。
_Avoid_: 正式服、长期服

## 游戏 ID

**游戏 ID（game ID）**:
Minecraft 玩家名，同时也是账号用户名与人物传记的归属键；只含字母、数字、下划线，3–16 位，比较时忽略大小写。
_Avoid_: 用户名、昵称

## 账号

**账号（account）**:
站点的登录身份，用户名即游戏 ID；只由群内机器人在注册时发放，站点不开放自助注册。
_Avoid_: 会员、注册用户

## 会话

**会话（session）**:
登录后由 `hydwind-api` 下发的 `hydwind_session` 签名 cookie，30 天有效；Web 只负责转发，不解析。
_Avoid_: JWT、服务端会话表

## 登录码

**登录码（login code）**:
`/gate` 页面展示的一次性进服凭证，由颜文字码与 ASCII 备用码（`HWG-XXXX` 形态）组成；5 分钟内有效，验证任意一个都会作废整条记录。
_Avoid_: 验证码、密码

## 进服验证

**进服验证（gate）**:
登录网站账号后在 `/gate` 获取登录码、粘贴进游戏内登录对话框以解除角色冻结的流程；码由 HydwindGate 插件校验。
_Avoid_: 白名单、正版验证

## 议题

**议题（issue）**:
玩家提交的 bug / 建议 / 其他，先进入待审，过审后才公开；状态为 `pending` / `open` / `rejected` / `done`。
_Avoid_: 工单、反馈板

## 站务

**站务（staff）**:
服务器的管理成员。审核议题、修改他人传记、删除评论的权限由 `hydwind-api` 按账号角色与令牌判定，Web 只展示判定结果。
_Avoid_: 客服、版主

## 人物传记

**人物传记（biography）**:
按游戏 ID 一人一篇的个人页面：静态人物来自内容集合，运行期传记（主标题 + 正文 + 评论）由本人与站务编辑，登录玩家可评论。
_Avoid_: 玩家排行榜、成员名单

## 静态人物

**静态人物（static person）**:
`src/content/people/*.md` 里人工维护的人物资料；人物列表与详情页把它和注册账号合并展示，URL 沿用内容 entry id。
_Avoid_: 官方人物、样板人物

## 指南

**指南（Wiki guide）**:
`src/content/guides` 下的 Wiki 页面，一个 Markdown 文件就是一页，文件名即 URL slug。
_Avoid_: 教程、公告
