# 当前 Windows 宿主机部署记录

部署日期：2026-11-17。宿主机为 `DESKTOP-6285DI7`，通过 WSL 调用 Windows 原生 PowerShell 完成部署。

## 已完成

- 部署目录：`C:\Users\lizd\work\autumn-recruitment`；只同步项目源文件，Windows 的运行环境和数据单独保存在该目录内。
- Windows 原生 Python 3.14.7，项目 `.venv` 已安装 Playwright 1.65.2、greenlet 和 tzdata，项目内 Chromium 已安装。
- Windows 原生离线测试 33 项通过，生成了 45 个分平台、分年份、分关键词查询任务。
- Windows 原生 `doctor --live` 成功，网关为 `https://api.gfyh.fun/v1`，模型 `gpt-6.1-sol` 可用。
- 现有 LLM 凭据通过 `\\wsl.localhost\Ubuntu-24.04\home\lizd\.codex\` 只读引用，配置路径保存在宿主部署目录的 `data\host-env.ps1`。
- AdsPower 技能已按用户指定的 `npx skills add ... --skill adspower-browser` 安装在 WSL 用户的 `~/.agents/skills/adspower-browser`，其 CLI 已可运行；宿主机既有 AdsPower 客户端已启动。
- Clash Verge 运行中，混合代理地址 `http://127.0.0.1:7897`；通过该代理的 X 访问测试成功。X 采集器使用明确的进程级代理参数。

## 真实采集结果与当前阻塞

已用 Windows 原生、可见的 Chromium 执行 2025 年秋招关键词搜索，每个平台先请求 3 条原帖以验证入口。**当前有效原帖数量仍为微博 0、小红书 0、X 0。**

| 平台 / 工具 | 宿主机实测结果 | 继续所需 |
| --- | --- | --- |
| 微博 | 采集器检测到登录要求并停止 | 在 `data/browser-profiles/weibo` 的独立浏览器中正常登录 |
| 小红书 | 采集器检测到登录要求并停止；本轮未再出现此前 Linux 测试的 IP 风险页 | 在 `data/browser-profiles/xiaohongshu` 中完成正常登录 |
| X | 通过 Clash 可访问，但搜索跳转 `/i/jf/onboarding/web?...&mode=login`；页面显示“电子邮箱或用户名”，原帖数为 0。采集器已补齐对此登录页的识别 | 在 `data/browser-profiles/x` 中完成正常登录；官方 API 路径另需 X Bearer Token |
| AdsPower | 客户端已运行，但本地 API `50325` 当前不可访问，相关 API Key 环境变量未配置 | 在客户端确认账号及 Local API 状态，再提供可用的本机 API 接入；可见 Playwright 浏览器可先用于平台登录 |

宿主机证据文件位于 `C:\Users\lizd\work\autumn-recruitment\data\diagnostics\`，包括 `host-collector-weibo.json`、`host-collector-xiaohongshu.json`、`host-collector-x.json`、`host-x-browser.json`、`host-collection-attempts.json` 和 `model-doctor.json`。这些文件、浏览器资料及数据均由 Git 忽略。

本轮已为三个平台分别打开并确认可见的持久登录窗口。用户完成登录后需关闭对应窗口，释放资料目录，再继续采集；页面和进程的本机记录见 `data/diagnostics/host-login-windows.json`。

## 在宿主机继续操作

打开 PowerShell：

```powershell
Set-Location C:\Users\lizd\work\autumn-recruitment
$env:PYTHONUTF8 = '1'
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location).Path 'data\browser-binaries'
$env:AUTUMN_LLM_CONFIG_FILE = '\\wsl.localhost\Ubuntu-24.04\home\lizd\.codex\config.toml'
$env:AUTUMN_LLM_AUTH_FILE = '\\wsl.localhost\Ubuntu-24.04\home\lizd\.codex\auth.json'
.\.venv\Scripts\python.exe run.py doctor --live
```

`host-env.ps1` 仅包含项目目录和既有凭据文件的路径；WSL 的 `Ubuntu-24.04` 需要可运行。其他设备可按 [WINDOWS.md](WINDOWS.md) 的环境变量方法配置自己的 sub2api 接入。

完成独立浏览器登录并关闭对应窗口后，再执行采集：

```powershell
.\.venv\Scripts\python.exe run.py collect-browser --platform xiaohongshu --query '26届 秋招' --start 2025-08-01 --end 2025-11-18 --limit 100 --timeout 180
.\.venv\Scripts\python.exe run.py collect-browser --platform weibo --query '秋招' --start 2025-08-01 --end 2025-11-18 --limit 100 --timeout 180
.\.venv\Scripts\python.exe run.py collect-browser --platform x --query '秋招' --start 2025-08-01 --end 2025-11-18 --limit 100 --timeout 180 --proxy-server http://127.0.0.1:7897
.\.venv\Scripts\python.exe run.py sample
```

完整安装、登录和分析命令见 [WINDOWS.md](WINDOWS.md)。此前 Linux 环境的访问测试见 [BLOCKERS.md](BLOCKERS.md)；当前状态优先参考本记录及宿主机最新诊断。
