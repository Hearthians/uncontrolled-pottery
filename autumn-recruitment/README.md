# 各年秋招讨论：采集、话题与情绪分析

本目录是独立的本地研究项目。目标为微博、小红书、X 各约 200 条，比较不同年份的讨论话题、情感极性与表达的情绪。代码、数据库、浏览器资料、原始数据和报告均保存在 `autumn-recruitment/` 内。

**Windows 部署请按 [WINDOWS.md](WINDOWS.md) 操作**，包含 PowerShell 安装、三个平台登录、sub2api 配置和采集分析命令。

当前 Windows 宿主机已部署，原生测试与模型连通检查通过；真实采集仍需平台登录，最新结果见 [HOST_DEPLOYMENT.md](HOST_DEPLOYMENT.md)。

2026-11-17 已尝试三个平台的真实访问，目前均受登录、平台网络限制或 API 鉴权阻塞，有效原帖为 0 条。实测证据和继续条件见 [BLOCKERS.md](BLOCKERS.md)。sub2api 的真实模型调用已验证成功，使用的合成测试文本单独标记。

默认研究 2022—2026 年，每个平台每年 40 条，总目标约 600 条。时间窗口为北京时间每年 **8 月 1 日（含）至 11 月 18 日（不含）**；2026 年仍在进行，当前窗口不是完整秋招季。历年采用相同截止日，便于比较。修改年份、关键词及配额请编辑 `config.json`。

年份以原帖发布时间确定，例如 2024 年秋季讨论的“25 届秋招”属于 2024 年秋招季；毕业届别另记，不能用关键词替代发布时间。采集不到的历史年份会显示缺口，不从其他年份补齐。

## 工具与流程

