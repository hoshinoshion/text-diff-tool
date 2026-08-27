# 文本对比工具

一个在浏览器中运行的双栏文本差异对比工具。将原始文本和修改后的文本分别粘贴到左右两侧，即可查看行级差异和精确的行内高亮。

## 功能

- 左右并排编辑和实时对比
- 新增、删除、修改行对齐
- 行内字符级差异高亮
- 支持长文档、重复行、空白行和 Unicode 文本
- 可选择忽略空白差异
- 可开启或关闭自动换行
- 两侧编辑框同步调整高度和滚动
- 文本仅在浏览器本地处理

## 本地运行

需要 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

## 检查和测试

```bash
npm run lint
npm test
```

测试包含确定性随机模糊测试，覆盖随机插入、删除、替换、重复内容、Unicode 文本及长字符串。随机种子固定，因此失败可以稳定复现。

## 部署到 Cloudflare Workers

项目基于 [vinext](https://github.com/cloudflare/vinext)，可直接部署到 Cloudflare Workers：

```bash
npx wrangler login
npm run deploy -- --name text-diff-tool
```

在自动化部署环境中，也可以通过 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID` 提供 Cloudflare 身份与账户信息。

公开仓库不包含当前托管环境的 `.openai/hosting.json`。该文件并非 Cloudflare Workers 部署所需，项目在没有它时会自动使用标准 Cloudflare 配置。

## License

[MIT](LICENSE)
