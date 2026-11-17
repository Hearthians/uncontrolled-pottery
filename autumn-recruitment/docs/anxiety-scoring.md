# 全平台焦虑程度评分

本轮将四份已有标注导出按 `platform:post_id` 合并去重，得到 957 条讨论：微博 200、小红书 207、牛客 141、Hacker News 200、The Workplace 200、Mastodon 9。四份输入共 1025 条，去除 68 条重叠的小红书记录；其中原相关性标签为相关 831 条、不相关 126 条。本次对全部 957 条评分，不先按相关性筛掉记录。

合并正文为 `outputs/combined/sample.jsonl`，SHA-256 为 `22025e772b232b72601517fcc03bf817fcdeb5ce8d104361d1139443373ef38f`。原四份导出与原标签保留，焦虑结果独立存放在 `outputs/combined/anxiety-v1/`。

## 评分含义

模型 `gpt-6.1-sol` 直接阅读完整原文，提示版本为 `anxiety-intensity-v1`。每次只提交匿名 `case_id` 和正文，不提供既有情感、情绪、强度、相关性标签。先检查覆盖六个平台的 36 条试评，再续跑其余记录；试评有意覆盖不同原标签，不能用来估计总体分布。

分数衡量整帖中作者自身表达的焦虑强度，包括回顾性的自述。统一尺度如下：

| 分数 | 解释 |
| --- | --- |
| 0 | 原文可理解，但没有文本支持的焦虑表达 |
| 0.10–0.25 | 轻微或含蓄的担忧、紧张 |
| 0.30–0.50 | 明确、中等程度的焦虑 |
| 0.55–0.75 | 较强的担忧或紧张 |
| 0.80–1.00 | 很强、明确的焦虑表达 |
| null | 原文不足以判断是否表达焦虑 |

这是连续尺度，上表为锚点。失业、拒信、岗位困难、愤怒、悲伤、普通问题或不确定性本身不能直接推出焦虑。积极情绪可与焦虑同时存在。分数不是患病概率、心理诊断、招聘景气度，也不是正负情感分数的换算。短文本可以得高分；长文本也可以得零分。

每个非零分保留一至两段逐字原文依据；零分和无法判断的依据为空。`confidence` 是模型对可判读程度的自评，没有校准，不乘入焦虑分数。模型单次标注尚未经独立人工效度验证，跨语言、平台与年份比较需结合各组实际样本量和来源差异。

## 运行与恢复

在项目目录执行，沿用已有只读模型配置与凭据。下列评分命令会产生真实 API 请求：

```bash
python3 scripts/score-anxiety.py --scope pilot
python3 scripts/score-anxiety.py --scope all
```

每批六条，默认最多两个并发请求。逐条缓存以正文哈希、记录 ID、模型及提示版本绑定；相同结果续跑时复用。改变正文、模型或提示后应使用新的版本目录，不能把不同条件的分数混在同一份结果中。

请求元数据和完整响应保存于 `requests/`；逐条结果保存在 `records/`。脚本先验证缓存、尝试从已保存的有效响应恢复结果，再决定是否需要付费调用。无效缓存会隔离到 `quarantine/`。不符合输出格式或缺少原文依据的记录最多进行三次格式修复请求；网络超时会保存错误并停止该批，不自动重复发送。确认错误原因后，可显式重试失败记录：

```bash
python3 scripts/score-anxiety.py --scope all --retry-errors
```

仅从本地缓存重建导出、核验完整数据：

```bash
python3 scripts/score-anxiety.py --scope all --export-only
python3 scripts/verify-anxiety-data.py
PYTHONPATH=src python3 -m unittest discover -s tests -v
```

`run.lock` 防止重复付费任务。若异常退出留下锁，须先核实锁内 PID 对应进程已停止，再移除锁；运行中不要删除。原始响应、正文及导出继续受 Git 忽略，不提交凭据或研究原始数据。

## 网站与导出

首页默认打开全平台合并集，包含全部 957 条。平台直接在一栏展开，“汇总”返回合并集；小红书可切换按年样本，原四个数据集的旧链接仍可打开。焦虑分布、年度均值和样本阅读区使用同一组当前筛选结果；原情感分类图保持其相关性统计口径。

焦虑功能包括完成数量、均值、中位数、无法判断数量、固定 0–1 分布与年度均值图、区间与状态筛选、分数排序、逐帖原文依据及 CSV 导出。真实零分参与均值；无法判断、待评分和失败分别保留状态，不填零、不参与均值。年度图使用发表年份，并显示有效评分数与缺口。

网页只读 `sample.jsonl`、`summary.json` 与 `anxiety-v1/scores.jsonl` 等导出。刷新、搜索或下载不会调用模型或修改数据库。后端按记录 ID 与正文哈希绑定分数，仅暴露展示所需字段；过期结果显示待评分，无效结果显示失败。

本机启动及浏览器检查：

```bash
python3 run.py serve --host 127.0.0.1 --port 8765
ANXIETY_URL=http://127.0.0.1:8765 node scripts/verify-anxiety-web.mjs
```

浏览器检查依赖父项目的 Playwright 和 csv-parse。评分尚未完成时可加 `--allow-pending` 做阶段检查；最终验收须省略该参数。

## Windows 校园网部署

目标目录为 `D:\lizd\work\autumn-recruitment`，校园网入口为 <http://10.7.4.11:8765/>。部署前将被覆盖文件备份到宿主目录的 `data/diagnostics/anxiety-backup-<时间>/`。同步以下文件：

- `web/app.js`、`web/index.html`、`web/styles.css`。
- `src/autumn_recruitment/web.py` 与新增 `src/autumn_recruitment/anxiety.py`。
- `outputs/combined/sample.jsonl`、`outputs/combined/summary.json`、`outputs/combined/anxiety-v1/scores.jsonl` 和 `summary.json`。
- 需要留档或离线检查时，附带评分脚本、验证脚本、相应测试、本文及评分 `manifest.json`、`prompt.txt`、`scores.csv`。

不复制数据库、虚拟环境、凭据、浏览器资料或网络设置。原始模型响应与逐条缓存留在评分环境中，网站运行不需要它们。使用现有 `data/restart-campus-web.ps1` 重启已识别的 8765 服务；不新建防火墙规则。Windows 原生 Python 执行离线测试，最终使用校园网地址运行浏览器验收。Linux 不写入 Windows 主库。

最终部署与验证结果见同目录的 `anxiety-deployment.md`。
