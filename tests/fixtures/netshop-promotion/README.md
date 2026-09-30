# 推广真实 reader 的合成 PostgreSQL 响应

这里的六份 JSON 都是实际 Python reader 在独立合成 PostgreSQL 上输出的完整 DTO，未手工补造字段、指标或身份。它们供 TS decoder/API 消费互通及负向变异测试使用，不是正式业务数据或生产验收。

- 作者源码：`codex/netshop-promotion-query`，`4d74e986c6161eccd3071ad20d343b519852bb4d`。
- 来源：`E:\codex-artifacts\netshop-scheme2-20261001\promotion-query\author-final-10\foundation-pg-45d4d7326264\capacity`。
- 对应执行：35/35 PG，SystemCheck 0，退出 0，私有 PG 正常停止。输出原件使用 CreateNew，各旧轮原件保留。
- `response-product.json`、`response-plan.json`、`response-detail.json`：基础对象、原支持范围计划与整期精确对象详情。
- `response-partial-19-of-21.json`：整期主费率 null，主配对覆盖 19/21；辅助费率 0.2，辅助自身范围完整 19/19。
- `response-misaligned.json`：A 店仅推广、B 店仅商品，整期配对 0/2；辅助零匹配范围 0/0 不可用。
- `response-missing-id.json`：真实来源缺业务 ID，保留内部 rowKey 及本期事实，id/followSkuId=null，不钻取、不跨期配实体、不进贡献榜。

`pg-ui-server.py` 为本栏目 QA 专用的实际 reader 适配器。它从干净环境启动独立动态端口 PostgreSQL，以本树锁定依赖及源码迁移自己的合成数据库，HTTP 只绑定 127.0.0.1:18150。它不替代 I 的公共签名 URL/SDK 注册验收，不读取生产配置、不继承生产密钥、不调用模型或业务下载。仅合成来源 revision 推进端点允许写；在本次独有证据目录创建 `stop.request` 后正常关闭 HTTP 与其自己创建的 PostgreSQL，不以 shell stdin 生命周期作服务身份。第一次 QA 初始化因迁移已含版本行而 create 重复失败，证据 `promotion-integration\root-ui-pg-01` 保留，私有 PG 已正常停止；修为同测试的 update_or_create，不绕过 source guard。第二轮完成 seed 与 ready 后 shell stdin 自动关闭，私有 PG 正常停止；仅为初始化检查，不作为 UI 验收。
