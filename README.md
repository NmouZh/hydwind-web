# Hydwind 生存服官网

已将原「服务器名称」模板重命名为 **Hydwind**（品牌双色：Hyd 蓝 / wind 红，与 Logo 一致），并把原来塞在单页里的所有板块拆分成独立分页。

## 页面结构

| 页面 | 文件 | 内容 |
|------|------|------|
| 首页 | `index.html` | Hero 横幅 + 服务器概览卡片 |
| 玩法 | `pages/features.html` | 玩法展示 + 服务器节奏数据 |
| 风景 | `pages/scenery.html` | 服务器风景图集 |
| 公告 | `pages/news.html` | 最新公告列表 |
| 加入 | `pages/join.html` | 服务器地址 + 加入步骤（含一键复制） |
| 社群 | `pages/community.html` | 交流群 + 二维码 |
| 问答 | `pages/faq.html` | 常见问题 |
| 规则 | `pages/rules.html` | 服务器规则 |
| 地图 | `pages/world.html` | 世界地图 + 坐标 |
| 支持 | `pages/support.html` | 支持服务器 |

所有页面共用统一顶部导航（移动端折叠菜单）与页脚，当前页高亮。

## 修改服务器信息

编辑 `scripts/site-data.js`：服务器地址、在线人数、版本、概览/玩法/公告/FAQ 等内容都在这里，改完刷新即生效。

## 部署到 Vercel

### 方式一：网页拖拽上传（最快，约 1 分钟）

1. 打开 [vercel.com/new](https://vercel.com/new) 并登录（可用 GitHub 账号）。
2. 页面下方找到 **"Deploy without Git" / 其他部署方式**，或直接访问 [vercel.com/new/clone](https://vercel.com)。
3. 更简单的做法：把 `hydwind-site-deploy.zip` **解压**，然后将 `hydwind-site` 文件夹直接拖进 Vercel 控制台的部署入口（[vercel.com/new](https://vercel.com/new) 页面支持拖拽静态站点）。
4. 部署完成后会得到 `xxx.vercel.app` 的访问链接。

> 拖拽入口不明显时可用方式二，成功率 100%。

### 方式二：Vercel CLI

```bash
npm i -g vercel
cd hydwind-site
vercel login          # 浏览器确认登录
vercel --prod         # 部署到生产环境
```

按提示回车使用默认设置即可（纯静态站，无需任何配置）。

### 方式三：GitHub 自动部署（推荐长期使用）

1. 把 `hydwind-site` 文件夹推送到 GitHub 仓库。
2. 在 [vercel.com/new](https://vercel.com/new) 导入该仓库，直接点 Deploy。
3. 之后每次 `git push`，Vercel 会自动更新网站。

## 本地预览

```bash
cd hydwind-site
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080
```
