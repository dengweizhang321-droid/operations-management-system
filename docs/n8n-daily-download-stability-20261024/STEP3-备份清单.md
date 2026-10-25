# 第3步准备：备份清单（动手前的保全）

- 日期：2026-10-25（上海）
- 性质：**只读导出与复制，没有改动任何工作流、清单或 n8n 配置**
- 备份位置：`D:\codex-artifacts\n8n-stability-20261024\`

## 一、工作流定义备份

| 项 | 内容 |
|---|---|
| 位置 | `backup-workflows\` |
| 数量 | **24 条**（全部，不只是要改的） |
| 格式 | 每条一个 JSON，含 `nodes`/`connections`/`settings`/`staticData` 等全部字段 |
| 清单 | `backup-workflows\MANIFEST.json`，含每条的 SHA-256 和字节数 |
| 当前开着的 | 1 条（吉客云） |

备份的是 `workflow_entity` 的完整字段，`nodes` 和 `connections` 保留原 JSON 字符串，
保证需要时可以原样回导。

## 二、卡住清单备份

| 组 | 来源目录 | 备份文件数 |
|---|---|---|
| 京东客服 | `outputs\jd-customer-service-pipeline` | 75 |
| 京东物流 | `outputs\jd-logistics-pipeline` | 42 |
| 吉客云 | `outputs\jackyun-export-first` | 220 |
| **合计** | — | **337** |

位置 `backup-manifests\`，清单 `backup-manifests\MANIFEST.json`，每个文件带 SHA-256
和原修改时间。跳过了 `downloads\` 目录（那是下载的业务文件，体积大且本次不需要）。

## 三、关键卡住清单逐个核对

备份里的修改时间和我排查时读到的**完全一致**，证明原文件没被任何人动过。

| 流 | 清单文件 | 字节 | 原修改时间 | SHA-256 前16位 |
|---|---|---|---|---|
| 客服-商用设备 | `active.json` | 29 | 10-22 09:10:12 | `06c2e425ecc0d0d0` |
| 客服-商用厨电 | `jd-chudian-weizhang/active.json` | 29 | 10-21 09:10:23 | `bdc737e722b1567b` |
| 客服-商用洗碗机 | `jd-cuizhiwang-dengweizhang/active.json` | 29 | 10-22 09:05:15 | `1da364e9dc95c0f7` |
| 客服-切肉机 | `jd-maidehao-operator1/active.json` | 29 | 10-22 09:15:15 | `c0c6ed7c1b39e3af` |
| 物流 | `active.json` | 165 | 10-17 11:17:53 | `afe6acba0181e00f` |
| 物流计划 | `jdl-794e9ecf….json` | 7434 | 10-17 11:18:46 | `14b4ed9be58a7be3` |
| **吉客云** | **`active.json`** | **66** | **10-24 00:10:04** | `f10b17e64e69b05a` |
| **吉客云计划** | **`n8n-export-first-11007.json`** | **1512** | **10-24 00:12:40** | `5020740578dec794` |

## 四、新确认：吉客云的完整卡住链条

备份过程中把吉客云的 `active.json` 也读了，这是之前没展开的一环：

```
outputs/jackyun-export-first/active.json
  内容：{"runId": "n8n-export-first-11007", "executionId": "11007"}
        ↓ 指向
outputs/jackyun-export-first/n8n-export-first-11007.json
  内容：phase = "importing"（成功那次是 "completed"）
        ↓ 导致
10-25 00:10 的新执行被拦：
  "原运行 n8n-export-first-11007 尚未闭合，且当前执行没有有效续跑许可；禁止新建重复导出"
```

和京东客服、物流是**同一套机制**：`active.json` 指向一个没走到终态的运行记录，
下一轮直接拒绝。

区别在于**产物状态不同**，所以处理方式不能一样：

| 流 | 清单状态 | 有业务产物吗 | 能常规处理吗 |
|---|---|---|---|
| 客服4店 | `stage=failed` | **无**（proofs=0、source={}） | **能** |
| 物流 | `stage=failed`，第4个数据集 `exporting` | **有**（352+906+427行已验证） | **不能**，需受控归档 |
| 吉客云 | `phase=importing` | **有**（五表已全部导出完成） | **不能**，现成闭合工具不适用 |

## 五、备份不包含什么

| 不含 | 原因 |
|---|---|
| `downloads\` 目录下的业务文件 | 体积大；且吉客云五表原文件在 `D:\谷歌浏览器\jackyun\` 另有留存 |
| n8n 数据库本身 | 没改它，不需要；且 `~\.n8n\backups\` 已有 n8n 自己的备份 |
| 凭据、Cookie、浏览器 profile | 安全规则不读不碰 |

## 六、怎么回退

| 要回退什么 | 怎么做 |
|---|---|
| 某条工作流的定义（定时、节点） | 用 `backup-workflows\<名称>__<id>.json` 在 n8n 里重新导入；或按其中的 `nodes`/`settings` 字段逐项改回 |
| 被删掉的 `active.json` | 从 `backup-manifests\<组>\...\active.json` 原样复制回去，SHA-256 可比对 |
| 工作流开关状态 | `MANIFEST.json` 里每条都记了改动前的 `active` 值 |

## 七、第3步还没做的

备份只是准备。以下动作**都还没做**，等你批准：

| 待做 | 风险 |
|---|---|
| 删 4 个客服 `active.json` | 低（零产物） |
| 改定时（按你选的范围） | 低（不触发运行） |
| 物流清单受控归档 | 中（有产物，入口待确认） |
| 吉客云 11007 闭合 | 中（有产物，现成工具不适用） |
| **打开工作流** | **这是生产操作，会立刻真实下载和导入** |
