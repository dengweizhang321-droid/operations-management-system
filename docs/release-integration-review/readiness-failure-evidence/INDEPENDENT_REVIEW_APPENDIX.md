# 独立复审附录：开发测试辅助项

**两个开发辅助改动可提交，无新增阻断；未部署。** 原 [INDEPENDENT_REVIEW.json](INDEPENDENT_REVIEW.json) SHA `fd290ae16c97dc0ba6ff6cf8d5ebe2c70e89767411c0a1a8c2bfdef58de8fdf4` 和Markdown保持原字节；原三源码＋作者测试四份摘要及独立21/21结论都未改。本附录仅只读diff/源码和保存日志，没有重跑native或增加验证动作。

`tests/release-batch-powershell-environment.test.mjs` 仅四个合成batch补 `recovery:{mode:'full'}`，满足原main v3已读取mode的schema；保留全部PS5环境、Unicode、throw/exit9、参数及父环境断言，生产代码不变。SHA `c35ef9fe30f2082b063ac6a74f2d864bb87d6ebc76bb203cd2d8a3241d82f0a7`。

`test-dependency-loader.mjs` 是显式启用的test-only resolve hook：仅本UI工作树来源的bare包从现存D集成树anchor定位，relative/node/file/#/drive导入保持；没有安装、link、move或文件写入。SHA `ec9db9d028aea7b0803da4316a1f9d0896387d77b71f7532285738c0b23b3bd2`。它依赖现存本地开发目录，不能当干净安装或生产依赖闭包证明。

已保存作者RELATED_FINAL.log为 **17/17，5478.2183ms**，内含11 capture＋6环境项；11不再次相加，也不冒充独立重跑。源码显示真实PS5传输仅使用受控tmp脚本/ACL、合成nested adapter、Unicode和失败退出。原缺TypeScript及15/17旧fixture TypeError日志保留，未改写为旧运行成功；原报告authorReportedTests:10是此前消息快照，本附录明确当前组合实际11＋6＝17。

RELATED_FINAL.log SHA `cc1e5bf14f3744426c78fb3c82229b0e06884fc4a2dc2923785582b4a7b00fa5`。其experimental-loader警告仍保留。实际NotReady根因/系统就绪未确认，原unknown21、旧封存和生产文件不变，本附录不授权部署或再试。机器附录见 [INDEPENDENT_REVIEW_APPENDIX.json](INDEPENDENT_REVIEW_APPENDIX.json)。
