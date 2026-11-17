# 当前 Windows 宿主机部署记录

部署日期：2026-11-17。宿主机为 `DESKTOP-6285DI7`，通过 WSL 调用 Windows 原生 PowerShell 完成部署。

项目已从原 C 盘目录迁移到 `D:\lizd\work\autumn-recruitment`。迁移前停止项目浏览器并检查数据库，迁移后核验 86 个关键数据与登录文件的 SHA256，全部一致，旧目录已移除；虚拟环境已在 D 盘重建。

## 已完成

- 部署目录：`D:\lizd\work\autumn-recruitment`；只同步项目源文件，Windows 的运行环境和数据单独保存在该目录内。
- Windows 原生 Python 3.14.7，项目 `.venv` 已安装 Playwright 1.65.2、greenlet 和 tzdata，项目内 Chromium 已安装。
- Windows 原生离线测试 80 项通过；原三平台生成了 45 个分平台、分年份、分关键词查询任务，新增公开来源使用独立采集器和配置。
- Windows 原生 `doctor --live` 成功，网关为 `https://api.gfyh.fun/v1`，模型 `gpt-6.1-sol` 可用。
- 现有 LLM 凭据通过 `\\wsl.localhost\Ubuntu-24.04\home\lizd\.codex\` 只读引用，配置路径保存在宿主部署目录的 `data\host-env.ps1`。
- AdsPower 技能已按用户指定的 `npx skills add ... --skill adspower-browser` 安装在 WSL 用户的 `~/.agents/skills/adspower-browser` 及 Windows 的 `%USERPROFILE%\.agents\skills\adspower-browser`，后续会话可发现该技能；WSL 侧 CLI 已验证可运行，宿主机既有 AdsPower 客户端已启动。
- Clash Verge 运行中，混合代理地址 `http://127.0.0.1:7897`；通过该代理的 X 访问测试成功。X 采集器使用明确的进程级代理参数。

## 本地可视化操作

项目已增加本地年度可视化网页，入口为 <http://127.0.0.1:8765/>。在 `D:\lizd\work\autumn-recruitment` 中双击 `launch-dashboard.cmd` 启动，或打开 PowerShell：

```powershell
Set-Location D:\lizd\work\autumn-recruitment
$env:PYTHONUTF8 = '1'
.\.venv\Scripts\python.exe run.py serve --host 127.0.0.1 --port 8765
```

命令行启动的服务以 `Ctrl+C` 停止，终端关闭后需要重新启动。网页只读现有导出，不依赖模型密钥，不发起采集和 LLM 调用。

页面支持年份/平台切换、条数与占比、年度情感图、话题排名、情绪图、样本覆盖、原帖筛选和当前筛选 CSV 导出。主数据读取 `outputs/`，小红书补充集读取 `outputs/xiaohongshu-available/`；两套结果有重叠，不能相加。补充集偏重 2026 年，小红书历史缺口和 X 的空样本会在界面保留。

另有“国内平台补充集”（`outputs/additional-chinese/`）与“海外英文就业讨论”（`outputs/overseas-employment/`）：牛客入选 141 条、相关 133 条；海外组 409 条、相关 382 条，均已完成标注。海外组包含 Hacker News 200、Workplace 200、Mastodon 9 条，以一般就业讨论独立解读。真实校园网页面已完成 326 项统计、API、交互、CSV 和响应式检查，全部通过。采集结果和续跑命令见 [新增平台采集记录](docs/additional-collection.md)。

