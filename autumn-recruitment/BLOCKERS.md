# 真实采集状态与阻塞

检查日期：2026-11-17。目标为微博、小红书、X 各约 200 条，默认 2022—2026 年每年 40 条。

Windows 部署目录已迁移为 `D:\lizd\work\autumn-recruitment`。微博、小红书已正常登录并开始真实采集；安装与首次登录步骤仍见 [WINDOWS.md](WINDOWS.md)，宿主机操作见 [HOST_DEPLOYMENT.md](HOST_DEPLOYMENT.md)。原始数据、诊断响应、截图、数据库和浏览器资料均在项目目录内并由 Git 忽略，仓库只保留状态摘要与代码。

## 当前进度和待解决事项

以下为 2026-11-17 的当前快照，小红书补采已因平台安全限制暂停；最新精确数量以数据库与导出为准。原帖总数与经过时间校验、过滤和抽样的入选数分别计数。

| 平台 / 工具 | 当前事实 | 剩余限制与下一步 |
| --- | --- | --- |
| 微博 | 已登录，取得 471 条可追溯原帖；2022—2026 年各选 40 条，共 200 条 | 数量达标但日期覆盖集中，不能作为全季随机样本；若要改善季内比较，需要细化时间片、扩展日期与结果页 |
| 小红书 | 已登录，取得 250 条原帖；2022—2026 年分别入选 3 / 0 / 8 / 17 / 40，共 68 条 | 2022—2025 历史配额不足；2023 年定向搜索的第三个详情进入平台安全限制页（`300013`）后已停止。只纳入原始时间符合窗口的条目，未成功取得 2023 年样本不表示该年没有相关帖子 |
| X | 尚未登录，0 条；官方 API 尚未申请，未配置可用于历史搜索的凭据 | 正常登录项目的 X 浏览器资料，或申请并配置具备所需历史搜索权限的 `X_BEARER_TOKEN` 后验证；现有 sub2api 密钥用于模型调用 |
| AdsPower | 技能已安装，客户端已启动；本地 API `50325` 仍不可访问，API Key 未配置 | 核实客户端账号与 Local API 状态；当前已登录的 Playwright 会话可继续采集 |

微博原始分年条数为 2022 年 97、2023 年 94、2024 年 103、2025 年 102、2026 年 75，合计 471。2026 年搜索界面省略年份，已通过正常打开原帖详情时返回的原始发布时间核实，没有依据届别关键词或当前日期推测。

**微博样本每年仅覆盖 8 月 31 日、9 月 30 日、10 月 31 日、11 月 17 日四个日期。** 这源于月度时间片只采集排序靠前的结果页：2022—2025 年各片前 3 页，2026 年各片前 2 页。后续从这个候选集按固定种子抽样不会消除日期集中及搜索排序偏差。因此应报告为这些日期、关键词和可见结果的方便样本，不能称为全秋招季随机样本，也不能用情绪比例代表整体市场。

微博证据已镜像至 Linux 本项目的 `data/raw/weibo_real_*.jsonl`、`data/diagnostics/weibo-real-collection-summary.json`、`weibo-real-collection-progress.json` 和 `weibo-2026-collection-progress.json`。其他平台的当前原始数据和状态以 Windows 部署目录的 `data/`、数据库及最新导出为准。不得把先前未登录时的诊断当作当前数量。

已人工确认 3 条小红书历史笔记包含窗口之后新增的正文，记录 `temporal_review` 与逐字证据并排除出按年比较，原始数据保留。仅有更新时间越界、无法证明正文变化的记录未据此一概剔除。

最终 v2 标注已完成：微博候选 200 / 相关 163；小红书主样本候选 68 / 相关 49。小红书另有全部标注的可用补充集 207 / 相关 153（2022—2026 为 3 / 0 / 8 / 17 / 179），位于 `outputs/xiaohongshu-available/`。补充集与主样本重叠；相关数低于候选数，未用广告或不相关内容充当有效言论。主报告 268 条候选均已标注。

## 此前入口诊断（历史记录）

以下为登录前的 Linux / Windows 探测，仅用于保留排错线索，**不再表示微博、小红书的当前访问状态**。

| 平台 | 先前观测 | 证据（均在项目目录内） |
| --- | --- | --- |
| 微博 | 未登录搜索曾跳转 `passport.weibo.com` 访客入口，采集器检测后停止；移动搜索接口曾返回 HTTP 432 | `data/diagnostics/weibo.response`、`weibo-collector-attempt.json` |
| 小红书 | 先前 Linux 搜索的 `/login/activate` 返回 HTTP 461 和 IP 风险提示 `300012`，当时未取得搜索原帖；后续 Windows 正常登录后已采到正文和详情时间 | `data/diagnostics/xiaohongshu-browser-evidence.json`、`xiaohongshu-browser.png`、`xiaohongshu-public-html-evidence.json` |
| X | 普通搜索跳转 `mode=login`；未授权官方历史搜索曾返回 HTTP 401；Windows 经 Clash `http://127.0.0.1:7897` 已能打开入口，但仍未登录 | `data/diagnostics/x_access_findings.json` 及宿主机访问诊断 |

此前 Linux 浏览器依赖已经在项目内处理：`.venv/` 安装了 Python Playwright，缺失的 ALSA 共享库解包到 `data/browser-runtime/`。当前主要采集环境是 Windows 原生 Python 与 Chromium；Windows 和 Linux 的浏览器资料分别保存，不要同时启动使用同一资料目录的浏览器。

## 已验证可用的分析部分

- `https://api.gfyh.fun/v1` 已通过本机现有密钥鉴权，当前配置模型 `gpt-6.1-sol` 可见。
- 已真实调用 `/responses`，并校验返回的话题、情感、情绪和逐字原文证据；现有采集数据可复用同一模型接入进行标注。
- `llm-check` 的模型连通性检查使用明确标记的合成文本，**没有计入任何平台的真实数据**。记录在 `outputs/sub2api-check.json`；研究标注的覆盖量以最新数据库和导出为准。
- 离线导入、时间边界、抽样、缓存、统计及导出等检查已通过，具体测试数量随本轮采集器修复更新。

## 继续运行

Windows 宿主机继续采集时，先关闭使用同一平台资料目录的交互浏览器，再打开 PowerShell。项目已保存已登录的微博、小红书资料；无需因此前的未登录诊断重复安装环境或重新登录。

```powershell
Set-Location D:\lizd\work\autumn-recruitment
. .\data\host-env.ps1
.\.venv\Scripts\python.exe run.py sample
.\.venv\Scripts\python.exe run.py analyze --batch-size 8
.\.venv\Scripts\python.exe run.py export
```

历史补采命令与新设备安装方法见 [README.md](README.md)、[WINDOWS.md](WINDOWS.md)。获得 X API 凭据后，通过环境配置 `X_BEARER_TOKEN`，再执行 `collect-x-api --endpoint all`；实际不足的年份始终保留缺口，不用其他年份补齐。

海外补充来源的实测分别见 [Hacker News / Workplace](docs/overseas-platforms.md) 与 [Reddit / Bluesky / Mastodon / 一亩三分地](docs/overseas-social-platforms.md)。当前仅完成少量可行性探测，不计入上述平台数据量；英文海外就业讨论应作为独立比较组。
