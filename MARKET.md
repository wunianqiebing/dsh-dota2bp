# 上架 dsh-market 清单

dsh-market 不直接接受插件仓库的 PR；它的目录来自
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)。
完成下面 4 步后，市场与目录站通常会在一天内自动收录。

## 1. 建 GitHub 仓库

在 GitHub 新建 `dsh-dota2bp`，把本目录推上去。市场需要仓库地址和 README/图标，因此没有公开仓库时无法完成上架。

```sh
git init
git add .
git commit -m "feat: Dota2bp dsh plugin 1.1.0"
git branch -M main
git remote add origin https://github.com/<你的用户名>/dsh-dota2bp.git
git push -u origin main
```

仓库根目录保留：`package.json`、`icon.svg`、`README.md`、`LICENSE`。

## 2. 发布 npm 包

包名已经设为 `dsh-dota2bp`（`package.json` 中 `private` 为 `false`）。需要你的 npm 账号：

```sh
npm login
npm publish --access public
```

发布前可先检查包内容：

```sh
pnpm pack --dry-run
```

## 3. 提交 awesome-dsh-plugin

在 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
仓库新增条目，字段与 `market-data/plugins.json` 一致：

```json
{
  "name": "Dota2bp",
  "owner": "<你的 GitHub 用户名>",
  "url": "https://github.com/<你的用户名>/dsh-dota2bp",
  "category": "tools",
  "description": {
    "en": "Dota 2 ranked no-ban 2-2-1 draft assistant with bracket/pro data sources, flexible player pools, and a post-draft win probability prediction.",
    "zh": "Dota 2 天梯无 Ban 2-2-1 征召助手，支持分段/职业数据口径、灵活分路成员池和 BP 后预测胜率。"
  },
  "npm": "dsh-dota2bp",
  "version": "1.1.0",
  "install": "dsh plugin --profile web add dsh-dota2bp",
  "capabilities": ["network", "fs-read", "fs-write"],
  "icon": "https://raw.githubusercontent.com/<你的用户名>/dsh-dota2bp/main/icon.svg"
}
```

如果列表仓库要求的是 Markdown 表格/链接行，则按它的 `CONTRIBUTING.md` 添加同样的仓库与 npm 信息；不要直接改 dsh-market 应用仓库。

## 4. 自检

- `dsh plugin --profile web add dsh-dota2bp` 能安装并加载
- 左侧栏出现 Dota2bp，面板可打开
- `dota2_bp action=status` 返回 `ready: true`
- 切换数据口径后模型重新训练
- 双方 5 人齐后返回 `prediction`
- README 中包含截图或至少一张界面图（市场会自动从 README 提取）

## 当前状态

- npm 包名：`dsh-dota2bp`，版本 `1.1.0`
- 本机 npm 未登录，GitHub CLI 未配置；发布与 PR 需要你的账号授权
- 代码、manifest、图标、LICENSE 和打包文件均已就绪
