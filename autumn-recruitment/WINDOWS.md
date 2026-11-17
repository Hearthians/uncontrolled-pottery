# Windows 部署与登录采集

需要 Python 3.11 或更新版本、Git，以及可正常打开各平台网站的 Windows 桌面环境。以下命令在 **PowerShell** 中运行。

## 获取代码与安装

首次获取仓库：

```powershell
git clone --branch feat/material-deposition https://github.com/Hearthians/uncontrolled-pottery.git
Set-Location .\uncontrolled-pottery\autumn-recruitment
```

已有仓库时，在仓库目录执行 `git switch feat/material-deposition`、`git pull --ff-only`，再进入 `autumn-recruitment`。若仓库需要身份验证，请使用有权限的 GitHub 账号。

```powershell
py -3 --version
py -3 -m venv .venv
$env:PYTHONUTF8 = "1"
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -e '.[browser]'
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location).Path 'data\browser-binaries'
.\.venv\Scripts\python.exe -m playwright install chromium
.\.venv\Scripts\python.exe run.py plan --output outputs/search-plan.json
```

直接调用虚拟环境中的 Python，无须激活脚本或调整 PowerShell 执行策略。若没有 `py` 启动器，确认 `python --version` 为 3.11+ 后，用 `python -m venv .venv` 创建环境。

Windows 安装会自动包含 `tzdata`，供北京时间窗口计算使用。虚拟环境、浏览器、登录资料、数据库和输出全部留在本项目目录，Git 忽略这些本机文件；从 Git 拉取的代码不包含此前 Linux 机器的密钥、登录状态和诊断响应。

每次新开 PowerShell，先进入本项目，再设置：

```powershell
$env:PYTHONUTF8 = "1"
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location).Path 'data\browser-binaries'
```

## 打开可视化网页

当前宿主机项目位于 `D:\lizd\work\autumn-recruitment`，可双击其中的 `launch-dashboard.cmd` 启动。也可以在 PowerShell 中执行：

```powershell
Set-Location D:\lizd\work\autumn-recruitment
$env:PYTHONUTF8 = '1'
.\.venv\Scripts\python.exe run.py serve --host 127.0.0.1 --port 8765
```

浏览器打开 <http://127.0.0.1:8765/>。命令行启动时保持窗口运行，按 `Ctrl+C` 停止；若 `8765` 已被其他程序占用，可改用 `--port 8766`，并打开相应地址。默认只监听本机；当前宿主机已按用户授权开放校园网，地址和规则见 [HOST_DEPLOYMENT.md](HOST_DEPLOYMENT.md)。本机存在 `data/dashboard-network.json` 时，双击启动器会沿用其中已配置的监听方式。

可按年份和平台查看情感分布、话题、情绪与样本缺口，切换条数/占比，点击图表下钻到原帖，并按正文、情感、相关性等继续筛选。“导出筛选样本”按钮以 CSV 格式导出当前匹配的全部记录，包含未显示在当前页的结果。

数据范围有两套：`outputs/` 的按年配额主样本，以及 `outputs/xiaohongshu-available/` 的小红书补充集。二者重叠，不能相加计数；补充集年份不均，当前主要来自 2026 年。图表只按已标注且相关的帖子统计情感、话题和情绪，无样本年份保留为空缺。

浏览网页仅需本机已有导出，无需设置 LLM 密钥，也不会重新采集或产生模型调用。重新运行 `export` 后点击页面“刷新数据”即可更新；首次还没有导出时，先按下文完成采集、分析和导出。“查看原帖”使用平台网页，能否读取取决于平台登录与原帖当前状态。

## 分别登录三个平台

在本项目的独立浏览器资料中手动登录；Windows 平常使用的 Chrome/Edge 登录状态不会自动共享到这些目录。以下命令逐条执行，每次确认登录成功后关闭整个浏览器窗口，再执行下一条：

```powershell
.\.venv\Scripts\python.exe -m playwright open --user-data-dir data/browser-profiles/weibo https://weibo.com
.\.venv\Scripts\python.exe -m playwright open --user-data-dir data/browser-profiles/xiaohongshu https://www.xiaohongshu.com
.\.venv\Scripts\python.exe -m playwright open --user-data-dir data/browser-profiles/x https://x.com
```

不要同时用登录窗口和采集器打开同一个资料目录。平台若要求扫码或验证码，请在可见窗口完成；出现“IP at risk”等限制时，先确认正常浏览器能访问平台搜索，相关已知阻塞见 [BLOCKERS.md](BLOCKERS.md)。

## 先采集一个年份

下面以 2025 年秋招为例，日期范围为北京时间 8 月 1 日（含）至 11 月 18 日（不含）。小红书查询使用“26 届”，但最终年份仍由原帖发布时间验证。

