# Hacker News 与 Workplace 历史讨论采集核验

核验日期：2026-11-17。本次查阅接口文档并进行每次 1–3 条的小请求，评估其能否为微博、小红书之外增加约 200 条就业讨论样本；没有进行海外平台的正式批量采集。Reddit、Bluesky、Mastodon 和一亩三分地的核验见 [另一份报告](overseas-social-platforms.md)。

**优先考虑 Hacker News 的“Algolia 搜索 + HN 官方 Firebase 核验”；Workplace 可作补充，但历史样本量和研究对象需要另行确认。** 两者都已有返回历史正文和原始发表时间的真实请求证据，适合直接接入 API 采集器，无须先做 RPA。它们主要是英文、国际科技及职场讨论，研究时应作为独立比较组，不能直接替代中文秋招样本。

## 选择依据

| 来源 | 本次实际结果 | 历史覆盖和样本量结论 | 建议 |
| --- | --- | --- | --- |
| Hacker News | Algolia 搜索 HTTP 200；取得 2022、2023、2024、2025、2026 年的小量历史记录；HN 官方 Firebase 对已选 2024 主题帖、评论返回 200，正文及时间匹配 | 已证明可以按时间检索历史条目，但搜索命中包含无关内容，命中数不等于合格就业讨论数。2023、2024 的精确短语查询取得真实就业观点；其余年份的相关性仍需抽检 | 这两个候选中优先。使用多组关键词、月份时间片、相关性筛选；主题帖和评论分别建样本，不预先承诺五年各 40 条 |
| Stack Exchange Workplace | Linux 直连连接失败；Windows 原生请求经现有 Clash 返回 200；取得 2024 年问题、回答和评论的完整正文及原始日期 | `interview` 在 2024-08-01 至 2024-11-18 UTC 窗口的 API 候选总数为 36，单个检索词已不足每年 40 个问题；本次未验证其他年份数量 | 作为职场求职经验补充。先扩展关键词并按 ID 去重，再判断能否获得 200 条相关记录。若加入回答，要明确它们是另一些人的观点 |

“每个平台约 200 条”若指五年合计，可先规划每年 40 条；如果指每年 200 条，应重新评估采集量。当前结果只支持历史接口可行性，不代表已有 200 条清洗、去重、相关性合格的海外研究数据。

## Hacker News

### 接口与官方来源

- Algolia 的 HN Search 接口文档：<https://hn.algolia.com/api>。本次普通 GET 返回前端页面，使用正常浏览器渲染后取得完整接口说明。
- HN 官方 Firebase API：<https://github.com/HackerNews/API>；本次读取其 [README 原文](https://raw.githubusercontent.com/HackerNews/API/master/README.md)，HTTP 200。

这两个来源的角色不同：**Algolia 是提供 HN 搜索索引的服务商；Firebase API 是 HN 官方单条数据源。** 不应把 Algolia 称为 HN 官方全文搜索 API。

Algolia 支持 `/api/v1/search`（相关性排序）、`/api/v1/search_by_date`（时间排序），以及 `query`、`tags`、`numericFilters`、`page`、`hitsPerPage`。`numericFilters` 可对 `created_at_i` 等数字字段使用比较运算；`tags=story`、`tags=comment` 可区分条目类型。文档目前说明单 IP 限制为每小时 10,000 次；实际研究只需少量串行请求、缓存和退避，无须接近此上限。

Firebase 的 `/v0/item/<id>.json` 返回条目的 `type`、原始 Unix 秒 `time`、HTML `text`、父条目或子评论 ID 等字段。对已删除、失效、没有正文的条目应按实际字段处理。

### 实测查询及证据

本次可行性探测统一使用 **UTC 8 月 1 日（含）至 11 月 18 日（不含）**；不是正式研究配置所用的北京时间窗口。2026 年仅能得到核验时已发表的记录。下面的 `nbHits` 是服务商对该查询的报告值，均未做逐条相关性审核。

| 查询 | HTTP | `nbHits` | `exhaustiveNbHits` | 实际取得 |
| --- | --- | --- | --- | --- |
| 2022，`query=job market`，`tags=story` | 200 | 97 | false | 1 个主题帖 |
| 2024，同词、主题帖 | 200 | 117 | false | 3 个主题帖 |
| 2024，同词、评论 | 200 | 1,612 | false | 3 条评论 |
| 2025，同词、主题帖 | 200 | 119 | false | 1 个主题帖 |
| 2026，同词、主题帖 | 200 | 105 | false | 1 个主题帖 |
| 2023，`query="job market"`，`tags=comment` | 200 | 425 | true | 3 条评论 |
| 2024，同带引号短语、评论 | 200 | 354 | true | 3 条评论 |

