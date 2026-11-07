# 未合并批次的隔离组合

第三批基于重新取得的 `origin/main` `0c7d0feb33f45cfc6ae1f283b81d401c873c5768`。第一批分支头为 `265ef9bb7ad240dfbd9b92c18bdffd73a728040c`，第二批分支头为 `837f4bf5d18a4ba61030cf1e243e9c28b4882c22`。两批均待主线采用决定。第三批工作树从主线单独开始，前两批的应用候选只进入对应的隔离组合。

| 小任务 | 精确来源 | 用途 |
| --- | --- | --- |
| W10 | 主线模型注册、配置、探测和图片入口 | 独立实现。Worker 签名接缝与第一批 W3 `79ac59cd22c45ff9fc659ae54d0090f1bee1929b` 做三方比较。 |
| W11a | W10 的结构化契约探测，第一批 W7 `74061295` 的口径增量 | W10 是文字提炼的直接准入依赖。W7 在独立 Astra 副本叠入，保留原转化率口径与新发布流程。 |
| W11b | 第一批 W1/W2 `eee39f9d315eaf9dd71f8390181879cdb6ba2c82` | 私有 Runner 与镜像使用精确提交，Django 使用该提交叠入 W11b 的聚焦差异。真实加载、产物和旧包保留按该组合验证。 |
| W12 | 第二批应用冻结 `638fd30db3e1fa670805878d060ee3894baa462d` | 同一 W12 差异分别在主线和第二批归档测试。调用 W5 模型协议和 W8 个人投递契约。W6 的完整来源、缺数处理与发布依赖有记录，单场景不调用 pandas。 |

## 发布接缝

用两批应用提交 `eee39f9d`、`638fd30d` 运行 Git 三方组合，出现五处文件冲突。四个 pandas 数据或测试文件采用第二批字节。第一批这些文件的唯一改动为 W6a `7caf36f0`，第二批已经显式采用其完整改动，再叠加了 W6b。

`publish-prepared-main.mjs` 的三处冲突分别保留 Pi 镜像选择和 Pandas 轮换变量、两个复验分支及两种 `PREPARED` 证明。W2 的 Pi 镜像来源和 W6R 的独立准备、切换、启动观察都进入合成组合。自动合并的 `publish-main-tail.mjs` 保持 W6R 原字节，`publish-main-resume.mjs` 同时保留 Pi 镜像证明核验及 Pandas intent 拒绝。组合同时保留 W3 传输发送前围栏和 W5/W8 诊断，中央工具注册表同时保留 W7 转化口径和 W6b 完整数据接线。

四项隔离编排检查通过。双组件准备不进入维护，部署夹具使用两套绑定，依次观察 Pi 升级、Pandas 切换、一次启动、原启动回执及成功。缺任一准备证明均在 `STARTED` 前拒绝。带 Pandas 轮换的尝试继续拒绝从 Pi resume 跨域续接。较广编排的首次并行运行有一项就绪断言失败。原第二批同项单跑通过，组合候选串行复跑 128 项通过。首次失败及首个续接夹具目录错误均保留。编排测试使用原生入口替身，组合冷启动仍待验证。

- [精确源与冲突保全](D:/codex-artifacts/ai-repair-batch3-20261108/integration/SOURCE.json)
- [离线组合脚本](D:/codex-artifacts/ai-repair-batch3-20261108/integration/compose.py)
- [组合编排检查](D:/codex-artifacts/ai-repair-batch3-20261108/integration/dual-release-final.log)
- [组合串行复跑](D:/codex-artifacts/ai-repair-batch3-20261108/integration/publisher-serial-rerun.log)

## 第三批应用叠入验证

将第三批冻结应用 `d9a14833` 叠到同一隔离投影后，另外两处冲突分别位于文字资源库和报告工作台。资源库保留第一批转化口径常量与第三批文字方法标识规则。工作台保留第二批报告模型选择、任务模型显示与第三批文字方法停用和发布区。原五处冲突决议字节保持可核。

组合 Django 50 项通过、1 项 PG 条件跳过，组件与路由 14 项通过。实际合并 JSX 在 Windows 文件中渲染默认与两个合成模型选项，选中 B 且零外部请求。

- [三批应用源码绑定](D:/codex-artifacts/ai-repair-batch3-20261108/integration/FULL-APPLICATION-SOURCE.json)
- [原 Astra 增量反审](D:/codex-artifacts/ai-repair-batch3-20261108/integration/astra/REVIEW-R1.md)
- [合并工作台模型选择回执](D:/codex-artifacts/ai-repair-batch3-20261108/integration/w5-merged/selection-html-check.json)
- [组合 Django 检查](D:/codex-artifacts/ai-repair-batch3-20261108/integration/three-batch-django.log) · [组件与路由检查](D:/codex-artifacts/ai-repair-batch3-20261108/integration/three-batch-worker-final.log)

前两批各自的 G02 仅绑定各自源码字节。采用组合时，应用和控制器的最终差异、真实前驱、制品及续接准入必须重新核对。第三批的独立 G02 也只覆盖其主线基线上的精确应用候选。
