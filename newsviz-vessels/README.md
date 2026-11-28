# Guardian AI 陶器预览（Newsviz vessels）

把《卫报》人工智能标签（`technology/artificialintelligenceai`，2005–2026，仅 Tag、不含关键词补集）上的分数，映射到本仓库小君年行为预览所用的粘土失败语法（Prototype C，Data-driven）。此目录是**独立副本**，不改动 `xiaojun-version/behaviour/annual` 和失控陶坊主应用。

在线预览（请带末尾斜杠）：

- 年度三瓶：https://gfyh.fun/rank/newsviz-vessels/
- 月度十二肋：https://gfyh.fun/rank/newsviz-vessels-monthly/
- 月份自下而上叠层：https://gfyh.fun/rank/newsviz-vessels-stacked/
- 十二道螺旋褶皱：https://gfyh.fun/rank/newsviz-vessels-fluted/
- 按年份上下滚动（当前年放大、邻年为预览）：https://gfyh.fun/rank/newsviz-vessels-scroll/

## 分数怎么进泥土

三个维度并排（或在滚动页中每年三件）：

- **Valence**：原分数 −1…+1，按 `(1 − v) / 2` 倒置后使用（越高越负面）
- **Alarmist**、**Angry**：0–1，分数越高形变越强

五个行为档：Stable [0, .20)、Gaps [.20, .40)、Bulging [.40, .60)、Misalignment [.60, .80)、Sagging [.80, 1]。空月份保持规则粘土，并在界面标出，不要读成低分。2026 年观测到 11 月 27 日，十二月未观测，褶皱更浅。粒度分析见 `reports/monthly-granularity.md`。数据接口说明见 `vessel-preview/DATA_INTERFACE.md` 及其 monthly / stacked 姊妹文档。

## 本地运行预览

已包含导出好的年份包，无需重新爬取或打分。

```sh
cd vessel-preview
npm ci
npm run dev            # 年度三瓶，http://127.0.0.1:5178/
npm run build          # dist/，base 默认 /rank/newsviz-vessels/
npm run build:monthly  # 十二肋
npm run build:stacked  # 月份叠层
npm run build:fluted   # 螺旋褶皱
npm run build:scroll   # 按年滚动画廊
npm test
```

构建脚本会把 `../data/vessels/` 或 `../data/vessels-monthly/` 同步到对应的 `public*/data/`（这些目录已忽略，不必提交）。

## 重新导出年份包

脚本只依赖标准库。默认输入是 Newsviz 发布包（本目录未收录完整爬取缓存与密钥）。若已有该 bundle：

```sh
python3 scripts/export_vessels.py --assets /path/to/newsviz-assets --out data/vessels
python3 scripts/export_vessels_monthly.py --assets /path/to/newsviz-assets --out data/vessels-monthly
python3 -m unittest tests.test_export_vessels
```

请勿把 Guardian API 密钥或 `.env` 放进本目录。
