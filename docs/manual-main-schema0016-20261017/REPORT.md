# 京东监控0016结构迁移纳入手动main发布

用户要求继续使用原“发布main.bat”手动上线，不手工改数据库，不反复到已完成任务聊天要求纳入发布包。本轮准备和修复发布入口，不执行生产维护、迁移或服务切换。

## 最终行为

- 注册唯一 `inventory.0016_jd_product_monitoring` 的147→148结构追加，给 `inventory_jd_logistics_departments` 增加 `unmonitored_product_codes` JSON字段，默认空集合。既有仓库偏好、商品排序、revision、审计和ACL保持。
- 新148安装器作为原147的有限子代，原146/147目录、指针和证明语义不放宽；新独立operation/active路径。原receipt generation、Django准备/部署/启动、日常备份目录识别均精确识别148，普通启动不要求新配置始终为空。
- main冻结后自动从仓库recipe和真实PG证明生成当次前驱/来源绑定的结构证据，准备模式只读取文件和构建制品。正式手动点击仍沿原native引擎串行维护、Plan、DeployApp/HardenAcl、Install/Finalize、Worker切换和Start；SUCCESS保留同operation/maintenance及原生安装/完成回执。
- 未审核的其他迁移仍停止；已发生意图但结果未知不能自动重放，148已提交后的恢复为兼容应用/前向修复，不自动删除字段或回退业务配置。无全库备份/恢复、业务数据搬迁、导入、回填或真实外部发送。

## 验证

- 新148安装器13项及真实Windows PowerShell5/包内PowerShell7合同通过；原147及继承146回归24通过、1原私有PG专用跳过。
- 独立PostgreSQL17.11、端口55980完成原147建立、非空仓库偏好/商品顺序及revision保留、148原子升级与注入回滚、反向兼容、schema/目录/权限负例、未知意图不重放、committed reconcile及非空新配置的普通完整检查。cluster已停止，临时密码文件删除，未连接生产数据库。
- 对应证明为本目录 `validation.json`，SHA256 `92515c6e2a1233c8be32fdf53b92725acdda35e2dfef3796621417f584e27109`；安装闭包摘要 `fee0b4cbe2f128f80672999978ae783935128ddaf73070b1a12878f1693b633b`。精确`.gitattributes`保留参与摘要文件的原字节，防提交/检出换行变化破坏证明。
- main范围/准备/发布/host/hook/参数传输等66项Node定向测试通过，包含迁移先准备后人工执行、同operation、失败不apply/不退出维护/不重放、准备期证据漂移，以及无迁移原路径。
- 文件证据binder5项通过：原文件create-only、错proof/code/generation、错前驱/父指针、错误check SHA、证据不覆盖及socket.connect禁止。另从实际本机147父链运行文件绑定校验，明确禁网络，成功生成隔离证据。
- 新binder首次完整验证父链，避免在构造同一证据后立即重复admission；原native PrepareApp、Plan及后续完整门禁保持。已有独立冻结request的证据用其原SHA快核recipe/proof、源与迁移、当前manifest和147 ACTIVE摘要，表示冻结输入未变，不表示数据库或历史父链已再次全检。历史依赖自身被改仍可能到原native Plan才拒绝，保留该失败和unknown边界，不据快核放宽native验证。
- 独立审查请求Sol High，实际底层型号未独立确认。独立复核148原生13项、binder5项、Node组件40项及最终proof/源码摘要，无剩余阻断。

最终main、原生Worker/Django准备收据和固定control采用状态以包外实际回执为准；只有用户后续手动执行的部署SUCCESS才是上线事实。本报告不把预准备等同结构已迁移，不沿用旧147成功证明声称148已完成。
