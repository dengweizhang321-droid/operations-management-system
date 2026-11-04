# 京东客服人工闭合诊断施工报告

状态：候选，未合并 main、未准备生产制品、未上线。基线为 `ece8c7ec46ac7bd7dc0a5a3e3eed8fcf065d3b65`，分支 `codex/jd-cs-close-diagnostics-20261105`。

## 实际部署与入口

2026-11-05 进行有界只读核查，并在开始修改前报告主代理。提示词所引“人工闭合入口未部署”已过时。现役发布目录指向 `ece8c7ec46ac`，原生 SUCCESS、Worker manifest、Django manifest 的摘要均与目录记录一致；Worker process receipt 同时绑定该 Worker release。此次没有执行发布。

| 核查面 | 观察结果与边界 |
| --- | --- |
| Worker | `20261104T135815Z-28278a3e8f6ac4fb`；实际 GET `/api/imports/recovery/customer-service-close?storeKey=jd-chudian-weizhang` 返回 HTTP 200、`ok=true`、`closeAllowed=true`、`downloaded_list_only`。 |
| helper | 现役 bundle 包含 close-target、close-result、close 三个路由；实际只调用 close-target GET，三个目标结果见下表。POST 从未调用。 |
| Django | 已安装 `backend/workflow/jd_customer_service_close_authority.py`、`urls.py`、`models.py` 与已发布冻结源逐文件 SHA256 一致。确认授权代码与路由已安装；没有创建授权或提交闭合来验证写路径。 |
| 前端 | release source-snapshot 中 close route、闭合控件、链路规则视图与已发布冻结源逐文件 SHA256 一致。实际入口是“数据导入 → 链路规则”的京东客服控件，也在规则详情中呈现。控件限不受数据范围限制的管理员；此次未操作浏览器、未做界面点击验收。 |
| 迁移依赖 | 闭合授权引用的 `WorkflowWriteRequestReceipt` 来自 workflow `0001_initial`。本轮不依赖、不修改 `0009/0010`，未连接生产数据库查询其应用状态；当前全库迁移状态未据应用代码安装或其他迁移回执推定。 |

| 店铺 key | 当前 helper GET 候选结果 | 含义 |
| --- | --- | --- |
| `jd-chudian-weizhang` | 11039，`closeAllowed=true`，`downloaded_list_only`，`CHAT_PAGE_MISMATCH` | 已有候选可达，尚未提交人工闭合。 |
| `jd-cuizhiwang-dengweizhang` | 11018，`closeAllowed=true`，`executed_verify`，无失败码 | 已有候选可达，尚未提交原 C 验证续接。 |
| `jd-maidehao-operator1` | `closeAllowed=false`，`SOURCE_RECOVERY_REJECTED_MANUAL_ACTION` | 现役仍给泛化拒绝。本轮仅改善拒绝诊断。 |

候选通过不代表提交成功。原提交链仍复核 Django 授权、n8n 终态、helper 槽位、规划锁、浏览器端口、来源二次读取与 CAS；`executed_verify` 仍执行完整原 C 验证。没有证据证明线上存在共同的入口部署阻断，也没有通过未执行的提交来声称这两店已解开。

原始事实入口：`D:/codex-isolated/main-manual-release-20261016/PUBLISHED-MAIN.json`、其指向的 `publish-ece8c7ec46ac/SUCCESS.json`、现役 Worker process receipt 与两个组件 manifest。限定读取得到的摘要结果整理于 `D:/codex-artifacts/jd-cs-close-diagnostics-20261105/deployment-observation.json`。历史 `dd4bf1a2` 仅作定位线索，未作为当前部署证据。

## 本轮改动

1. `lib/jd/customer-service-close-contract.ts` 新增可选 `diagnostic` 契约，只含固定类别、`list.xlsx/messages.log` 两个固定 basename 和必要的聚合计数。
2. `tools/jd-customer-service-source-recovery.ts` 在闭合证据的具体拒绝点附加诊断，包括文件缺失、安全检查、大小/摘要不符、检查点/目录/边界不符、计数不等及解析拒绝。诊断存于本模块 WeakMap，不写原计划、检查点或来源文件。主动拒绝仍抛原 `SOURCE_RECOVERY_REJECTED_MANUAL_ACTION`；缺文件仍抛原 ENOENT，解析仍抛原异常，现有错误码白名单和兜底映射保持。
3. 只读候选响应增加结构化诊断，并把固定中文类别、必要计数附在现有 `reason`。现有控件已显示 `target.reason`，无需前端渲染改动。
4. 新增隔离测试 `tests/jd-customer-service-close-diagnostics.test.ts`。全部文件、计划与来源均为临时目录内的合成夹具，未使用真实聊天材料。

