# Xiaojun 3E 与记忆陶器的兼容性评估

评估日期：2026-11-11。结论：**可以按模块整合；当前不适合整体替换记忆陶器的生成与显示流程。**
本轮只增加评估文档和离线探针，没有修改作品源代码、依赖、交接版源码或公网部署。

评估对象是 [11 月 11 日交接版](../xiaojun-version/handoff-20261111/Prototype-B-Handoff/HANDOFF.md)，
不是目前作品引用的 `xiaojun-version/GrammarofFailure_PrototypeB_v1` 旧快照。
当前作品已经复用了旧快照的 `geometry.ts` 和 `clayAppearance.ts`；新版这两个文件与旧版逐字节相同。
`serialization.ts` 也相同，`toolpath.ts` 只新增可选的 `contourOffsetXY` 类型字段。
本轮使用当前真实器形配方，确认两版生成的完整 canonical 对象深度相等，且旧对象可通过新版算子的 TypeScript 和运行时接口。

| 部分 | 兼容性与价值 | 接入要求 |
| --- | --- | --- |
| 基础器形、材质、canonical JSON | 可兼容升级；当前配方的完整结果与 geometryId 不变 | 单独升级这些引用不会带来新的黏土效果 |
| 记忆区域 → Failure Schedule | 四组强度能准确映射到对应物理层，底部与收口保持零输入 | 通过 manifest 的归一化高度重映射，不能假定其他切片设置仍有 64 层 |
| Gaps＋支撑接触 | 真实配方及区域数据下运行成功；有较完整的接触、材料保留与诊断记录 | 适配连续螺旋、统一截面、移出主线程；重新校准缺口尺度 |
| Reactive Sagging | 可调用，但当前完整基础器形上的单独运行没有实际下垂 | 必须接收缺料／位移后的实际沉积路径；不能只对原始完整器形调用 |
| Expressive Sagging | 可产生明显垂落，但会主动修改喷头轨迹 | 不能直接当作“喷头按原轨迹走、泥条随后下垂”的替代品 |
| Bulges | 小型官方演示通过；当前器形上的测试被重叠检查拒绝 | 先解决堆料范围重叠；同时接入停留时间与出料量模型 |
| Layer Offsets | 当前配方下可运行，实际修改喷头路径并加入空行程 | 需要定义区域强度输入及与连续螺旋的关系 |
| 完整 App／ClayScene | React、TypeScript、Three.js 版本范围一致 | 页面状态、全局 CSS、播放器和数据模型需要整合；不是本轮已验证的替换方案 |

当前作品的必要约束有三项：保留原器形、喷头连续螺旋运行、泥条截面为饱满椭圆。
新版直接接入时存在以下冲突。

1. **路径与时间。** 当前配方在新版中产生 64 个闭合轮廓、63 段独立抬层挤出。
   这些命令首尾衔接，并非位置瞬移，但不是当前连续上升的螺旋。
   新版按命令长度／速度计算约 907.21 秒的标称路径时间；当前页面用 56 秒的展示时间。
   Bulges 还会添加有意停留，Offsets 会插入空行程。因此要统一实际路径、时间采样、网格揭示与喷头位置，不能只换播放器。

2. **截面与接触必须一起适配。** 新版实际显示使用 [claySurface.ts](../xiaojun-version/handoff-20261111/Prototype-B-Handoff/src/claySurface.ts)
   中的压扁轮廓：横向是 `sign(cos) × |cos|^0.65`，竖向是被截断的 `1.42 × sin`。
   其低层 `beadGeometry.ts` 虽有椭圆写法，但工作台和支撑计算使用的是 `claySurface.ts`。
   本次采样的显示截面高宽比约 0.592，归一化椭圆方程最大残差约 0.637，明显不满足椭圆形状。
   当前作品成形截面轴比为 0.84–0.88，并在动画中整体旋转截面。
   新版支撑算法也调用同一套上游显示网格；若仅把画面换回我们的椭圆，接触计算与实际显示表面会不一致。
   应抽出共享的截面采样规则，让接触、成形网格、动画和阴影使用一致的几何。

3. **算子尚不能任意组合。** `simulateGaps` 接受逐层 schedule，但只执行 stable/Gaps；混入 sagging 会明确拒绝。
   Bulges、Offsets、Sagging 的高层入口均接收一份 canonical geometry 和单个全局 intensity，
   没有直接接收四组强度的共同入口，也没有接受前一算子完整结果的通用组合协议。
   各自重新生成 nominal path；分别调用再叠加结果容易丢失前一步改动、重复执行重力或破坏时间索引。
   需要共同的实际路径／时间／材料结果，并明确重力只结算一次。