```powershell
.\.venv\Scripts\python.exe run.py collect-browser --platform weibo --query '秋招' --start 2025-08-01 --end 2025-11-18 --limit 100 --timeout 180
.\.venv\Scripts\python.exe run.py collect-browser --platform xiaohongshu --query '26届 秋招' --start 2025-08-01 --end 2025-11-18 --limit 100 --timeout 180
.\.venv\Scripts\python.exe run.py collect-browser --platform x --query '秋招' --start 2025-08-01 --end 2025-11-18 --limit 100 --timeout 180
.\.venv\Scripts\python.exe run.py sample
```

`sample` 显示每个平台、每个年份的实际样本与缺口。默认目标为 2022—2026 年每个平台每年 40 条，共 200 条；候选数据需要多于最终样本量。参照 `outputs/search-plan.json` 对其他年份和关键词继续采集，或修改 `config.json` 的研究范围。不同查询重复获取的原帖按 ID 去重。

需要使用 Clash 时，可通过 `--proxy-server` 为本次采集浏览器单独指定代理。当前宿主机实测的 Clash 混合端口为 `7897`；其他设备请以 Clash 中显示的实际端口为准。例如：

```powershell
.\.venv\Scripts\python.exe run.py collect-browser --platform x --query '秋招' --start 2025-08-01 --end 2025-11-18 --limit 100 --timeout 180 --proxy-server http://127.0.0.1:7897
```

这个参数只影响本次采集进程。登录窗口如果也需要同一路径，可用 `python.exe -m playwright open --proxy-server http://127.0.0.1:7897 --user-data-dir data/browser-profiles/x https://x.com`。

获得具有历史搜索权限的 X 官方凭据后，也可以使用 API 路径。`X_BEARER_TOKEN` 是 X 开发者凭据，与下一节的 sub2api 密钥分别配置：

```powershell
$xKey = Read-Host 'X API Bearer Token' -AsSecureString
$env:X_BEARER_TOKEN = [System.Net.NetworkCredential]::new('', $xKey).Password
Remove-Variable xKey
.\.venv\Scripts\python.exe run.py collect-x-api --query '秋招 -is:retweet' --start 2025-08-01 --end 2025-11-18 --limit 100 --endpoint all
```

## 配置 sub2api 并分析

若 Windows 用户目录已有可用的 `%USERPROFILE%\.codex\config.toml` 和 `auth.json`，程序会只读复用其中的网关、模型及 `OPENAI_API_KEY`。没有这些配置时，在当前 PowerShell 会话设置：

```powershell
$env:AUTUMN_LLM_BASE_URL = 'https://api.gfyh.fun/v1'
$env:AUTUMN_LLM_MODEL = 'gpt-6.1-sol'
$env:AUTUMN_LLM_API = 'responses'
$modelKey = Read-Host 'sub2api API Key' -AsSecureString
$env:AUTUMN_LLM_API_KEY = [System.Net.NetworkCredential]::new('', $modelKey).Password
Remove-Variable modelKey
```

密钥输入不会回显，环境变量仅保留在当前会话；无需把密钥写进项目文件。`.env.example` 是变量说明，程序不会自动加载 `.env`。

```powershell
.\.venv\Scripts\python.exe run.py doctor --live
.\.venv\Scripts\python.exe run.py llm-check
.\.venv\Scripts\python.exe run.py analyze --limit 16 --batch-size 8
.\.venv\Scripts\python.exe run.py analyze --batch-size 8
.\.venv\Scripts\python.exe run.py export
```

`llm-check` 会调用模型分析一条明确标记的合成文本，用于验证接入。先复核少量真实标注，再运行完整分析；已完成的结果按模型、提示版本和输入缓存，可续跑。导出文件为 `outputs/labels.csv`、`summary.json`、`sample.jsonl` 和 `report.md`。

## 离线检查与常见问题

```powershell
$env:PYTHONPATH = Join-Path (Get-Location).Path 'src'
.\.venv\Scripts\python.exe -W error -m unittest discover -s tests -v
```

- `No time zone found with key Asia/Shanghai`：确认在项目虚拟环境执行过 `pip install -e '.[browser]'`，Windows 的 `tzdata` 会随项目安装。
- Chromium 可执行文件不存在：确认安装浏览器和采集时使用相同的 `PLAYWRIGHT_BROWSERS_PATH`，再运行 `python.exe -m playwright install chromium`。
- 浏览器资料被占用：关闭使用同一 `data/browser-profiles/<platform>` 的其他浏览器窗口。
- 平台要求登录：回到本指南的独立资料目录完成登录；Linux 浏览器资料不需要迁移到 Windows。
- 历史数据不足：保留实际缺口，增加年份/届别关键词并检查详情时间。平台排序和历史可见性不保证每年都能达到目标。