2024 年的宽泛评论查询报告 `nbHits=1612`，同时 `hitsPerPage=3`、`nbPages=334`，不能通过一次大查询的页码认为已覆盖所有报告命中。正式采集应按月或周拆分、遵守返回页数，并以实际取得的唯一 ID 计数。即使精确短语查询的 `exhaustiveNbHits=true`，它也只描述当前索引中该次查询的计数，不能证明覆盖 HN 所有历史内容，更不能证明全部符合研究主题。

宽泛查询确实有明显噪声：2024 年第一条评论 `42168420` 在讨论储水容器，虽被 `job market` 命中，仍应剔除。带引号短语查询取得更好的例子：

- 评论 [42150592](https://news.ycombinator.com/item?id=42150592)，原始时间 `2024-11-15T20:27:54Z`，所在主题为 “Ask HN: What job search strategies work for you?”；正文讨论职位平台、内推、应届求职者展示项目及找工作的辛苦。
- 评论 [42149188](https://news.ycombinator.com/item?id=42149188)，原始时间 `2024-11-15T17:51:28Z`，所在主题为 “Please stop the coding challenges”；评论表达对求职市场和编程面试的态度。
- 评论 [38296239](https://news.ycombinator.com/item?id=38296239)，原始时间 `2023-11-16T22:04:41Z`，讨论就业市场收紧、关系网络、财务和工作生活平衡。

精确短语也有其他劳动力议题及玩笑式评论，仍需检查就业市场评价、求职经验、招聘阶段是否符合研究口径；不能只凭包含该短语就通过。

HN 官方 Firebase 对主题帖 [42164448](https://hacker-news.firebaseio.com/v0/item/42164448.json) 和评论 [42168420](https://hacker-news.firebaseio.com/v0/item/42168420.json) 均返回 200：原始时间分别为 `2024-11-17T14:47:29Z`、`2024-11-17T23:52:09Z`，与搜索记录一致，且有正文、未标记 `deleted` 或 `dead`。这验证了原文核验路径；不代表后者通过主题筛选。稍后对另一评论的 Linux 直连出现网络连接失败，说明部署仍需保留网络错误重试和失败记录。

### 采样与接入方式

现有统一管线可增加 `hn` API 采集器：按关键词和时间片从 Algolia 获取候选，保存请求及原始响应；按 ID 去重，再经 Firebase 对抽样或入选记录核验原始时间、正文和可见状态，最后进入现有清洗、主题与情绪分析。

优先选择有正文的 Ask HN 求职讨论和相关评论。许多 `story` 只有外链和标题，不足以推断作者情绪；每月 “Who is hiring?” 则多为雇主岗位广告，应排除或单独归类。建议关键词覆盖 `"job market"`、`"new grad"`、`"job search"`、`"hiring freeze"`、`layoffs` 等，但每个词都要验证，不能把关键词集合直接当成有效样本。

主题帖和评论使用不同的 `entry_type`。评论保留 `parent_id`、原主题 ID 和必要上下文；在采样前确定每个主题、每个作者的上限，防止一个热门主题或高频作者占满某年样本。回答他人、讽刺及引用原文的情绪，应归给实际发言人，并允许模型标记不确定。

## Stack Exchange Workplace

### 接口与官方来源

- 高级搜索：<https://api.stackexchange.com/docs/advanced-search>
- 限流规则：<https://api.stackexchange.com/docs/throttle>

两个官方文档经 Windows 原生请求、现有 Clash 本地代理取得 HTTP 200。本次 Linux 普通请求在网络连接阶段失败，不能由此断言 API 或账号无权限。

`/2.3/search/advanced?site=workplace` 支持 `q`、`fromdate`、`todate`、排序和分页；`filter=withbody` 可带回 HTML 正文。问题、回答、评论有独立条目 ID 和各自的 `creation_date`，后续应以各条目的原始时间为准，而不是问题最后活跃时间。

### 实测请求

```text
https://api.stackexchange.com/2.3/search/advanced?site=workplace&q=interview&fromdate=1722470400&todate=1731887999&sort=creation&order=desc&pagesize=3&filter=withbody
```

该请求返回 HTTP 200、`has_more=true`、`quota_remaining=299`。三个问题均含完整 HTML 正文：

| 问题 ID | 原始创建时间 UTC | 讨论内容 |
| --- | --- | --- |
| [199602](https://workplace.stackexchange.com/questions/199602) | 2024-11-14 10:21:40 | 公司内部岗位录用后变成更低职位、薪酬和工作感受 |
| [199597](https://workplace.stackexchange.com/questions/199597) | 2024-11-13 11:19:08 | 德国新工作试用期与育儿假安排 |
| [199573](https://workplace.stackexchange.com/questions/199573) | 2024-11-10 23:23:17 | 管理岗面试、另设岗位后再次被拒 |

对同一关键词、同一时间窗使用 `filter=total`，接口返回 **`total=36`**。这是该次检索的候选问题总数，未经相关性筛选；不能报告为 36 条合格的秋招市场言论。上面样本已显示它覆盖更广泛的在职和中途求职人群。

对这三个问题使用 `/questions/{ids}/answers`、`/questions/{ids}/comments`，同时限定同一日期窗、`pagesize=3`、`filter=withbody`，均返回 HTTP 200。答案 `199623` 原始日期为 `2024-11-16T17:10:07Z`，评论 `657180` 为 `2024-11-15T13:50:57Z`，均有正文。它们证明可取得历史回复，不证明回复作者和提问者属于同一个情绪主体。

### 采样与配额

如果接入现有研究，先固定样本单位：可只取提问者的亲历求职叙述，也可单独建立回答者观点组。若把 36 个问题的多条回复累计至 200 条，必须明确报告为“问题与回复条目”，保留所属问题和作者，并限制每题贡献量，不能报告成 200 位独立求职者。

`interview` 单词不足以完成每年 40 个问题的目标。可以试验多个求职、录用、裁员关键词并去重，但本次没有验证其他检索词和年份的可用总数。下一步应先对每年取得少量真实记录，确定相关性和语言、地区、招聘阶段后再扩量。

采集器读取 `quota_remaining` 和 `backoff`。官方文档要求出现 `backoff` 时等待指定秒数，同一语义请求不应每分钟重复发送。当前无 key 请求实际返回剩余配额 299；不要把文档中其他认证模式的默认配额直接套用为当前可用额度。采集完整正文时保留返回的 `content_license`、原文链接和作者归属字段，以便按来源要求进行归属说明。

## 与现有秋招项目衔接

维持独立目录和现有流程：原始响应进入 `data/raw/`，标准化和筛选进入现有数据库，抽样后复用已接入的模型接口，输出主题、情绪、置信度及不确定原因。公开分析报告按需使用作者稳定散列，原始可追溯标识留在本地原始数据中。

除了统一记录的正文、URL、作者、原始日期和采集时间，海外数据应增加或保留 `language`、`market_region`、`entry_type`、`parent_id`、`thread_id`、`retrieval_query` 和原文授权信息。正式时间窗从项目配置的北京时间转换为 UTC；不能直接复制本报告为可行性测试写死的 UTC 边界。

中文秋招样本、英文科技就业讨论和一般职场问答分别分组；各组报告实际年份、样本单位、候选数、剔除数及最终条数。模型应先判断相关性和广告属性，再标注主题及发言者情绪；不相关、纯新闻标题、岗位广告、纯建议且无法确定情绪的条目应按口径剔除或标记。样本属于可复核的方便样本，不能仅凭其负面比例推断整个国家或地区就业市场。

实测请求元数据和原始响应保存在被 Git 忽略的 `data/diagnostics/`：

- `overseas-hn-docs-rendered.*`、`overseas-hn-firebase-docs.*`：服务商和官方文档。
- `overseas-hn-stories-*.{json,response}`、`overseas-hn-comments-2024.*`：宽泛搜索原始结果。
- `overseas-hn-exact-comments-2023.*`、`overseas-hn-exact-comments-2024.*`：带引号短语的三条小请求及原始响应。
- `overseas-hn-firebase-story.*`、`overseas-hn-firebase-comment.*`：官方条目核验。
- `overseas-workplace-docs-proxy.*`、`overseas-workplace-throttle-docs-proxy.*`：官方文档。
- `overseas-workplace-2024-proxy.*`、`overseas-workplace-2024-total-proxy.*`、`overseas-workplace-2024-answers-proxy.*`、`overseas-workplace-2024-comments-proxy.*`：Workplace 问题、总数、回答和评论。

这些诊断记录用于复核可行性，不计入已完成的研究样本量。