| 平台 | 建议方式 | 历史数据要点 |
| --- | --- | --- |
| 微博 | Playwright 搜索，或导入 [dataabc/weibo-search](https://github.com/dataabc/weibo-search) 的导出 | 按关键词及 `timescope` 切分年份；[weiboSpider](https://github.com/dataabc/weiboSpider) 主要采用户时间线，适合补充指定账号 |
| 小红书 | Playwright 浏览器采集，或导入 [MediaCrawler](https://github.com/NanmiCoder/MediaCrawler) 导出 | 年份、届别关键词仅帮助检索；必须检查详情发布时间；平台可能不提供完整历史搜索 |
| X | 已获授权的官方 API，或 Playwright 搜索 | `since` / `until` 限定年份；API 全历史搜索依赖账户实际权限，以返回结果为准 |

流程为：搜索计划 → 原始记录 / 导入 → SQLite → 时间校验、广告过滤与去重 → 按年固定配额抽样 → sub2api 结构化标注 → CSV / JSON / 报告。

SQLite 保留原始记录与版本化标注；LLM 标注包括相关性、最多三个话题、正面/中性/负面/混合/不确定、具体情绪、强度、置信度及逐字原文证据。模型、正文或提示版本改变后可重新分析；相同版本的已完成结果可复用。

```text
autumn-recruitment/
├── config.json                 # 年份、关键词、配额、过滤规则
├── run.py                      # 本项目入口
├── src/autumn_recruitment/      # 采集、导入、抽样、存储与分析
├── tests/                      # 离线检查
├── data/
│   ├── raw/                    # 原始采集记录 / 待导入导出文件
│   ├── browser-profiles/       # 各平台的本机登录资料
│   └── study.sqlite3           # 数据和标注缓存
└── outputs/                    # 搜索计划、样本及分析导出
```

密钥、浏览器登录资料、原始帖子、数据库及输出均应保持在 Git 忽略范围内。配置中的存储和输出路径必须留在本项目目录内。

## 开始运行

使用 Python 3.11 或更新版本；基础流程使用标准库，无须安装父项目依赖。在此目录运行：

```bash
cd /home/lizd/work/uncontrolled-pottery/autumn-recruitment
python3 run.py plan --output outputs/search-plan.json
python3 run.py doctor
python3 run.py doctor --live
```

`doctor` 检查本地配置；`doctor --live` 仅发送 `GET /models`，检查网关和模型可见性，不生成标注。需要指定其他配置时，根参数放在命令前，例如 `python3 run.py --config config.json plan`。

模型接入只读复用本机 `~/.codex/config.toml` 中选中的 provider 地址、协议和模型，以及 `~/.codex/auth.json` 中的密钥，不修改这些文件。已确认 sub2api 地址为 `https://api.gfyh.fun/v1`，当前接入模型为 `gpt-6.1-sol`，默认使用 Responses API。

可通过环境变量仅覆盖本项目：`AUTUMN_LLM_BASE_URL`、`AUTUMN_LLM_MODEL`、`AUTUMN_LLM_API_KEY`、`AUTUMN_LLM_API`（`responses` 或 `chat_completions`）。也支持 `AUTUMN_LLM_CONFIG_FILE` / `AUTUMN_LLM_AUTH_FILE` 指向现有文件；`OPENAI_API_KEY` 可作为密钥来源。`.env.example` 只是说明，程序**不会自动加载 `.env`**。

```bash
python3 run.py llm-check
```

`llm-check` 使用一条明确标记为人工合成的秋招文本，实际调用模型验证结构化标注；它会产生模型请求，不能当作真实采集样本。

## 采集与导入

先生成搜索计划，按平台、年份与关键词分批采集。初步可每年获取 80—120 条候选，再经过过滤选取 40 条；实际数量取决于平台可检索历史。

已有 dataabc、MediaCrawler 或其他导出时，放进 `data/raw/`，支持 CSV、JSON 数组、含 `posts` / `data` 数组的 JSON、JSONL / NDJSON：

```bash
python3 run.py import data/raw/weibo.csv --platform weibo
python3 run.py import data/raw/xhs.json --platform xiaohongshu
python3 run.py import data/raw/x.jsonl --platform x
```

统一字段为 `post_id`、`text`、`published_at`，可补充 `url`、`author_id` 和互动数量。程序兼容常见 dataabc / MediaCrawler 字段；缺少有效 ID、正文或发布时间的导入会报错。`published_at` 建议使用带时区的 ISO 时间，如 `2024-09-10T15:30:00+08:00`。导出字段不同请先整理，不推测缺失日期。

使用浏览器采集时，将虚拟环境和 Chromium 也安装在本目录：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[browser]'
PLAYWRIGHT_BROWSERS_PATH="$PWD/data/browser-binaries" .venv/bin/python -m playwright install chromium
export PLAYWRIGHT_BROWSERS_PATH="$PWD/data/browser-binaries"
.venv/bin/python -m playwright open --user-data-dir data/browser-profiles/xiaohongshu https://www.xiaohongshu.com
.venv/bin/python run.py collect-browser --platform weibo --query '秋招' --start 2024-08-01 --end 2024-11-18 --limit 100 --timeout 180
.venv/bin/python run.py collect-browser --platform xiaohongshu --query '25届 秋招' --start 2024-08-01 --end 2024-11-18 --limit 100 --timeout 180
.venv/bin/python run.py collect-browser --platform x --query '秋招' --start 2024-08-01 --end 2024-11-18 --limit 100 --timeout 180
```

浏览器默认打开可见窗口，需要图形桌面，使用 `data/browser-profiles/<platform>` 的独立登录资料。先用上面的 `playwright open` 手动登录并关闭窗口，再执行采集；微博和 X 对应换成 `weibo` / `https://weibo.com`、`x` / `https://x.com`。检测到登录要求、验证码或访问限制时采集停止并保留已采结果，需人工处理后重跑；本项目不提供绕过机制。小红书搜索页上的年份描述不足以确定发帖日期，必须取得详情有效时间后才纳入样本。日期范围均为左闭右开；采集时间不足可增加 `--timeout`。

没有图形桌面的服务器可加 `--headless`，复用同一平台资料目录。已有 Chromium 时，可加 `--browser-executable /path/to/chrome` 指定本机可执行文件；省略时使用 Playwright 安装的浏览器。无界面模式仍会在登录或验证要求处停止，需要人工登录时应回到可见窗口完成。

需要通过本机 Clash 等代理访问时，可给采集命令加 `--proxy-server http://127.0.0.1:7890`，端口按实际配置填写。此参数仅作用于本次浏览器进程，支持 `http`、`https`、`socks5` 地址，拒绝 URL 内的账号密码；省略时不指定浏览器代理。

获得 X API Token 后，通过当前终端环境设置 `X_BEARER_TOKEN`，不要写进代码或提交配置：

```bash
python3 run.py collect-x-api --query '秋招 -is:retweet' --start 2024-08-01 --end 2024-11-18 --limit 100 --endpoint all
```

`all` 使用全历史搜索；`recent` 使用近期搜索。历史年份需要相应权限，程序不会在拒绝后自动换成近期搜索。授权、限流或额度错误会明确停止。

## 抽样、分析与导出

```bash
python3 run.py sample
python3 run.py analyze --limit 16 --batch-size 8
python3 run.py analyze --batch-size 8
python3 run.py export
```

`sample` 校验原始时间、过滤明显推广与重复正文，再按固定种子抽样；默认每个平台每个年份同一作者最多三条。先用少量样本检查标注质量，再运行完整分析。`analyze` 读取已有采集数据并实际调用 sub2api，完成的批次保存后可续跑。模型结果缺字段、遗漏帖子或证据不属于原文时，不保存该批标注。

结果写入 `outputs/`，应同时核对各平台各年的实际样本量、配额缺口和标注覆盖率。建议人工复核一部分样本，尤其是不确定、反讽、正负混合及低置信度条目；模型情绪是文本标注，不代表作者长期心理状态。

## 验证与研究边界

离线测试不会访问平台或模型：

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -v
```

本项目提供采集与分析工具，空数据库不等于已有 600 条真实数据。平台登录、历史检索权限和数据可见性会影响完成量。每个平台约 200 条属于非概率小样本，适合探索主题与比较已采样讨论，不能据此估计整个秋招市场情绪比例或招聘景气度；跨平台结果也应结合人群与搜索排序差异解读。
