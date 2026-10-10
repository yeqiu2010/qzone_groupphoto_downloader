# QQ群相册批量下载器

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Userscript](https://img.shields.io/badge/Tampermonkey%2F%E6%B2%B9%E4%BA%9E%E6%9F%93%E6%9C%88%E7%8C%AB-compatible-blue.svg)](https://www.tampermonkey.net/)

一个运行在浏览器里的油猴脚本（Userscript），用于在 **h5.qzone.qq.com 群相册**页面批量下载 QQ 群相册照片。

支持两种下载方式：

- **整册打包 ZIP**：调用 QQ 相册官方打包接口，一个相册直接导出一个 ZIP（速度快、保留原图，推荐）
- **逐张原图**：在当前相册详情页滚动抓取原图链接后逐张下载（作为打包接口不可用时的兜底方案）

> 纯前端脚本，不经过任何第三方服务器，不收集任何数据。

---

## 目录

- [功能特性](#功能特性)
- [安装](#安装)
- [使用方法](#使用方法)
- [常见问题](#常见问题)
- [工作原理](#工作原理)
- [隐私说明](#隐私说明)
- [免责声明](#免责声明)
- [参与贡献](#参与贡献)
- [许可证](#许可证)

---

## 功能特性

- **相册列表一次拉取**：在群相册首页列出该群全部相册，显示每个相册的照片数
- **勾选 / 全选 / 反选**：自由选择要下载的相册，支持部分下载
- **整册 ZIP 打包下载**：走官方打包接口，每册一个 ZIP，自动按「群号 / 相册名.zip」归档
- **逐张原图下载**：自动滚动加载页面、去重、提取 `/0` 规格原图地址，可调并发与间隔
- **断点续传**：已下载的相册/图片会记录在本地（Tampermonkey 存储），重跑自动跳过，可手动清空进度
- **复制 ZIP 直链**：把打包链接复制到剪贴板，可粘贴到迅雷 / IDM 等下载工具批量下载
- **可拖拽悬浮面板**：面板标题栏可拖动，操作日志和进度条实时可见
- **容错能力强**：打包接口准备了 5 种请求形态自动轮换重试，网络异常统一捕获并输出到面板日志

---

## 安装

### 前置条件

1. 浏览器安装脚本管理器扩展（任选其一）：
   - [Tampermonkey](https://www.tampermonkey.net/)（推荐，Edge / Chrome / Firefox / Safari 均有）
   - [暴力猴 Violentmonkey](https://violentmonkey.github.io/)
2. 已在浏览器中**登录 QQ 空间**（登录 QQ 账号并访问过 qzone.qq.com）

### 方式一：一键安装

安装扩展后，打开以下链接即可自动识别安装：

```
https://raw.githubusercontent.com/yeqiu2010/qzone-groupphoto-downloader/main/qzone-groupphoto-downloader.user.js
```

> 已安装的脚本会在 Tampermonkey 面板中自动检查 `updateURL` 更新，无需重复安装。

### 方式二：手动安装

1. 下载仓库中的 [`qzone-groupphoto-downloader.user.js`](./qzone-groupphoto-downloader.user.js)
2. 打开浏览器的扩展管理面板 → Tampermonkey → **添加新脚本 / 实用工具 → 导入**
3. 或者：直接把文件内容粘贴进 Tampermonkey 的新建脚本编辑器，按 `Ctrl + S` 保存

### 必要的扩展授权

脚本使用了以下 GM API，首次运行时如浏览器提示，请允许：

| API | 用途 |
| --- | --- |
| `GM_download` | 跨源保存文件到浏览器下载目录 |
| `GM_xmlhttpRequest` | 跨域请求 app.photo.qq.com 打包接口 |
| `GM_setValue` / `GM_getValue` | 本地记录「已下载」进度 |
| `GM_addStyle` | 注入面板样式 |
| `GM_setClipboard` | 复制 ZIP 直链 |

---

## 使用方法

### 步骤

1. 登录 QQ 空间后，打开群相册首页，地址形如：
   ```
   https://h5.qzone.qq.com/groupphoto/index?groupId=你的群号
   ```
2. 页面右下角会出现 **QQ群相册批量下载器** 悬浮面板
3. 点击 **① 扫描相册** → 等待列表出现（每个相册默认勾选）
4. 通过「全选 / 取消全选 / 反选」或直接勾选调整目标相册
5. 选择模式并开始：
   - **整册打包 ZIP**（推荐）：直接点 **② 开始下载**
   - **逐张原图**：需先**点进某一个相册的详情页**（h5.qzone.qq.com/groupphoto/album*）再扫描下载
6. 首次批量下载时，浏览器会弹窗询问「是否允许本站下载多个文件」，请选择**允许**
7. 等待进度条走完，文件保存在浏览器下载目录的：
   ```
   QZone群相册/群<群号>/<相册名>.zip
   ```

### 面板参数说明

| 控件 | 说明 |
| --- | --- |
| 并发 | 逐张下载时的并发数，范围 1–8，默认 3 |
| 间隔(ms) | 每张下载之间的间隔，默认 350ms，被限速时可加大 |
| 跳过已下载 | 开启后自动跳过本地进度里已记录的项 |
| 复制ZIP链接 | 只请求打包直链并复制到剪贴板，不触发浏览器下载 |
| 清空进度 | 清空本地「已下载」记录，下次全部重下 |

---

## 常见问题

**Q：扫描相册提示「未取到相册」？**
请确认：① 浏览器已登录 QQ 空间；② 当前确实在 `h5.qzone.qq.com/groupphoto` 页面；③ URL 里带 `groupId` 参数。若提示 `token=(无)`，说明未登录或 Cookie 过期，重新登录后刷新页面。

**Q：打包 ZIP 一直是 HTTP 403 / 返回一大段 HTML？**
多为未取到 `qzonetoken`（面板日志会提示 ⚠）。请**在群相册首页（而非详情页）**使用整册模式并刷新页面后重试；也可改用「逐张原图」模式兜底。

**Q：为什么只下载了几张就停了？**
浏览器默认会拦截批量下载。首次运行时请在弹窗中点「允许下载多个文件」；若已误点拒绝，需在站点设置里恢复「自动下载」权限。

**Q：下载很慢 / 大量失败？**
打包接口有频率限制是正常现象。可降低并发（建议 1–2）、加大间隔（800ms 以上），失败项会自动跳过已成功的部分，直接重跑即可。

**Q：接口失效了怎么办？**
脚本内置了「接口侦察」功能：打开控制台（F12）操作页面时，会打印页面真实调用的接口地址与返回样例，便于自行适配。更多细节见 [工作原理](#工作原理)。

**Q：这个脚本会上传我的 Cookie 或照片吗？**
不会。所有请求都由你的浏览器直接发往腾讯域名，脚本只读取页面自身的票据用于构造合法请求，不向任何第三方服务器发送数据。详见 [隐私说明](#隐私说明)。

---

## 工作原理

脚本直接复用 QQ 空间网页端自身的接口，不依赖任何私有 API Key：

| 环节 | 接口 |
| --- | --- |
| 相册列表 | `POST/GET https://h5.qzone.qq.com/proxy/domain/u.photo.qzone.qq.com/cgi-bin/upp/qun_list_album_v2`（`cmd=qunGetAlbumList`） |
| 整册打包 | `https://h5.qzone.qq.com/proxy/domain/app.photo.qq.com/cgi-bin/app/cgi_arch_photo_v2`，失败时回退直连 `https://app.photo.qq.com/cgi-bin/app/cgi_arch_photo_v2` |
| 逐张兜底 | 无接口，滚动页面后从 DOM 抓取 `img[bigsrc]` / `data-src` 等属性 |

票据获取策略：

- `g_tk`：优先用页面全局对象 `PSY.user.token()`，取不到时按腾讯通用算法（hash 5381）从 `p_skey` / `skey` 计算
- `qzonetoken`：依次尝试 `window.g_qzonetoken` → 父窗口 / iframe → `PSY.data` / `QZONE.data` → 页面 HTML 正则兜底
- `uin`：优先 `PSY.user.getLoginUin()`，兜底读 `uin` / `loginuin` Cookie

打包接口由于网关校验较严，脚本会按 5 种参数摆放形态（票据在 URL / 参数在 body / 全部在 URL / GM_xhr 直连等）逐个尝试，任一成功即返回下载链接。

---

## 隐私说明

- 脚本 **不联网上传任何数据**，所有请求均在你的浏览器内发起，目标域名仅为 `*.qzone.qq.com`、`*.photo.qq.com`、`*.store.qq.com` 等腾讯官方域名
- 仅在浏览器本地保存「已下载相册/图片的 ID」，用于断点续传，可通过面板「清空进度」随时删除
- 源码完全开放（单文件，约 700 行），欢迎自行审计

---

## 免责声明

- 本项目为个人学习与技术用途的开源工具，仅供**下载你自己拥有或有权限访问的 QQ 群相册内容**
- 请勿用于下载、传播他人享有著作权的作品或侵犯他人隐私的内容；由此产生的一切法律责任由使用者自行承担
- 本项目与腾讯公司无任何关联，非官方工具
- 使用本项目即视为你同意自行承担全部风险，作者不对数据丢失、账号异常等任何后果负责
- 若腾讯方面提出相关诉求，本项目将第一时间停止维护

---

## 参与贡献

欢迎提交 Issue 和 Pull Request，尤其是：

- 报告接口变更（附上面板 / 控制台的错误输出）
- 补充更多兜底策略
- 改进界面交互

提交前请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。

接口失效时最有价值的 Issue 信息：

1. 面板日志中以 `·` 开头的行（含 HTTP 状态码与返回内容片段）
2. 控制台（F12）中 `[QZ-GP]` 前缀的接口侦察输出
3. 浏览器类型与脚本管理器版本

---

## 许可证

本项目基于 [MIT License](./LICENSE) 开源，作者 [yeqiu2010](https://github.com/yeqiu2010)。
