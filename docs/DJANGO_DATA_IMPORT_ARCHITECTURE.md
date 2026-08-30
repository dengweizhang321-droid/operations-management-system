# Django 数据导入架构契约

## 1. 适用范围

本契约用于把现有 Worker/D1 业务域逐个迁移到 Django/PostgreSQL。它定义可复用的安全不变量，不要求所有业务域共享表、进程、锁或写入所有者。

首个复用范围是月度财报。现有“销售分析 → 财务分析”前端模板和公开 API 契约保持不变，本批不重做页面结构。

## 2. 固定组件边界

```text
浏览器
  -> 公开 Worker：真实鉴权、权限、上传边界、Excel 解析、HMAC、R2 短期传输
  -> Django domain writer：二次校验、请求幂等、范围锁、原子发布、审计、回查
  -> PostgreSQL domain tables：唯一权威事实与历史审计
  -> Django domain reader：有界查询、scope、revision
  -> 公开 Worker：稳定响应契约
```

- Worker 不保存已迁移领域的事实、批次、指纹或写入状态。
- Django writer 不直接暴露给浏览器或外网。
- R2 文件/分片不是事实源；成功只能由 PostgreSQL 完成批次与落库回查证明。
- 每个精确业务范围任一时刻只有一个写入所有者，迁移期间禁止长期双写。

## 3. 领域隔离

每个领域必须具有独立的：

- Django app 和 migration；
- 数据表、revision 和批次身份；
- 数据库 writer 角色或等价数据库级写权限边界；
- scope head、owner token 和写请求 receipt；
- readiness 与迁移/切换证据；
- 备份核对清单和恢复验收。

财务写入故障不得阻断销售总览、渠道或品类查询。财务迁移不得改变销售 write authority、销售表、ERP bridge 或 D1 销售 retirement 对象。

## 4. 公开请求与内部鉴权

公开 Worker 必须从 `requireAppPrincipal()` 得到真实 principal，验证角色和数据 scope 后，重新生成短时 HMAC 信封。签名至少绑定：

- 版本、Unix 时间和 request ID；
- HTTP 方法、精确路径和原始 query string；
- 请求正文 SHA-256；
- 规范 principal（email、displayName、role、scope）。

Django 拒绝未知字段、过期或未来签名、正文摘要不一致、角色不符、scope 不支持、重定向、超大请求和非受控来源。内部签名头不返回浏览器。

## 5. 解析与规范化

- 迁移既有领域时优先保留已经验证的 Worker/TypeScript Excel 解析器，避免同时改变模板解析和数据所有权。
- Worker 输出有版本的规范化业务行和解析告警；Django 必须再次校验类型、范围、稳定身份、行数和业务约束。
- 金额使用人民币分，比率使用明确的整数基点或领域固定单位；禁止浮点金额写库。
- 文件名、原始行号、行顺序、工作簿元数据和对象键顺序不得影响业务内容指纹。
- 未声明字段、无效签名、解析失败、表头错误、范围错误和未经证明的零行业务集合必须失败关闭。

## 6. 两层幂等

### 6.1 请求幂等

写请求 receipt 绑定 `request_id + actor + method + path + body_sha256`。同一身份和正文安全重放原响应；相同 request ID 携带不同正文必须冲突拒绝。处理中请求只能由有效 claim token 完成，迟到 owner 不得覆盖新状态。

### 6.2 业务幂等

业务判重固定为：

```text
domain + exact business scope + canonical normalized content
```

原文件 SHA-256 只用于签收和审计，不能单独决定 duplicate。业务字段、权威行集合或精确范围任一变化都必须创建新批次。

## 7. 范围锁与 fencing

- 可能重叠的月份、日期或快照按稳定业务基域串行抢占，不把整段范围文本直接作为互斥域。
- owner 是随机且唯一的导入尝试 ID，不是确定性批次号。
- scope head 保存固定长度 state token、generation、owner、当前批次和更新时间，并可 O(1) 读取。
- 事实发布前重新锁定 scope head、写 authority 和请求 receipt；在同一数据库事务中安装提交栅栏。
- 只有 owner、generation 和原 state token 仍匹配才能发布、失败释放或完成。
- 超时接管必须验证状态没有推进；旧 owner 之后的写入、清理和完成全部失败。

## 8. 原子发布与回查

同一事务内完成：

1. 锁定有效写 authority、请求 receipt 和 scope head；
2. 创建或更新 processing 批次；
3. 在精确业务范围内完整替换事实集合；
4. 写入尝试、内容指纹、告警和来源；
5. 推进领域 revision 和 scope state token；
6. 完成批次并清除 owner。

提交前/后必须核对批次、范围、行数、内容摘要和 revision。失败不得留下部分事实，也不得让失败释放覆盖前一个已发布 state token。

## 9. 历史迁移

迁移工具固定采用：

```text
dry-run -> 人工批准精确 run ID -> apply -> verify-only
```

- dry-run 只读源，输出解析版本、源身份、表/范围行数、完整规范摘要和 revision，不写业务表。
- apply 在目标事务内重新核对同一材料并单次消费批准；材料变化、批准复用或模式省略均零业务写入失败。
- verify-only 独立比较源/目标事实、批次、审计、摘要和 revision。
- 切换前暂停该领域写入，执行最终迁移和公开 API 契约核对；其他业务域继续运行。

## 10. 单写切换与恢复

切换前，旧后端是唯一 writer；新后端只做迁移和影子读取。切换时必须：

1. 暂停精确领域写入；
2. 生成并校验两侧备份；
3. 执行最终迁移和 verify-only；
4. 发布 Worker 薄适配；
5. 验证公开读写、权限、幂等和回查；
6. 原子确认 PostgreSQL writer authority；
7. 恢复该领域用户操作。

PostgreSQL 接收第一笔新权威写入后，旧 D1 不再是无损回滚目标。恢复只能使用兼容应用版本、PostgreSQL 备份/WAL/PITR 或经审批的前向数据修复。D1 领域对象只有在稳定观察和独立退役审批后才能受控退役。

## 11. 财务域本批边界

本批迁移以下对象：

- 月度财报批次、月份和财报行；
- 导入尝试、内容指纹、scope head、请求 receipt 和 finance revision；
- 财报导入历史和财报分析 reader API；
- 与财报分析同一一致性边界内的经营目标、版本和删除审计。

现有 Worker 财报解析器继续负责 Excel 模板解析；Django 接收有版本的规范化数据。公开 `/api/imports/finance`、`/api/finance/analysis` 和 `/api/finance/targets` 契约保持兼容。财务 reader/writer 的不可用不得影响非财务销售 API。

## 12. 必测负向路径

- 相同内容改名、换序和重复提交；
- 同月份内容变化和多月份部分重叠；
- 两个管理员并发写入；
- 请求成功但 Worker 丢失响应；
- owner 超时接管与旧 owner 迟到；
- 发布中数据库错误和进程中断；
- 非管理员、受限 scope、HMAC 篡改和正文替换；
- 源材料在 dry-run 与 apply 之间变化；
- 备份损坏、恢复目标指向正式数据库或清单被篡改；
- 财务服务失败时销售总览、渠道和品类仍正常。
