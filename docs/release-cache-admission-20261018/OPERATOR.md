# 固定 0b 操作入口

仅在新控制源冻结、候选通过、完整包采用与独立操作材料审查后执行。新控制提交与应用 b2 分开绑定；采用不能写成应用已上线。

普通 writer：

```text
node <冻结新控制source>/tools/cache-rejection-writer.mjs --out D:/codex-artifacts/<本次独立新目录>
```

`--out` 必须不存在，完整实体父链留在 D:/codex-artifacts；失败后的原目录保留，不自动重复。writer 会分别 create-only 写 `REQUEST-before-archive.json` 与 `REQUEST-after-archive.json`。request.version=`teruisi-cache-rejection-request-0b-v1`，dispatchId=`0b4674f2-287d-453a-9094-a8f3245886a0`。request.sourceIdentity 指新控制提交/tree；应用观察仍固定 b2/81bab。

独立高权限只读 observer（每次新 request SHA）：

```text
node <同一冻结新控制source>/tools/cache-rejection-observer.mjs --request <out>/REQUEST-<phase>.json --sha <精确canonical request SHA256> --out <out>/OBSERVATION-<phase>.json
```

phase 仅 `before-archive`、`after-archive`。observer 只读控制/任务/源/packet/census，只在已核实体 artifact 链写自身见证，并活到普通 writer 写对应 ACK。普通 writer 必须由受审普通令牌固定任务启动；两者的外置运输保留此前已验证 DETACHED_PROCESS/stdio 算法，只适配新冻结 source、CLI 名称、0b 请求版本与精确输入。不得增加 conhost 名称豁免、过滤 census 或在双见证间另起高权限控制进程。实际 bridge/task/envelope 材料须另外封存与独审，本说明不授予其执行资格。

成功只新增 `prebuild-queue-v2/resolutions/0b4674f2-287d-453a-9094-a8f3245886a0.json` 与独立 evidence，对原 unknown 不改状态。成功后才允许新制备调用。main 推进时仍须使用原显式 frozen API、原队列与完整原生回执/catalog；不得靠一次 ls-remote 前检选择未知新 main，不复用旧 unknown promise。
