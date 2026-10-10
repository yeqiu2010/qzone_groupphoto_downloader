# 更新日志

本项目的所有重要变更都会记录在此文件中。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.0] - 2026-10-10

### 新增

- 首次开源发布
- 群相册列表扫描，支持分页拉取全部相册，展示每册照片数
- 相册多选：勾选 / 全选 / 取消全选 / 反选
- 整册 ZIP 打包下载，走官方打包接口，按「群号 / 相册名.zip」归档
- 逐张原图下载：自动滚动抓 DOM、去重、提取 `/0` 原图规格，支持并发与间隔配置
- 断点续传：本地记录已下载项，支持一键清空进度
- 复制打包直链到剪贴板，便于交给迅雷 / IDM 批量下载
- 可拖拽悬浮面板，含进度条、实时日志与状态提示
- 打包接口 5 种请求形态自动轮换重试
- 内置接口侦察输出（控制台 `[QZ-GP]` 前缀），便于接口变更时自行适配

### 文档

- 新增 README、CONTRIBUTING、CHANGELOG、LICENSE、Issue / PR 模板、GitHub Actions 语法与元数据校验

[1.0.0]: https://github.com/yeqiu2010/qzone-groupphoto-downloader/releases/tag/v1.0.0
