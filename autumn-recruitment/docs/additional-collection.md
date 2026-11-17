# 新增平台真实采集与部署记录

日期：2026-11-17。已按用户选择同时尝试国内、海外平台。Windows 部署在 `D:\lizd\work\autumn-recruitment`，校园网入口为 <http://10.7.4.11:8765/>。所有原始记录、数据库、模型缓存和导出均在本项目目录内，继续由 Git 忽略。

## 已完成的数据

“入库条目”指取得完整正文和原始时间的记录；“入选”还经过窗口校验、去重、作者上限和年度配额；“相关”再由模型判断。数字按讨论条目计，不等于独立求职者人数。

| 平台 | 入库条目 | 入选 / 已标注 | 相关 | 入选年度分布：2022 / 2023 / 2024 / 2025 / 2026 |
| --- | ---: | ---: | ---: | --- |
| 牛客 | 143 | 141 / 141 | 133 | 19 / 14 / 40 / 29 / 39 |
| Hacker News | 200 | 200 / 200 | 179 | 40 / 40 / 40 / 40 / 40 |
| The Workplace | 200 | 200 / 200 | 195 | 40 / 40 / 40 / 40 / 40 |
| Mastodon | 9 | 9 / 9 | 8 | 0 / 0 / 0 / 0 / 9 |

国内新增样本共 141 条、相关 133 条；海外组共 409 条、相关 382 条。两组全部完成结构化标注。原三平台主报告仍为 268 条、相关 212 条；小红书可用补充集 207 条与主报告重叠，不能相加。

牛客取得 143 条，其中一条历史帖正文明确含 11 月 22 日、12 月 7/10 日等研究窗口后的新增进展，已记录 `temporal_review` 并排除；另有一条因同作者年度上限未入选。对仅有跨年编辑时间、无法证明正文在窗口后新增的帖子，保留采集时可见版本的局限，不凭编辑时间一概剔除。

Hacker News 每年 40 条，主要为评论，采集前已限制每作者每年最多 3 条、每主题每年最多 4 条，并覆盖 8—11 月。Workplace 为 151 个问题、49 个回答，每作者每年最多 3 条、每主题每年最多 3 条；回答以自身创建时间归年。Mastodon 观察到 22 条原始候选，筛出 9 条英文就业观点入库，全部来自 2026 年，其中模型判定相关 8 条；历史年份保留空缺。

## 数据源与实际入口限制

| 平台 | 本轮使用方式 / 结果 |
| --- | --- |
| 牛客 | 匿名浏览器读取普通搜索及完整详情 SSR，原始 `createTime` / `createdAt` 归年；搜索分页和关键词可见性限制历史覆盖 |
| Hacker News | Algolia 按月搜索，再用 HN 官方 Firebase 逐条核对完整正文、原始时间及可见状态 |
| The Workplace | Stack Exchange API 的 `withbody` 问题与回答，保留原始创建时间、父级与主题关联；尊重配额和 backoff |
| Mastodon | 公开标签时间线，按原帖 URI 去重；实例可见性不等于联邦全网或完整历史 |
| 哔哩哔哩 | 15 条搜索候选的简介可能截断；未取得可用完整正文，HTTP 412 后停止，未纳入分析 |
| 知乎 | 普通公开入口 HTTP 403 后停止，0 条入库 |
| Reddit | 本轮普通公开搜索 HTTP 403 后停止，0 条入库 |
| Bluesky | 本轮普通公开搜索 HTTP 403 后停止，0 条入库 |

403/412 记录本轮入口未成功，不推定其具体原因。Reddit / Bluesky 相关 API 环境变量在本轮 Linux 与 Windows 运行环境中未检测到可用配置，未据此声称检查了所有可能的凭据文件。此前的一亩三分地公开访问测试也未取得正文，未重复尝试受限入口。

牛客本轮最后一次浏览器页面证据写入遇未配对 UTF-16 字符，采集正常保存了已完成的 143 条后停止；正式采集 CLI 已修正证据编码处理，本轮未另开补量。原始 HTML、状态、URL 和检查点保存在本地诊断内。

## 模型与网页口径

`configs/additional-chinese.json` 使用 `campus_recruitment` / `recruitment-v2`；`configs/overseas-employment.json` 使用 `overseas_employment` / `employment-overseas-v1`。两者共享独立的 `data/additional-study.sqlite3`，按平台和提示版本分离分析缓存；复用现有 sub2api / `gpt-6.1-sol` 接入，不复制密钥。

