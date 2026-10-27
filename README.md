# Dota2bp

Dota 2 天梯无 Ban 征召助手。面向 `2-2-1` 同步选人：双方每轮各选 2、2、1 个英雄，每轮约 20 秒。

## 功能

- **可选数据口径**：高分段（Ancient + Divine）、全分段、中分段、低分段、先锋/卫士/十字军/执政官/传奇/远古/神圣单段位，以及职业比赛。切换口径会按该样本重新训练模型。
- **每日数据更新**：从 OpenDota 公共 API 获取胜率、Pick 率、职业数据和英雄两两对位；从 Valve 中文英雄数据源获取正式中文名。启动时超过 20 小时自动补更，之后每 30 分钟检查。
- **灵活分路**：成员不再绑定 1–5 号位。每个人可以配置跨多个分路的英雄池，推荐按“英雄池 + 当前阵容结构”分配。
- **参战勾选**：单排/双排/三排/五排时，只勾选本局一起排的成员；未勾选成员跳过，剩余位置自动给出“补位”建议。
- **BP 预测胜率**：双方各 5 人完成后，根据 25 组英雄对位和阵容结构给出预测胜率、样本量、置信度与优势/风险对位。
- **中文英雄库**：127 位英雄使用 Valve 简体中文正式名，并支持 230+ 个常见外号（敌法、火猫、蓝猫、小Y、大屁股等）。
- **Agent 工具**：`dota2_bp`，可在对话中直接切换口径、录入队伍/征召并获取推荐与预测。

## 安装

已通过 `plugin_manager install_bundle` 安装到当前 profile。安装后左侧栏出现 **Dota2bp** 图标，点击进入主面板；也可在对话中调用 `dota2_bp` 工具。

如果是从 npm 安装市场版本：

```sh
dsh plugin --profile web add dsh-dota2bp
```

## Agent 工具用法

```text
dota2_bp action=set_source source=all
dota2_bp action=setup_team members=[
  {"name":"阿青","position":1,"active":true,"hero_pool":["敌法","主宰","火猫"]},
  {"name":"小北","position":2,"active":true,"hero_pool":["潮汐","猛犸","拉比克"]}
]
dota2_bp action=set_draft our_picks=["潮汐","火猫"] enemy_picks=["影魔","拉比克"]
dota2_bp action=recommend
dota2_bp action=hero_info hero="敌法"
dota2_bp action=refresh
```

`position` 仅用于区分成员，不再限制分路；`active` 控制本局是否参战。`add_pick` 可逐个添加：`action=add_pick side=our hero="潮汐" member=m1`。

## 数据来源

- **胜率/Pick 率/职业数据**：OpenDota `heroStats`，按 1–7 段与职业样本分区保存。
- **英雄对位矩阵**：OpenDota `heroes/{id}/matchups`，当前公开对局样本；对位矩阵不按段位拆分，选段位主要影响胜率先验、强度训练与展示。
- **中文名**：Valve `datafeed/herolist?language=schinese`。

## 数据存储

默认写入 `~/.dota2bp/`：

- `dataset.json`：最近一次采集的胜率、分段样本与对位数据
- `model.json`：当前口径的强度与训练指标
- `state.json`：队伍、勾选状态、当前征召与数据口径

可用 bundle 配置项 `dataDir` 覆盖目录；`refreshAfterHours` 可改自动更新阈值（默认 20 小时）。

## 上架 dsh-market

市场条目来自 `awesome-dsh-plugin` 精选列表。发布步骤见 [MARKET.md](MARKET.md)；npm 包名已准备为 `dsh-dota2bp`。

## 说明

推荐和预测是决策辅助，不是胜率承诺。公开对位样本每个英雄每天约数千局，样本较少的对位会通过收缩与置信度降低权重。模型训练与预测不需要额外 API Key。
