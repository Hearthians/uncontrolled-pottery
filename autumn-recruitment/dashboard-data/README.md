# 秋招可视化数据快照

这份快照包含网站可查看的五组样本、话题和情绪标注、逐年统计，以及全平台合并集的 957 条焦虑评分。

| 样本组 | 条数 | JSONL |
| --- | ---: | --- |
| 全平台合并集 | 957 | [sample.jsonl](outputs/combined/sample.jsonl) |
| 按年配额样本 | 268 | [sample.jsonl](outputs/sample.jsonl) |
| 小红书补充集 | 207 | [sample.jsonl](outputs/xiaohongshu-available/sample.jsonl) |
| 国内补充平台 | 141 | [sample.jsonl](outputs/additional-chinese/sample.jsonl) |
| 海外就业讨论 | 409 | [sample.jsonl](outputs/overseas-employment/sample.jsonl) |

合并集已经去重，各样本组有重叠。评分表包含帖子正文、平台、年份、焦虑分数、证据和解释。它可以用 Excel 打开，也有 JSONL 版本供程序读取。[评分 CSV](outputs/combined/anxiety-v1/scores.csv) · [评分 JSONL](outputs/combined/anxiety-v1/scores.jsonl)

公开快照使用网页展示字段，来源链接去掉登录和跟踪参数。4 条帖子的邮箱以 `[email redacted]` 代替，样本数量、标签和分数沿用原结果。`text_sha256` 和 `corpus_sha256` 对应此快照中的正文和合并文件。

在新克隆的仓库中进入 `autumn-recruitment/`，用 Python 3.11 或更新版本运行以下命令。已有 `outputs/` 时，复制命令会报错并保留现有文件。

```bash
python3 -c "from shutil import copytree; copytree('dashboard-data/outputs', 'outputs')"
python3 run.py serve --host 127.0.0.1 --port 8765
```

浏览器打开 [本地网站](http://127.0.0.1:8765/)。Windows 上可用 `py -3` 代替 `python3`。