海外范围接受一般求职、录用面试、裁员、就业市场和有实质内容的职业建议，不要求提及中国或秋招；纯岗位广告、无自身观点的新闻转发、泛政治讨论仍不相关。话题和情绪标签使用统一中文枚举，正文与证据保留原文语言，证据必须逐字出现在正文中。

页面增加“国内平台补充集”和“海外英文就业讨论”两个独立选项；新增平台按数据集动态显示。原帖、问题、回答、评论的类型、语言与来源链接随样本显示，CSV 保留主题及父级 ID。图表分母为当前范围内已标注且相关的条目，缺失年份显示缺口；相关但没有明确情绪的条目仍在分母中。

样本来自非概率搜索与可见公开内容；搜索排序、平台人群、主题聚集和历史版本差异均限制代表性。海外一般职场与中文校园秋招不能直接混合解释，同主题发言也不能当作相互独立的受访者。所有标签均未全量人工语义复核。

## 在 Windows 续跑

在项目根目录打开 PowerShell，复用已部署的运行环境：

```powershell
Set-Location D:\lizd\work\autumn-recruitment
. .\data\host-env.ps1
$env:PYTHONPATH = Join-Path (Get-Location).Path 'src'

# 公开海外接口采集：支持已有完整记录的检查点复用
.\.venv\Scripts\python.exe -m autumn_recruitment.collectors.additional_overseas --platform hackernews --stage collect
.\.venv\Scripts\python.exe -m autumn_recruitment.collectors.additional_overseas --platform workplace --stage collect

# 牛客普通匿名浏览器采集：有时间上限，按原始日期归年
.\.venv\Scripts\python.exe -m autumn_recruitment.collectors.additional_chinese nowcoder --output data\raw\additional\nowcoder-posts.jsonl --evidence-dir data\diagnostics\nowcoder --max-seconds 600

# 导入完整正文文件，不能导入搜索摘要、缓存响应或历史备份
.\.venv\Scripts\python.exe run.py --config configs\overseas-employment.json import data\raw\additional\hackernews-posts.jsonl --platform hackernews
.\.venv\Scripts\python.exe run.py --config configs\overseas-employment.json import data\raw\additional\workplace-posts.jsonl --platform workplace
.\.venv\Scripts\python.exe run.py --config configs\additional-chinese.json import data\raw\additional\nowcoder-reviewed-posts.jsonl --platform nowcoder

# 新增内容才会触发模型请求；每批完成即保存
.\.venv\Scripts\python.exe run.py --config configs\additional-chinese.json analyze --batch-size 16
.\.venv\Scripts\python.exe run.py --config configs\additional-chinese.json export
.\.venv\Scripts\python.exe run.py --config configs\overseas-employment.json analyze --batch-size 16
.\.venv\Scripts\python.exe run.py --config configs\overseas-employment.json export
```

已有本机牛客终稿 `nowcoder-reviewed-posts.jsonl` 保留了本次明确的时间复核。续采新文件时，对历史更新内容复核后再导入；普通 upsert 会保留数据库中已有的 `temporal_review`，除非显式覆盖。Mastodon 的本轮正式入库文件为 `data/raw/additional/mastodon_opinions_20261117T134221Z.jsonl`，较宽泛的 `mastodon_candidates_*.jsonl` 不属于已筛选意见集。

## 验证与本机产物

- Linux、Windows 原生离线测试各 80 项通过。
- Windows 原生只读数据审计：两组共 550 条入选记录，数据库完整性、原始 ID/正文/时间、作者上限、去重、窗口、标签和逐字证据均通过，0 错误、0 警告。
- 已有两数据集 59 项真实浏览器回归、新平台 44 项明确模拟检查均通过；新增真实数据在校园网地址完成 326 项页面/API/统计/CSV/响应式检查，0 失败、0 浏览器错误。随后针对 Mastodon 地区显示与 CSV 完成 14 项定向检查，全部通过。
- 国内导出：`outputs/additional-chinese/`；海外导出：`outputs/overseas-employment/`，均有 `sample.jsonl`、`labels.csv`、`summary.json`、`report.md` 和 `quality-audit.json`。
- 原始记录：`data/raw/additional/`；只读审计：`data/diagnostics/additional-quality.json`；页面报告和真实截图：`data/diagnostics/web-final-validation/`。
- Windows SQLite 使用原生 Python 备份并核验后镜像到 Linux；未用 Linux SQLite 写入 Windows 主库。

网页服务保持校园网监听，Windows 防火墙仅允许已记录的以太网接口、本机校园网 IP 与 TCP 8765；具体规则和启动方式见 [宿主机部署记录](../HOST_DEPLOYMENT.md)。
