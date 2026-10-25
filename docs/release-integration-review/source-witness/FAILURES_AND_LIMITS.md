# 保留的首次失败与边界

- 首次COPY提取因post COPY时区与原collector UTC不一致而完整根断言拒绝；修正为保留微秒的UTC渲染后才匹配，原`EXTRACTION_FAILED.json`仍在外部`AB-source-witness-20261010-1128-first`目录。相关作者COPY各次日志保持，不删首次失败。
- 初次独立COPY负例发现微秒边界被毫秒截断、数字ID可泄露、宽松日期识别可泄露文本；最终reader修复后独立16项通过，首次报告与日志保持。
- 初次堆页fixture缓冲长度不足保留；独立9项首次5通过/4失败，发现external tag、compressed长度、LP重叠与存储对齐缺口。补强后独立9+作者5共14通过，FIRST/FIXED日志保持。
- 首次独立真实页验证器使用Windows中文file URL的pathname读文件失败，改`fileURLToPath`；这是工具路径失败，不是数据断言失败。独立最终真实验证仍要求全部四个完整表根和唯一FPI旧版本。
- 精确提取首次要求两次pg_restore stdout摘要相同而拒绝。原生SQL输出含每次不同的restrict包装，输出字节不可直接当数据根；改为保存每次stdout摘要，并继续要求六张表各自完整原profile根。首次generic rejection在对话工具记录，不补造丢失的详细日志。
- 初次精确规则要求未删除task的`deleted_by=null`被实际空字符串拒绝；以实际模型/归档的空字符串契约修正，未经改变原数据。UTC/COPY时区表示比较使用归一化，不能把同一created_at误报为内容变化。初步`EXACT_TRANSITIONS.json`与最终`EXACT_TRANSITIONS_NORMALIZED.json`均保留。
- 新补充协议作者首次15项13通过/2失败，fixture重新序列化原candidate-handoff导致原闭包SHA拒绝；改为保留原contractRaw后15/15通过。拒绝旧pin的实现没有放宽。首次/二次详细TAP在本聊天工具记录；本文件不伪造首次运行的源码SHA和准确耗时。

本目录的采集/重建CLI只用于本次只读取证，并不是生产执行接口。其页面候选不表达MVCC可见性；完整原根约束和唯一匹配是此次旧记录采用依据。现有旧页不保证今后仍可取得，原pre整份恢复包仍不可得。新执行协议只消费已独立核验、精确钉住的证据与私有输入，不重新采集PGDATA、不运行重建或pg_waldump。

不存在历史原HTTP信封/签名重新验签的证据。不把精确源码门禁与回执一致性描述成找回原签名；不把新用户批准倒填成历史用户授权。旧严格比较和原命令失败均继续保留。
