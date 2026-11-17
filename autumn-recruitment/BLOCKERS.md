# 真实采集状态与阻塞

检查日期：2026-11-17。目标为微博、小红书、X 各约 200 条，默认 2022—2026 年每年 40 条。

迁移到 Windows 的安装与登录步骤见 [WINDOWS.md](WINDOWS.md)。以下诊断响应、截图和运行库保留在此前 Linux 机器本地，已由 Git 忽略；仓库保留本报告中的实测结果摘要。

后续已在 Windows 宿主机部署并重新测试，小红书的当前阻塞为平台登录；最新状态见 [HOST_DEPLOYMENT.md](HOST_DEPLOYMENT.md)。

**本次真实采集到的有效原帖：微博 0 / 200、小红书 0 / 200、X 0 / 200。** 已执行实际 HTTP 访问及浏览器访问；当前访问条件不足以取得原帖正文与原始发布时间。访问测试主要使用 2025 年秋招查询，并非已经逐年完成搜索；登录及网络入口阻塞使后续分年任务无法开始。

| 平台 | 实测阻塞 | 继续需要的条件 | 证据（均在项目目录内） |
| --- | --- | --- | --- |
| 微博 | 关键词历史搜索跳转 `passport.weibo.com` 访客入口；真实 Playwright 采集器运行后明确检测到登录要求并停止。移动搜索接口另返回 HTTP 432。 | 用户在本项目的微博浏览器资料中正常登录，确认能够看到搜索原帖后重跑；若需要验证码，由用户在页面完成。 | `data/diagnostics/weibo.response`、`weibo-collector-attempt.json` |
| 小红书 | 普通浏览器访问搜索后，`/login/activate` 返回 HTTP 461；跳转“安全限制”，显示 `IP at risk. Switch to a secure network and retry.`，错误码 `300012`。原始搜索 HTML 的帖子数组为空，浏览器原帖链接数为 0。 | 先使用户的正常访问环境能够打开平台搜索，再在本项目浏览器资料中正常登录；随后检查历史帖详情时间是否可见。 | `data/diagnostics/xiaohongshu-browser-evidence.json`、`xiaohongshu-browser.png`、`xiaohongshu-public-html-evidence.json` |
| X | 普通话题搜索跳转至 `mode=login` 的登录页面；官方历史搜索接口 `api.twitter.com/2/tweets/search/all` 返回 HTTP 401 `Unauthorized`。本机检查的 X/Twitter 凭据环境变量均未配置。`api.x.com` 的部分访问另有连接超时。 | 用户提供正常登录的 X 浏览器会话；或配置具有所需历史搜索权限的官方 `X_BEARER_TOKEN`。已有 sub2api 密钥用于模型调用。 | `data/diagnostics/x_access_findings.json` 及其引用的响应记录 |

本次发现的浏览器运行依赖问题已经在项目内处理：`.venv/` 已安装 Python Playwright，缺失的 ALSA 共享库已解包到 `data/browser-runtime/`。上表记录的是运行环境修复后实际观察到的入口阻塞。

当前机器无图形桌面、无三个平台的已登录浏览器资料。在用户具备图形桌面的正常环境中，可按 README 的 `playwright open --user-data-dir ...` 命令登录，并保留每个平台独立的资料目录。正常登录后仍需验证历史搜索范围，才能确定各年份实际能取得多少条。

## 已验证可用的分析部分

- `https://api.gfyh.fun/v1` 已通过本机现有密钥鉴权，当前配置模型 `gpt-6.1-sol` 可见。
- 已真实调用 `/responses`，并校验返回的话题、情感、情绪和逐字原文证据；测试消耗 788 tokens。
- 该模型连通性检查使用明确标记的合成文本，**没有计入任何平台的真实数据**。记录在 `outputs/sub2api-check.json`。
- 离线导入、时间边界、抽样、缓存、统计及导出等 29 项测试通过。

## 继续运行

本机已有 Chromium 时，可沿用当前项目内的运行库设置。以下命令使用已有浏览器执行已登录资料中的采集；`--headless` 适合无桌面采集，首次交互登录需要可见浏览器环境。

```bash
cd /home/lizd/work/uncontrolled-pottery/autumn-recruitment
export LD_LIBRARY_PATH="$PWD/data/browser-runtime/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
.venv/bin/python run.py collect-browser --platform weibo --query '秋招' \
  --start 2025-08-01 --end 2025-11-18 --limit 100 --timeout 180 \
  --headless --browser-executable /home/lizd/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome
```

获得 X API 凭据后，通过环境配置 `X_BEARER_TOKEN`，再执行 README 中的 `collect-x-api --endpoint all`。采集完成后运行 `sample`、`analyze`、`export`；实际不足的年份会保留缺口。
