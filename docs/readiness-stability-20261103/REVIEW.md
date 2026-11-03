# 实现独立反审与闭合

用户此前指定Astra Max与Astra High，实施沿两名未参与实现的原审查上下文分别完成增量反审。请求为`gpt-6-astra / max`和`gpt-6-astra / high`，工具未提供底层实际型号的独立回执。双方只读源码/差异/检查证据，必要反例只在内存或私有目录执行，没有生产HTTP或控制动作。

## 发现与处理

| 发现 | 修复及证据 |
| --- | --- |
| 诊断回调期间取消仍可能接受成功 | 接受成功前复核signal；同步回调取消反例返回cancelled。 |
| 单次ready不服从父期限；显式较晚值可能延长期限；status清环境丢期限 | 单次默认按父剩余量收窄，显式/继承取min；status先捕获验证再恢复；过期零请求、真实隔离子进程传参通过。 |
| 慢/挂起诊断把已经合法的ready变成超时失败 | 按探测完成时刻判定，观察回调最佳努力不等待，移除每轮同步lease刷新；慢/挂起/抛错观察不改变已成功就绪，尾前原18分钟lease覆盖120秒。 |
| 看门狗snapshot120秒之下还套着control child60秒 | 仅该control driver90秒，其他child仍60秒，继承snapshot剩余量；实际参数转发和父45秒裁剪在隔离传输边界通过。 |
| 新helper属于已复制prepared的静态依赖 | 控制包和Django复制清单补该helper，冻结source闭包检查覆盖。旧Pi动态timing可选导入的基线缺口不扩入本轮。 |
| 新复制行改变Django控制器字节，既有维护资格仍识别旧值 | 精确AF6→C7 pair，须匹配Django名/旧SHA/新SHA/expected，不加泛候选。限定变化、实际raw SHA、未知名称/前驱/候选拒绝均检查。 |
| 任意异常对象可能带出任意字段 | 不透传`error.ok===false`对象，固定本地失败类别；SECRET反例未出现在诊断中。 |

## 最终结论

两路核心代码复审与兼容profile/精确资格增量复审均通过，**无剩余P1/P2**。有限profile要求13个运行文件加verifier，额外未知路径拒绝；不扩大全局白名单，不改CI或把检查加入生产发布链。已有历史许可、UNKNOWN不重放、严格ready后才SUCCESS等边界保持。

文档保留诊断最佳努力、前置单次检查、历史恢复不热改、源码不等于采用等限制。单服务4秒/整轮18秒/外层20秒是经隔离边界验证的工程值，不称为生产P95或已证明本次唯一根因。

独立反审通过后，主负责人在干净`d4ad90b4c6049026f87809ec87cb4bbef3939b44`运行原固定verifier。11组检查均exit0，原生报告passed、packageIntegrity=true、nativeEntryBoundary=true、nativeColdStart=false，私有候选已清理。详细绑定及原始日志位置见[COMPATIBILITY](COMPATIBILITY.md)。本次没有准备或上线生产制品。
