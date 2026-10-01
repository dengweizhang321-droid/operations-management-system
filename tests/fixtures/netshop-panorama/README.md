# S actual owning response captures

这些文件从 S 专属私有 PostgreSQL／真实签名 owning API 测试原字节复制，未改金额、日期、字段、身份或修订。它们含合成事实，不是生产数据，也不是实际 Home／gateway 接线验收。

来源：`E:/codex-artifacts/netshop-panorama-M5-20261001/core/panorama-pg-84c89e3620d90ed05a0a`，61项隔离PG组合检查通过、正常停止；源码阶段为S core `0dad483d`，依赖 actual main493及 Root strict display contract fc1。

| 文件 | 字节 SHA256 | 覆盖 |
| --- | --- | --- |
| response-sales.json | 474461b721676193100f61f06ef9dbd506dc575ed6bdb93d00b7f27acf52b2e0 | P/Series/A＋真实注册 Sales RPC，Workflow配置缺失为error，Finance pending |
| response-sales-missing-order.json | d93e1ac02d27479491a9451bbc094dff9584e8725a1cb52f72b7477b4fe6bf42 | 同源缺订单号，均值不可用，不回退来源行号 |
| response-workflow.json | 3a1f0a2651e59fc2fa12bd6054f9f2687aea1c5abb512b497dbc5d039733fa45 | P/Series/A＋真实签名 Workflow GET→list_records；独立workflow修订，Finance pending |

请求必须从原 `context.requestedScope`、三期实际窗口及 `tableScope`恢复，拥有方版本头取原 netshop owning_revision；不能为匹配前端 URL 修改捕获值。跨域查阅使用各自完整 owning 信封。重复本店本期与不同domain revision不可被通用字符串相等所混用。

这些数据只在专属测试中使用，正式组件不导入。本阶段没有一份同时配置销售＋Workflow＋Finance的最终来源组合，不冒充最终八章节完成。
