[English](README.md)

# 文本对比工具

一个快速、注重隐私的双栏文本差异对比工具，完全在浏览器中运行。将原始文本和修改后的文本分别粘贴到左右两侧，即可实时查看对齐后的行级变化和精确的行内高亮。

正式网址：[diff.hoshinoshion.com](https://diff.hoshinoshion.com)

## 功能

- 左右并排编辑和实时对比
- 可靠对齐新增、删除和修改的行
- 行内差异高亮：英文等以空格分词的语言按单词比较，中文和日文按字符比较
- 支持长文档、重复行、空白行、末尾换行和 Unicode 文本
- 大文本在 Web Worker 中计算差异，输入时不会卡顿
- 折叠未变化的行，只保留每处变化前后的几行（结果较长时自动开启，也可手动切换）
- 两种空白选项：忽略空白数量变化（相当于 `git diff -b`）或忽略所有空白（相当于 `git diff -w`）
- 可开启或关闭自动换行
- 窄屏自动切换为单栏统一视图
- 浅色和深色主题，默认跟随系统，也可手动切换
- 两侧编辑框同步调整高度和垂直滚动，结果面板同步水平滚动
- 支持英语和简体中文
- 根据浏览器语言自动选择界面语言，也可手动切换并记住选择
- 文本完全在浏览器本地处理，粘贴的内容不会上传；内容安全策略（CSP）也会阻止页面连接任何其他域名

## 环境要求

- Node.js 22.13 或更高版本
- npm

## 本地运行

```bash
npm ci
npm run dev
```

## 检查和测试

```bash
npm run lint
npm run typecheck
npm test
```

测试包含确定性随机模糊测试，覆盖随机插入、删除、替换、重复内容、Unicode 文本及长字符串。随机种子固定，因此失败可以稳定复现。

## 部署到 Cloudflare Workers

项目基于 [vinext](https://github.com/cloudflare/vinext)，可以直接部署到 Cloudflare Workers。

```bash
npx wrangler login
npm run deploy -- --name text-diff-tool
```

自动化部署也可以通过 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID` 提供 Cloudflare 身份与账户信息。

应用不需要数据库、服务端密钥或应用环境变量。如果 Worker 已通过 Workers Builds 连接到本仓库，每次推送到 `main` 都会自动部署。

Worker 部署完成后，在设置中把 `diff.hoshinoshion.com` 添加为自定义域名。如果该域名由同一 Cloudflare 账户管理，Cloudflare 会自动创建所需的 DNS 记录并签发 TLS 证书。

## 开源协议

[MIT](LICENSE)