双文件最终的三个拒绝条件仅拆开标注：list 解析数必须等于 list checkpoint 数、messages 解析数必须等于 messages checkpoint 数、必须有时长异常。比较对象、顺序与逻辑没有放宽。目录白名单、路径/链接检查、文件大小与摘要检查、导入 200 条上限、四个 kind、人工授权语义、提交再校验和 CAS 均保持；没有新增闭合路径或自动重试。

响应只输出类别、聚合计数与固定 basename，不输出完整路径、目录名、聊天、顾客/客服标识、原始异常、堆栈或内容片段。SHA256 未为诊断新增输出。

## 未决口径

提示词已证麦德好 list 解析会话为 5058、messages 解析会话为 5046，messages checkpoint 为 5058，差 12。本轮没有再次展开真实聊天，也没有把这组差异归因为导出缺失或口径差异；两种解释均仍可能。

因此保留 `chatSessionCount === files[1].sourceCount`。需要京东导出页面/字段口径的独立说明，或业务侧确认，才能判断既有基准是否适用；重数同一份文件不能提供独立定性证据。麦德好继续拒绝是合法结果，不以降低一致性闸来解除卡点。

## 限定检查

证据目录：`D:/codex-artifacts/jd-cs-close-diagnostics-20261105/`。

| 检查 | 结果 |
| --- | --- |
| 新增限定回归 | `node --import tsx --test tests/jd-customer-service-close-diagnostics.test.ts`，4/4 通过。内部覆盖 11039 list-only、11018 executed 无失败码、7 种诊断触发、2 种边界反例与错误白名单；候选读取前后临时树的文件集合及全部字节摘要不变。记录 `targeted-tests.txt`。 |
| 定向类型检查 | 检查两个改动模块、新测试及其真实依赖；候选和 main 基线各只有同样两条既存 TS18047：`tools/sales-import-runner.ts:887:59`、`:909:38` 的 `fee` 可能为 null。没有本轮文件的类型错误，但整体检查 exit 2，不能报告全绿。记录 `typecheck-candidate.txt`、`typecheck-baseline.txt` 与定向配置。未修无关销售导入代码。 |
| 原生 helper 构建 | `node tools/build-worker-helper.mjs --source-root <隔离工作树> --output <artifact/helper-build/tmall-workflow-helper.mjs>`，exit 0；原构建器完成实际闭包转换和资源生成。只构建隔离 bundle，没有运行 bundle、启动 helper 或生成生产应用包。记录 `helper-build-receipt.json`。 |
| Git 差异检查 | `git diff --check` 通过；仅本任务文件。 |

未跑全量业务测试、采集、导入、补跑、生产写入、人工闭合 POST、发布、迁移、备份、启停或进程终止。没有修改生产 `outputs`、`active.json` 或来源原件。

## 发布范围与后续

既有只读分类器对完整程序差异给出 `scope=full`、`components=[worker]`、`migrate=false`：source-recovery 在 Worker helper 复制/构建闭包内，契约属于 Worker 共享库；未改 Django 载荷、migration、依赖或发布工具。保留分类器要求的完整 Worker 流程，不把共享库变动声称为单纯前端展示。此分类只是计划，没有准备制品或运行发布。若最终 main 或实际前驱发生变化，按最终完整差异重新确定范围。

主代理按用户本轮新增要求发起两个独立 Astra High 反审，A/B 均通过，无阻断发现，无需程序修改，见 [双独立反审](REVIEW.md)。审查期间三个程序/测试文件冻结；请求型号与强度不等于已经独立确认的底层实际型号。合并 main 与制品准备尚未授权，上线另须本次明确授权；本报告不是生产操作许可。
