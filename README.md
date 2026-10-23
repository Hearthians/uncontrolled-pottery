# 失控陶坊 / Uncontrolled Studio

实时生成的三维陶土打印装置原型，使用 React、TypeScript、Vite 和 Three.js。

```sh
npm install
npm run dev
```

打开 Vite 输出的本地地址。远程 CLI 或 VS Code 可直接转发该端口；摄像头需要本机地址或 HTTPS。公网体验入口为 <https://gfyh.fun/pottery/>。

每次完整打印约 55 秒，共 64 圈，包含停料余流与收尾。两个参数默认归零，先生成稳定的基准圆筒。供料波动经过有响应时间的供料系统改变流量与截面；供料中断产生有持续时间的欠供料事件，喷嘴仍沿固定螺旋路径运动。泥条接触后压扁，缺失的支撑影响后续沉积。新操作不改写旧泥料的体积，已经落下的湿泥仍可能因局部载荷和下垂而变形。

完成后可以命名收藏、旋转查看、回看参数时间轴，并导出 JSON 过程记录及 WebP 图像。画廊工具栏的导入图标可以重新打开 JSON 记录。收藏保存在当前浏览器的 localStorage 中；旧版作品沿用旧算法，新版保存模拟版本、配置标识、固定步长、种子、操作事件和实际欠供料事件，重建时保留原来的形态。

当前预览版模拟气压直挤式设备，配置为直径 100 mm、喷嘴 6 mm、层高约 1.92 mm、速度 25 mm/s。约 823 秒的模拟过程加速到 55 秒，属于未经实机标定的材料近似。当前处理截面压扁、竖向局部下垂和受压；横向盘曲、整件倒塌、干燥与烧成未实现。调研依据见 [调研方案](docs/clay-printing-research-and-plan.md)，发布与回退记录见 [预览版说明](docs/material-preview-1.md)。

## 摄像头手势

工坊标题右侧的手掌图标切换到手势输入。首次使用需要允许摄像头权限；鼠标图标切回屏幕控制并关闭摄像头。当前 SSH 转发后的 `http://127.0.0.1:15173` 可以使用摄像头，直接通过普通 HTTP 内网 IP 访问不具备浏览器要求的安全上下文。

| 动作 | 结果 |
| --- | --- |
| 左手拇指与食指由捏合到张开，其余手指自然伸展 | 供料波动从 0% 增加到 100% |
| 右手同样张合拇指与食指 | 供料中断从 0% 增加到 100% |
| 双手完全张掌并保持 1 秒 | 开始打印或从暂停继续 |
| 双手握拳并保持 1 秒 | 暂停打印 |
| 一只手离开 | 对应参数保持，另一只手继续控制 |
| 两只手均离开 2 秒 | 自动暂停；重新出现不会自动继续 |

确认进度显示在摄像头预览下方。双手命令姿态期间冻结参数，保持同一姿态只触发一次，需要释放后才能再次触发。摄像头掉线、画面停止更新或切到后台都会暂停；弹窗打开期间手势控制锁定。完成状态不接受手势修改或重新开始，收藏与再次打印使用现有按钮。

识别使用原始摄像头帧，预览与骨架一起镜像，保留真实左右手的映射。若摄像头本身已镜像输出，预览标题栏的双向箭头可交换映射。单手也能调节对应参数，启停使用屏幕按钮。手指开合按手掌宽度归一化，识别需先稳定 180 毫秒，参数采用平滑和 2% 死区以抑制抖动。

识别使用 MediaPipe Hand Landmarker。打开页面即下载模型与所选 WASM 并初始化；顶部显示真实字节进度，完成后收起为就绪图标。模型与 WASM 位于 `public/hand-tracking/`，初始化后的模型供首次手势输入直接使用，切换输入方式不会重复下载。固定资源另存于访问者的浏览器 Cache Storage，刷新后可直接读取；缓存不可用时回退到普通下载。`assets.json` 记录解压后的资源大小，替换模型或 WASM 时需同步修改并更新 `handModel.ts` 中的缓存版本。下载失败可重试，不影响鼠标操作。

首次打开显示简短手势引导，关闭后记住选择，右上角问号可以重新打开。“开启手势”才申请摄像头权限；自动预加载不会打开摄像头。摄像头画面不上传、不写入收藏或导出文件。参数变化沿用原有过程记录，可以重建陶器。

```sh
npm test
npm run build
```

浏览器验收需要先启动开发服务器，并安装 Playwright Chromium：

```sh
npx playwright install chromium --no-shell
npm run verify:browser
npm run verify:browser -- --layout-only
npm run verify:gestures
npm run verify:loading
npm run verify:material
```

使用 `POTTERY_URL` 指定验收地址。性能测量可运行 `npm run verify:gestures -- --profile`；`verify:material` 也会输出材料计算与几何更新耗时。报告保存在忽略提交的 `artifacts/` 中。测试环境使用 Chromium 软件渲染，不能代替真实手机上的帧率验收。

首版不依赖实体打印机或云服务，收藏不跨设备共享。材料行为采用近似模拟，并非真实陶土打印的物理预测。

## 公网转发

公网入口为 <https://gfyh.fun/pottery/>。Nginx 复用现有 HTTPS 证书，经服务器回环端口 `15173` 的 SSH 反向隧道访问当前节点的 `127.0.0.1:5187`。摄像头画面与识别仍留在访问者的浏览器。

材料计算与画廊重建也在浏览器中完成，后者使用一个 Web Worker。公网服务器只转发静态资源，没有新增推理进程或逐帧上传。预览版不增加手势模型下载；仅首次访问增加约二十多 KB 的未压缩应用代码和 Worker 代码。

```sh
npm run build:public
npm run public:start
npm run public:status
npm run public:stop
```

守护进程管理预览服务和 SSH 隧道，退出后每隔 3 秒重试；SSH 每 15 秒保活，连续 3 次无响应后重连。使用 `~/.ssh/id_ed25519_hpc_peers` 登录 `lizd@gfyh.fun`，启动前需完成主机信任和公钥安装。仅在一个节点启动公网转发；状态和日志位于 `.runtime/public-forward-<hostname>/`，管理命令需在启动节点执行。当前部署节点为 `mgmt-5`。节点关机或重启后需重新启动，不配置开机自启。

公网构建使用 `/pottery/` 基础路径，单独输出到 `dist-public`；不改变原有 `5173` 开发服务。更新时先构建，再停止并启动公网服务。

```sh
POTTERY_URL=https://gfyh.fun/pottery/ npm run verify:browser
POTTERY_URL=https://gfyh.fun/pottery/ npm run verify:gestures
```