两边均使用毫米，但新版是 Z-up，当前显示是 Y-up。适配旋转为 `[X,Y,Z] → [X,Z,-Y]`，
位置、法线和喷头必须一起转换。源器形身份与派生路径身份也应分开保留；
不可把修改过的螺旋或变形路径冒充为上游严格 canonical 导入格式。

实际配方验证使用 H256、参考 R48、4 mm 层距、6.8 mm 泥条、形状 seed 42，
以及原来的 `bulbous / soft-organic-fold` 参数。操作 seed 固定 42；下面的单算子全局强度仅用于接口探测，
不代表已经完成记忆区域驱动的效果整合。

| 实测案例 | 结果 |
| --- | --- |
| 两版基础器形 | 完整对象相等；ID 均为 `gof-geometry-1.1.1-8aac8a0dec35a42ae42bf5523cebbb3666749d5310ff16a81b911040ecf80a0c` |
| 四组真实强度 → Gaps | 15/17/14/14 层分配及强度准确；2,171 个缺口，约 21.53% 的标称挤出长度中断 |
| 上述 Gaps＋支撑 | 最大下垂约 9.08 mm；13,995 段有位移；没有额外的支撑删除或渲染省略 |
| Gaps＋支撑性能与传播 | 本机单次约 35.76 秒、约 1,199 万次三角查询；2,502 个区域仍标为 uncertain；零输入的 R04 也有 12 层受到下层形变影响 |
| Reactive Sagging，全局强度 1 | 接口成功；完整 canonical 输入上最大下垂 0 mm，不能据此判断算法对缺料路径无效 |
| Expressive Sagging，全局强度 1 | 4 个悬垂环，最大下垂约 12.46 mm；喷头命令发生改变；本机单次约 8.63 秒 |
| Combined Offsets，全局强度 0.7 | 4 个事件，影响 57 层，最大位移约 10.25 mm，6 个空行程边界 |
| Bulges，全局强度 0.7 | 拒绝：`Overlapping swelling footprints require an accumulation model.`，触发点见 `beadSwelling.ts:73` |

这些结果说明接口能接通，但效果并不等同于当前作品：目前作品有 26 处数据断料，最大下垂约 26.26 mm。
上游默认缺口长 1.5–3 mm，与当前成组的大跨度缺口构图不同，需要重新标定。
支撑传递还会让低差异区域因下方失稳而变化；如果采用它，应区分“本区输入强度”和“继承的材料响应”，
不能再把每一处最终下垂都只归因于本区语义差异。
上述耗时是本机单次 Node 测量，不是浏览器性能保证；同步放进当前页面主线程不合适。
两套实现仍是几何近似，本次检查不构成流变或实体打印验证。

建议后续第一阶段只整合 **支撑／接触和材料诊断**，保留我们的记忆分组、连续走线、椭圆截面及查看交互。
具体顺序是：固定交接快照与兼容边界；建立共享的连续实际路径和截面；让一次支撑结算消费这条路径；
放入 Worker 或离线预计算并缓存；最后对相同输入比较成品、背部、断口与打印中间态。
Bulges 与 Offsets 放到后续阶段，先解决重叠、区域强度和算子组合问题，再决定是否增加新的表达维度。

本轮已实际通过新版 171 项测试、5 个官方演示、上游 TypeScript 检查、跨快照类型检查和临时目录生产构建。
构建仍有原有的大包提示。没有重跑或宣称通过完整浏览器集成测试：
[上游部署记录](../xiaojun-version/handoff-20261111/DEPLOYMENT.md) 明确记录其完整浏览器脚本曾在 Gaps 的 Resume 检查超时，
虽然另行定向检查通过；未来合并时仍须独立验证。

复查文件：

- [真实配方与算子探针结果](validation/xiaojun-compatibility/report.json)
- [断料＋支撑结果](validation/xiaojun-compatibility/gap-support-report.json)
- [验证记录](validation/xiaojun-compatibility/validation.json)
- [可重复运行的探针](../scripts/xiaojun-compatibility/probe.mjs) 和 [支撑探针](../scripts/xiaojun-compatibility/gap-support-probe.mjs)
- [跨快照类型边界](../scripts/xiaojun-compatibility/contracts.ts)

从仓库根目录运行 `node scripts/xiaojun-compatibility/probe.mjs`，
再运行 `node scripts/xiaojun-compatibility/gap-support-probe.mjs` 即可重做真实配方探测。
输出仅写入 `artifacts/xiaojun-compatibility/`，不覆盖本次归档证据，也不修改应用或发布目录。
