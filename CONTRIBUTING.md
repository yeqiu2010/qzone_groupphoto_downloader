# 参与贡献

感谢你愿意为这个项目贡献代码 🙏

## 开发方式

本项目是**单文件油猴脚本**，没有构建步骤，改完直接在浏览器里生效。

```bash
git clone https://github.com/yeqiu2010/qzone-groupphoto-downloader.git
cd qzone-groupphoto-downloader
```

本地调试推荐流程：

1. 在 Tampermonkey 里新建脚本，用 `@require file:///本地路径/qzone-groupphoto-downloader.user.js` 引入（需在扩展设置里开启「允许访问本地文件」）
2. 或直接把文件内容覆盖进 Tampermonkey 编辑器，`Ctrl + S` 保存后在群里刷新页面
3. 打开浏览器控制台（F12），脚本会以 `[QZ-GP]` 前缀打印页面真实调用的接口

## 代码约定

- 保持 **单文件、零依赖**：不要引入外部库或打包工具
- 目标运行环境为现代浏览器，可用 ES2017+ 语法，但不要使用需要编译的语法（如 JSX、TypeScript）
- 新增 GM API 时，**必须同步**在文件头部 `// @grant` 中声明，并在 README 的「必要的扩展授权」表格中补充说明
- 网络请求统一走脚本内的 `request()` / `gmRequest()` 包装（永不抛异常，返回 `{ status, text, data }`），不要裸调 `fetch` 后不处理异常
- 面向用户的提示文案统一放入面板日志；控制台输出请加 `[QZ-GP]` 前缀
- 中文注释与文案，保持现有分节风格（`/* ===== N. 小节名 ===== */`）

## 提交 Pull Request

1. Fork 本仓库并新建分支，分支名建议：`feat/xxx`、`fix/xxx`、`docs/xxx`
2. 提交前请确认：
   - 脚本能通过语法检查：`node --check qzone-groupphoto-downloader.user.js`
   - 修改 `@version` 时同步更新 [CHANGELOG.md](./CHANGELOG.md)
3. 提交信息建议遵循 Conventional Commits，例如：
   ```
   fix(zip): 修复 AlbumName 含特殊字符时打包失败
   feat(ui): 面板支持记住上次选择的模式
   ```
4. 发起 PR 时请说明：改动动机、复现步骤（若是 Bug 修复）、以及你在哪个浏览器 / 脚本管理器上验证过

## 报告 Bug

请务必附上以下信息，否则很难定位：

- 浏览器及版本、脚本管理器（Tampermonkey / 暴力猴）及版本
- 具体操作路径（在哪个页面、点了哪个按钮）
- **面板日志全文**（尤其以 `·` 开头的行，含 HTTP 状态码）
- 控制台输出截图（F12）
- 是否已登录 QQ 空间、是否刚刷新过页面

> 注意：贴日志前请自行打码 `g_tk`、`qzonetoken`、`uin`、Cookie 等敏感信息。

## 提问前

- 先看一遍 [README 的常见问题](./README.md#常见问题)
- 搜索已有的 Issue，避免重复
