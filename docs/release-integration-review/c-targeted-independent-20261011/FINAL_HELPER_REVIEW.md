# 冻结 b735 配置通知与会话独立复审

**当前helper通过，未发现阻断；只签SHA `b7355e8f36efe8be54dc1980334f87f109372b1bd743639160064d4034235bf6`。** 不借旧616签名，不代表新完整源码／制品／批次或生产会话验收通过。

固定配置基线在首个watch注册之前同步捕获，后续不更新；只有精确固定文件名／change／非source非recursive通知置pending。pending时assertStable同步复验全部字节、全祖先物理路径及dev／ino／nlink／size／mtimeNs／ctimeNs，与原基线全等才清除，atime不入基线。读取前后身份、16MiB上限和普通文件检查保持；其他路径即使指向同一硬链接inode仍走原safeRead单链。普通source／npm／rename／null或未知事件继续不可逆失效。

[独立7项](final-helper-independent.test.mjs)全部通过，1069.5223ms，[原日志](FINAL_HELPER_INDEPENDENT_FIRST.log) SHA `17319de53ddf4aa1226a79f61b468ff5af62f04fc0478fc86c94d1911ae0aa32`。实测基线早于watch；hash后及collect返回后投递的晚通知触发真实同步重读，漂移拒绝；真实同内容／同nlink inode替换拒绝；source／npm／unknown／rename仍拒绝；非配置硬链接与外部npmrc拒绝；无watch事件的Node／source／npm／environment漂移也全部拒绝。full／reuse／recheck使用实际observe，未传observeInputs。

其中一项使用真正Windows私有fs.watch：收到配置change后，同内容写回导致保护时间字段变化，正确拒绝。其余事件为明确watch回调接缝，实际读取／stat／hardlink／rename只在13个身份已核的私有根内进行，均已移除。私有metadata-only事件能复验通过，**不能据此归因生产通知是atime／其他任务／AV**。原普通source事件和held-input-change没有被豁免或回写成功。

前后helper raw SHA一致；helper及测试语法检查通过。未读取正式配置／npm值、未运行生产watch／NPM／collector／CLI／生命周期，未改作者代码。完整模型／SHA／范围见[FINAL_HELPER_REVIEW.json](FINAL_HELPER_REVIEW.json)。最终新bundle及实际原生会话仍须独立绑定核验，旧aed7／872d不可套此结论。
