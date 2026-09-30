# S 公共接线与交付请求

提出者：店铺全景 Lead，2026-09-30；2026-10-01已收到M2冻结，仍在M5前准备阶段。01已选定；S001—S008的最新精确符号、已具备项和待P/A/领域owner项见[M2准备回执](M2-PREPARATION-20261001.md)，以下原请求保留作来源。本轮未修改公共文件。

| 请求 | 用途 / 精确候选范围 | 兼容与门槛 |
| --- | --- | --- |
| S-001 契约与依赖确认 | F 的共享 ShopContext、日期/身份/Metric 状态、路由导航解析；P/A 的专属 DTO、消费服务、预算与 SHA | I 确认已合 main 精确提交与冻结版本；S 同步 main 才消费；不拿在途代码作依赖 |
| S-002 旧入口接线 | `app/shop-module-view.tsx`、`app/shell/navigation-contract.ts` 与必要注册；`module=shop&view=analysis` → 正式全景组件 | 保留旧五个 view 值与书签、01 classic/balanced；只挂载活动章节读取；商品/推广/ERP 返回恢复位置 |
| S-003 专属 GET 路由 | 草案 `/api/netshop/store-panorama`；S 可在冻结后写专属 handler/service/test；公共 `backend/netshop/urls.py/views.py`、`lib/django/netshop-service.ts` / gateway 由 I 落地 | 真实 principal、固定 reader、允许参数、页/响应/超时上限；不扩 writer/grants；无 POST 或业务执行动作 |
| S-004 已有销售复用 | 既有销售 summary/product consumer，精确 outlet + custom 左闭右开范围；如需扩退货量字段，由销售 owner 写 | 不重写毛利算法；客单价分母与大毛利率严格区分；退款金额/订单/件数率不混名；不绕过公开 unrestricted 限制 |
| S-005 单店财务与年度目标 | 由 I 协调财务 owner 有界、权限正确的单店财报/年度进度 consumer | 财务复合店铺键明确映射；按实际月份；不线性摊年度目标；历史同期不足声明缺口 |
| S-006 记录与专题跳转 | 原 operations-records、导入 batch/detail、工作流只读记录能力与链接；商品 P 精确身份 / 推广 A 同店同期 | import-chain-status 今日状态不冒充任意历史；不自动补跑；无任意外链/客户身份进入 URL |

新增S-007：用户已选01并要求全景商品明细ID/标题搜索与底部分页。由P接口提供q（商品ID/标题）、page/pageSize、total/returned/hasMore、scope与snapshot/revision；搜索只影响该表，上方完整店铺汇总不变。范围或查询变化归第一页，空结果/末页禁越界；详情返回恢复查询与页码。I协调冻结参数与导航上下文，不由S造同类聚合接口。截图所指的全景店铺标题/筛选区按用户新要求取消sticky；公共主导航/日期行为仍交I。

共享底座现按I发布的9d4830ee冻结；P/A/S专属路径与DTO核心仍为预留，不能当可调用接口。正式实现只改角色分配的全景组件、专属服务/API/测试及角色文档；共享导航、日期、gateway、路由、权限及其他 owner consumer 均交 I 串行维护。

联调验收必须涵盖：跨店同ID/同名、真实权限拒绝、实际比较日期、缺字段/缺日/真零、短月闰日和零负基期、P 跨页全集配对、A 错位店日、多源修订及持续变化、快切店取消/迟到、接口故障不当无数据、专业页往返及旧功能/01。隔离 PostgreSQL 和 UI 结果不能互相代替。

## 工作树与 Teammate 清单

| 人员 | 分支 / 工作树 | 写入与交付 |
| --- | --- | --- |
| Lead S | `codex/netshop-panorama`；`D:\.codex\worktrees\netshop-panorama\运营管理系统` | `app/netshop/panorama/demo/**` 与 `docs/netshop-refactor/panorama/**`；集成全部设计文件 |
| field_mapping | 无子分支；只读已提交 `D:\运营管理系统` main | 无写入；字段、参数、权限与来源盘点，由 Lead 写入角色文档 |
| independent_review | 无子分支；只读 S 设计树及独立临时 browser 会话 | 未编写源码；问题与修订复验，证据汇总角色目录 |

启动检出 `D:\.codex\worktrees\02eb\运营管理系统` 为应用已有 detached 树；本任务没有向其写入或建立第二套功能实现。不存在写代码 Teammate 共享工作树的情形；两个 Teammate 均只读，无遗漏代码子分支。总控统一负责最终合 main、主线 push 及清理；S 只正常 push 本栏目分支。

保留原因：用户已选01，等待P/A主线和I的M5起步交接；设计树、角色文档与截图继续保留。3160本轮未观测到监听，未强停、启动或归档，不用空闲外观作为清理许可。本轮没有 PostgreSQL、生产部署、迁移、正式服务启停、真实导入补跑、付费调用或外部发送。
