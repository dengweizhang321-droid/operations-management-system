# P2 停用草稿 API

全部复用真实管理员鉴权、AI writer、同源写请求；正文不能提供 owner/role/executor/enabled。`enable` 当前始终 409 `task_not_ready`，数据库也拒绝启用。

`GET /api/ai/pi/task-connectors?draftOptions=1` 保留原 `items`、`executionEnabled:false`，另返回：

```json
{"draftOptions":{"models":[{"id":"model-id","name":"配置名称","version":1}],"methods":[{"id":"skill-id","name":"方法名称","kind":"bundled","version":"1.0.0","digest":"64位小写sha256"}],"firstScenario":{"platform":"京东","shop":"志高商用设备旗舰店"},"productionExecutionEnabled":false}}
```

方法 kind 为 `bundled` 时 version 是字符串；`library_guidance` 时 version 是已发布资源库的整数版本。二者必须原样绑定，不将后者标为 Pi 容器已加载技能。

创建 `POST /api/ai/pi/task-definitions`。`clientRequestId` 由一次明确创建意图生成（如 UUID），请求重试复用，同 ID 不同内容 409。示意中的模型/方法必须使用 options 的真实值；未确定真实投递对象时保留空列表。

```json
{
  "clientRequestId":"browser-generated-uuid",
  "name":"京东志高商用设备旗舰店经营日报",
  "spec":{
    "skill":{"kind":"bundled","id":"options-method-id","version":"1.0.0","digest":"options-method-digest"},
    "prompt":"京东志高商用设备旗舰店经营日报。ERP销售按本店；库存另列全部计入库存的仓。缺源或缺数须明确说明并等待，不以网店榜单替代ERP销售。",
    "shopSelection":{"platform":"京东","shop":"志高商用设备旗舰店"},
    "modelId":"options-model-id",
    "modelVersion":1,
    "trigger":{"kind":"time","timezone":"Asia/Shanghai","cadence":"daily","hour":9,"minute":0,"day":1,"windowSeconds":3600},
    "dataDependencies":[
      {"dataset":"erp_shop_sales","dayOffset":1,"requiredFields":["sales_amount_cents","quantity"]},
      {"dataset":"inventory_included_warehouses","dayOffset":1,"requiredFields":["included_warehouse_quantity"]}
    ],
    "deliveryTargets":[],
    "missedPolicy":"wait_for_data_until_deadline",
    "parameters":{}
  }
}
```

示意的9点仅为可编辑草稿字段，未表示用户批准生产调度时间。时间周期 daily/weekly/monthly，day=1..28（weekly=1..7），hour=0..23、minute=0..59、windowSeconds=60..86400；时区固定上海。`missedPolicy` 为 skip/notify_only/wait_for_data_until_deadline。其他触发和投递定义可保存，但均明确显示适配未准入。

成功 `201 {item:{id,name,ownerEmail,executorKind:"unified_pi",enabled:false,version,revision,revisionId,digest,spec,nextRunAt:null,updatedAt}}`；重试另有 `replayed:true`。更新走同一 POST，正文改为 `{id,expectedVersion,name,spec}`，不得带 clientRequestId；新建不可变 revision。修改前须停用，旧 run 保留原 revision。

`GET /task-definitions?limit=30&cursor=<上次nextCursor>` 只返回摘要 `{items:[{id,name,ownerEmail,executorKind,enabled,version,revision,updatedAt}],hasMore,nextCursor}`，limit=1..50。

`GET /task-definitions/{id}` 返回完整 `item` 和 `readiness:{ready:false,blockers:[...],saveDoesNotEnable:true,legacyOwnershipChanged:false}`。

`GET /task-definitions/{id}/revisions|runs|incidents` 同样接 limit/cursor；revision 的 cursor 是上一页最后 revision 数字，另两类是 id。revision 列表只含 id/revision/digest，完整 spec 走 `/revisions/{revisionId}`。run/incident 的列表项有 `detailPath`；详情分别走 `/runs/{runId}`、`/incidents/{incidentId}`，附有界白名单证据引用和原 Pi operation evidence 读取路径。

`POST /task-definitions/{id}/disable|enable` 正文 `{expectedVersion}`；停用只阻止未来执行和撤销本任务授权，不重写旧 run/operation。`POST /task-incidents/{id}/claim` 正文 `{expectedVersion}`；`/close` 增加非空 `resolutionNote`。关闭分诊不会重跑业务，返回 `businessReplayed:false,originalRunChanged:false`。

`GET /api/ai/pi/legacy-tasks` 只读呈现原钉钉任务的 `legacy-owned` 状态；没有切 owner 或 n8n 补跑动作。
