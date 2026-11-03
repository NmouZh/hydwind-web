# 字体与许可证

站点字体全部自托管在 `public/fonts/`，`src/styles/fonts.css` 生成对应的 `@font-face`，
字体族顺序为 `Rubik`（拉丁与数字）→ `MiSans`（中文）→ 系统字体。

| 字体 | 用途 | 字重 | 来源 | 许可证 |
| --- | --- | --- | --- | --- |
| MiSans | 中文正文与标题 | 400 / 600 / 700 | npm 包 `misans@5.0.0`（`lib/Normal` 简体子集） | 小米 MiSans 字体使用协议，个人与商业免费使用 |
| Rubik | 拉丁字母、数字 | 可变字重 300–800 | Google Fonts（`latin` / `latin-ext` 子集） | SIL Open Font License 1.1 |

说明：

- 两者都按 `unicode-range` 拆成子集，浏览器只下载页面实际用到的片段；
  中文子集数量多但单文件很小，首屏通常只有 4–8 个小文件。
- 文件命名 `misans/{字重}-{子集序号}.woff2`，重跑生成脚本时保持一致即可。
- 替换或升级字体时同步更新本文件，避免许可证信息与文件脱节。
- 若以后要加繁体，再补 `lib/TC` 的简体之外的子集，`fonts.css` 里追加同名 `@font-face` 即可。