数据范围现以四个可见按钮展示。切换会更新地址中的 `dataset`，刷新、分享以及浏览器前进后退均保留对应范围；可直接打开 [国内补充](http://10.7.4.11:8765/?dataset=additional-chinese) 或 [海外就业](http://10.7.4.11:8765/?dataset=overseas-employment)。

图表统计范围由平台和年份控制；阅读区可再按关键词、情感、相关性、话题和情绪筛选。导出按钮包含当前匹配的全部分页结果。完成新的 `export` 后，点击“刷新数据”加载最新导出；只刷新网页不会增加模型调用。

## 校园网访问

按用户授权，当前宿主机已监听 `0.0.0.0:8765`，校园网入口为 <http://10.7.4.11:8765/>；本机入口 <http://127.0.0.1:8765/> 同样可用。Windows 原生与 WSL 到校园网地址的 HTTP 连通验证均成功，其他校园网设备的实际连接还取决于校园网的路由和访问策略。

Windows 防火墙规则 `AutumnRecruitment-Web-8765-Campus` 仅允许以太网接口、本机 `10.7.4.11` 的 TCP `8765`，远端范围为 `10.0.0.0/8`。页面只提供展示字段，浏览器资料、原始响应及密钥文件不在 HTTP 文件目录中。

本机 `data/dashboard-network.json` 保存已授权的网络监听方式，双击启动器会继续使用该设置。IP 变化时需要更新当前地址对应的防火墙规则和分享链接；配置文件、进程记录及网络诊断由 Git 忽略。

## 真实采集结果与当前阻塞

微博、小红书已在项目独立 Chromium 中正常登录，迁移保留了这两个平台的资料。当前状态如下；具体逐年数量以最新 `outputs/summary.json` 为准。

| 平台 / 工具 | 宿主机实测结果 | 当前限制 |
| --- | --- | --- |
| 微博 | 471 条真实原帖；2022—2026 年各选 40 条，共 200 条候选样本 | 月度搜索前部结果集中在每年 8/31、9/30、10/31、11/17 四天，存在排序与日期偏差。200 条候选不等于 200 条经模型确认相关的个人言论 |
| 小红书 | 已取得 250 条真实原帖；当前入选 68 条，逐年为 3 / 0 / 8 / 17 / 40 | 通过正常 UI“最多点赞”找到部分历史帖；2023 年定向补采进入平台安全限制页（`300013`），已停止，2022—2025 配额仍不足 |
| X | 通过 Clash 可访问，但搜索进入登录页，当前原帖为 0 | 仍需正常登录独立 X 资料，或配置具备历史检索权限的官方 API 凭据 |
| AdsPower | 客户端已运行，技能已安装；本地 API `50325` 仍不可访问 | 当前实际采集使用 Playwright 持久浏览器资料；待 Local API 正常后才能连接 AdsPower |

已核实微博 2026 年搜索卡片省略的年份：采集器正常打开原帖详情，读取该页面自己的详情响应和原始 `created_at`，按原帖 ID 匹配，不推测年份。小红书读取详情页实际渲染的完整正文与原始 `time`，不把更新时间、搜索关键词或届别当作发表时间。

分析复用既有 sub2api 接入。提示版本为 `recruitment-v2`，排除无个人经历或实质观点的纯招聘、营销及追星内容；标签按模型、提示版本及内容哈希缓存。已清理 132 条微博正文末尾的已确认页面“收起d”按钮文字，原始观察记录保留，受影响标注重新生成。模型证据片段须逐字出现在正文中。3 条明确含窗口后新增内容的小红书历史笔记已从按年比较排除，原始记录保留。

最终主报告为 268 条候选、268 条已标注、212 条模型确认相关。微博 200 条候选中相关 163 条；小红书主样本 68 条中相关 49 条。另提供小红书 207 条可用补充集，全部标注、相关 153 条，位于 `outputs/xiaohongshu-available/`，年份分布 3 / 0 / 8 / 17 / 179；这套补充集与主样本重叠，不能相加计数。

数据库、原始响应、登录资料和诊断保存在本机项目的 `data/`，报告及标签在 `outputs/`，均由 Git 忽略。迁移核验见 `data/diagnostics/directory-migration.json`；清洗记录见 `post-migration-quality.json`，最终数据完整性与标签校验见两套输出中的 `quality-audit.json`。海外平台核验见 [HN / Workplace](docs/overseas-platforms.md) 与 [其他海外社交平台](docs/overseas-social-platforms.md)。

## 在宿主机继续操作

打开 PowerShell：

```powershell
Set-Location D:\lizd\work\autumn-recruitment
$env:PYTHONUTF8 = '1'
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location).Path 'data\browser-binaries'
$env:AUTUMN_LLM_CONFIG_FILE = '\\wsl.localhost\Ubuntu-24.04\home\lizd\.codex\config.toml'
$env:AUTUMN_LLM_AUTH_FILE = '\\wsl.localhost\Ubuntu-24.04\home\lizd\.codex\auth.json'
.\.venv\Scripts\python.exe run.py doctor --live
```

`host-env.ps1` 仅包含项目目录和既有凭据文件的路径；WSL 的 `Ubuntu-24.04` 需要可运行。其他设备可按 [WINDOWS.md](WINDOWS.md) 的环境变量方法配置自己的 sub2api 接入。

确认对应资料没有被其他窗口占用后，再执行采集：

```powershell
.\.venv\Scripts\python.exe run.py collect-browser --platform xiaohongshu --query '26届 秋招' --start 2025-08-01 --end 2025-11-18 --limit 100 --timeout 180
.\.venv\Scripts\python.exe run.py collect-browser --platform weibo --query '秋招' --start 2025-08-01 --end 2025-11-18 --limit 100 --timeout 180
.\.venv\Scripts\python.exe run.py collect-browser --platform x --query '秋招' --start 2025-08-01 --end 2025-11-18 --limit 100 --timeout 180 --proxy-server http://127.0.0.1:7897
.\.venv\Scripts\python.exe run.py sample
```

补充集的本机配置为 `data/xiaohongshu-available-config.json`，只启用小红书且设置 `sampling.mode=available`。可续跑：

```powershell
.\.venv\Scripts\python.exe run.py --config data\xiaohongshu-available-config.json analyze --batch-size 16
.\.venv\Scripts\python.exe run.py --config data\xiaohongshu-available-config.json export
```

完整安装、登录和分析命令见 [WINDOWS.md](WINDOWS.md)。此前 Linux 环境的访问测试见 [BLOCKERS.md](BLOCKERS.md)；当前状态优先参考本记录及宿主机最新诊断。
