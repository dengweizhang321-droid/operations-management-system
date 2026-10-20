# Worker successor 容量检查点扩展至 512（2026-10-20）

## 现场

- 生产 Worker effective head：`20261020T064140Z-f275909f63debfae`，successor sequence **256**。
- `20261020` 的 JD 客户服务发布在切换前端时失败：`successor sequence 无效`。
- 失败发生在 `successorPayload()` 校验阶段，新 successor 尚未写入；原 head 保持 `20261020T064140Z-f275909f63debfae`，生产已回滚到 `8411456e`。
- 失败计划：predecessorSequence 256，候选 `20261020T091212Z-1749f1207a4e188c`；新 sequence 257 被旧的 `maximumSuccessors=256` 拒绝。

## 决策

- 将 `tools/worker-local-release-rotation.mjs` 的固定上限从 **256 有界扩展至 512**。
- 保留并逐条验证 bootstrap 到 effective head 的全部 256 条历史记录；不做历史压缩、链根轮换或跳过旧记录校验。
- 目录文件数上限随之为 `512*2=1024`；继续拒绝非法序号、分叉、不可达记录、环、缺/篡改 sidecar、过期 CAS。
- 不提供环境变量或 CLI 覆盖；上限仍是源码级固定有界值。

## 测试

`tests/worker-local-release-rotation.test.ts`：

- `successorPayload` 接受 33、128、129、256、257、512。
- 拒绝 0、-1、1.5、513、Infinity。
- 既有“跨 128 边界、完整验证 129 条链、拒绝 sidecar 篡改”测试继续通过。
- 完整 Worker rotation 测试通过。

## 边界

这次只解决**容量检查点**，不改变前驱/后继语义、lineage、approval、CAS、sidecar 或启动绑定。下一次超过 512 前仍需新的容量检查点评审。
