# Runner 升级对账与受限发布续接

## 交付范围与状态

本轮按用户批准的最小方案实施，基线main为`b44889912af8968815205c54a16f88f3c6ad3c0e`。候选在`codex/release-resume-20261021`；本轮不合main、不更新已安装控制入口、不准备生产制品、不执行生产续接/发布、服务启停、数据库操作或模型/消息实投。原生产发布和不可变包保持。

- `UpgradePi`异常先保原始输出字节和直接退出证据。原进程退出未知即停止；完成的Windows原result/config/key/intent经精确核对和原ACL后置检查后复用；只有未完成且Linux精确新单元活动、原intent合格时，调用一次原Reconcile。协调意图在原发布目录create-only保存，换resume目录不能获得第二次协调。
- `publish-main-status.mjs`默认只读，必须从原冻结包运行；`--resume`仅支持无迁移、Worker+Django及本次Runner升级的发布尾部。复核原请求/准备包/源码、发布owner与迟到控制者、实际前驱或已采用候选、Django manifest、维护/排空、消费及退出回执。原`DeployApp`/`HardenAcl`必须已有可信完成记录，绝不由续接入口重新执行。
- 原WorkerApply、退出维护、Start、VerifyStartup有可信结果就复用；有started无可信结果为unknown，保留并拒绝重放。共享尾部继续调用原生命周期入口、rotation及队列锁；原格式publication lease覆盖退出维护与Start间窗口，使用原维护ID。SUCCESS后只有发布目录更新失败时，后续仅协调索引，不能重新发布。
- 新完成回执明确`manualRecovery=true`、`automatedPublisherSuccess=false`及原STARTED/FAILED摘要；原件不覆盖。`knownResume`、`pi150-forward-recovery`保持历史专用。规范只补标准入口、完成判据与异常原则三段。

## 必需代码验证

| 检查 | 结果与范围 |
| --- | --- |
| 发布与续接定向Node检查 | 93项通过：原55项编排及新增catch分支、unknown不重放、一次guard、进程退役、目录单独协调、原字节/真实退出与库存闭包 |
| Pi只读观测私有Python夹具 | 15项通过；真实内联Linux检查函数使用临时文件树和低层OS替身，不调用WSL/生产 |
| PS5/PS7原生参数与分派夹具 | 均通过；原ParamBlock、两个公共动作、原mutex和ACL后置顺序，零生产读取和生命周期动作 |
| 发布候选兼容与包验证 | 干净候选`f50f9717201fb1a93416c5147cc9aa07442f4988`，原验证器7项全部通过：定向编排、只读观测、PS5/PS7公共入口、Worker完整性、历史入口边界、真实私有PrepareApp/Deploy/hash/ACL/本地R2闭包；原始14份输出摘要已独立核对 |
| 独立增量审查 | 通过；原始字节、两处直接退出未知保护、原owner退役、一次协调guard、源包限定、恢复来源和目录单独协调均已核对；[审查结论](REVIEW.md) |

PrepareApp仅新增六个实际依赖文件；验证器用精确逆投影核原生命周期函数不变，并将新增getter固定摘要、原公共动作的其余分派保持原字节。没有修改`backend/pi_runner/runtime_upgrade.py`的apply/reconcile、维护锁或Start/Stop引擎语义，不增加全仓测试、全库备份或恢复。

原报告`D:/codex-artifacts/release-resume-20261021/candidate-check/REPORT.json`摘要为`48cadc6db28f80a4275618895d69f5010b1d024b69421e65e36b180bd6c456e4`，`packageIntegrity/nativeEntryBoundary/piMainResume=true`，`nativeColdStart=false`。普通权限单次验证进程直接退出0，临时候选工作树由原验证器清理，单次任务在无实例、已结束且定义摘要精确匹配后删除；没有Stop生产进程。安全字段见[检查摘要](verification-summary.json)。后续只补本文档/审查结果，不变更上述已验证程序字节，不把元数据收尾称为重新运行验证或生产采用。

按映射`2026-10-15-v3`请求Astra High做必要规划，Sol High做边界实施与独立关键审查；工具未返回实际模型ID，未另行独立确认。执行者与审查者上下文分离，审查者未改源码或运行生产。

## 适用边界

新单元已切换却停止、旧单元已恢复、缺原owner/协议/可信结果、结构迁移、源码/前驱/消费/维护绑定冲突均阻断；此版本不自动启动Runner，不把一次性恢复脚本通用化。已持久完成的Windows升级允许Runner随后停止，由原Start依据已正确的新配置管理；只读状态不会调用签名health或写nonce。运行中的旧包不会因本轮源码修改获得这些新入口，不能对旧封存包热改后套用。

新的手动续接仍需要对应生产授权。`--help`和私有测试通过不代表已经对生产使用了新工具，也不承诺固定发布耗时。
