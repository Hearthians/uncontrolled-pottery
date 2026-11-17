# 焦虑评分部署记录

2026-11-17 完成全量评分与校园网部署，入口为 <http://10.7.4.11:8765/>。部署目标为 Windows 原生目录 `D:\lizd\work\autumn-recruitment`，8765 服务已通过现有重启脚本更新，校验时进程 ID 为 186444。

## 全量结果

- 六个平台合并去重后共 957 条，原相关性标签为相关 831 条、不相关 126 条；全部参加焦虑评分。
- 模型为 `gpt-6.1-sol`，评分版本为 `anxiety-intensity-v1`，全部 957 条获得有效评分；待评分、失败、无法判断均为 0 条。
- 755 条为 0 分，202 条为非零分；全体均值 0.0725182863，中位数 0，最高分 0.87。
- 160 份已保存 API 响应与 957 条最终结果逐条匹配；所有非零分都有逐字原文依据，没有丢弃的非原文引用。
- 合并正文 SHA-256 保持为 `22025e772b232b72601517fcc03bf817fcdeb5ce8d104361d1139443373ef38f`。原四份样本导出与 Windows 主目录对应文件哈希一致。

数值描述模型识别的文本焦虑表达。零分表示未见支持焦虑的表达；不能将这些结果解释为作者的心理诊断或总体市场焦虑水平。详细定义见 [焦虑评分说明](anxiety-scoring.md)，分平台、年份与真实示例见 `outputs/combined/anxiety-v1/report.md`。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| Linux 离线测试 | 100 项通过 |
| Windows 原生 Python 3.14.7 离线测试 | 100 项通过 |
| 独立全量数据核验 | 32,082 项通过，CSV 含全部 957 条 |
| 统一平台栏本地完整浏览器检查 | 163 项通过，无跳过 |
| 平台栏与评分整合定向检查 | 117 项通过 |
| 校园网最终平台栏检查 | 54 项通过 |
| 浏览器 JavaScript / console / HTTP 错误 | 均为 0 |
| 桌面与 390px 手机页面 | 已检查截图，无页面横向溢出 |

浏览器验收使用完整数据，未使用 `--allow-pending`。检查覆盖四个旧数据集数量、焦虑分数范围与空值、逐字证据、分布与年度图、平台/年份/正文/相关性/区间/状态筛选、排序、分页、完整筛选 CSV 导出，以及页内导航和跨数据集前进后退。校园网接口确认合并集 957 条均已评分；网页刷新与筛选不调用模型。

最终页面只保留统一平台栏和年份筛选，已移除样本范围分类与下拉框。“汇总”返回全部 957 条，小红书“按年样本”在 68 条配额样本与 207 条完整可用样本间切换，旧数据集链接仍兼容。较长说明可按需展开。静态更新前后，五套校园网 API 的完整响应字节哈希一致，评分、正文和标签均未改变。

## 部署与回溯

覆盖前的文件保存在 Windows `data/diagnostics/anxiety-backup-20261117T154200Z/`；备份清单记录原有文件及哈希，也记录新增文件。同步仅涉及网站代码、评分/验证脚本、测试、文档和合并导出。数据库、凭据、浏览器资料、虚拟环境与防火墙设置没有参与同步。

Windows 生产服务使用原生 `.venv\Scripts\pythonw.exe`。重启脚本先核对 8765 监听进程命令行，再只重启该网站服务；现有其他端口服务未调整。

最终平台栏更新只替换三份静态文件，无需重启；覆盖前备份位于 Windows `data/diagnostics/ui-platform-bar-backup-20261117-235746/`。

本地核验文件：

- `data/diagnostics/anxiety-data-audit.json`：全量数据核验及平台、年份统计。
- `data/diagnostics/anxiety-web-local/report.json`：本地最终浏览器结果。
- `data/diagnostics/anxiety-web/report.json`：校园网最终浏览器结果；同目录保留桌面/手机截图及下载的 CSV。
- `data/diagnostics/anxiety-windows-tests.txt`：Windows 原生测试日志。
- `data/diagnostics/anxiety-deployment-state.json`：同步清单、哈希和重启记录。
- `data/diagnostics/anxiety-web-unified-9wowFw/report.json`：统一平台栏的完整浏览器检查。
- `data/diagnostics/platform-bar-anxiety-integration/native/integration-qa.json`：校园网最终检查；同目录保存桌面与手机截图。
- `data/diagnostics/platform-bar-anxiety-integration/deployment-result.json`：最终静态文件哈希与备份位置。
