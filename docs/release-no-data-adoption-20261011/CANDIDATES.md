# 最终精确候选与首次采用范围

2026-10-11。开发、Git 交付、候选准备与生产采用分别判断。以下是最终待批准对象；旧 f308 及V2/V3批次保留为未批准历史，不换绑或重放。C 只准备与复审，统一安排发布。

| 对象 | 精确值 |
| --- | --- |
| 源码根 | `D:\codex-isolated\release-no-data-adoption-20261011\adoption-source-v3` |
| 完整源码 SHA（5160 文件） | `ef5cc058391988586de4cf2b64289a13f0f3682a1a38db5569213f704323e1d1` |
| 完整库存 SHA | `dd769ec44a9833f876326c0df4b858a91ee2a656a636c33d5b402a87c0335d20` |
| SourceBinding SHA | `dc45c01f2c9ea7398fae6c55c10d6408e59fdc9177d45fc7e81fd3172f367912` |
| Worker release | `20261011T051645Z-3032ae332a32f1a0` |
| Worker manifest SHA | `58cc236e09f097f2c7aec054af9699fc7c0aca3bda1cd79d1c47cbf06efd1a8f` |
| 原 typed plan SHA | `3fb9b0fe083862da5a1a426b444a91365b2ec4fdecb0c4191c2c18f0a12ccb5b` |
| 原 prepared receipt SHA | `6accd380f62dd6cfcae325f4460106fd166c34f99c578405b3a2098a22dc0af1` |
| guard receipt SHA | `dc1d63ce61e411a9eb67b79100a3f54adb4f8e63b89d7d0ce305bb6c4f22e515` |
| 实际前驱 Worker manifest | `f4e537eb20dfa60127cf588db0ed911223c0b59c44fc8b839e5df196428e7113` |
| 实际前驱 binding SHA | `094e10d4508986d62e5d90bf99041271fb7527f9a8b5d33f1dfb386529cee548` |
| 前驱链 state SHA（219 记录） | `aaf62994c75c3ca46362328fed6acc76f812808a2e852566782e5e0ba897e0d9` |
| Django 当前前驱 SHA | `237fbe0de6e4fbab6b80389298ba1b8a5951b5aaf213c250ad3ee9f590010ab9` |
| Django prepared id | `1e1138feef7148fb851713c2b39a25d0` |
| Django prepared receipt SHA | `10db2364053ebfb90d85dd301914753453d02ad313cd02ff7312ca654ebdeb9b` |
| Django 候选 SHA | `85cf0699925aad21f98ae682f458789236d206723b10865939915d1bcacddd09` |
| 精确 SEALED batch SHA | `65fc5338321efc2d79168764f7b2227002333199d038409dc6dd7277acaed8d2` |
| 外置批次文件 | `E:/codex-artifacts/release-no-data-adoption-20261011/ADOPTION_BATCH_V4.json` |
| 动作前引用 guard SHA | `04655a323af97453b7ae38670a6470e495226e85c337fb9b0a72684726a54edd` |

源为实际 AB 完整 snapshot 加精确十个发布控制模块；业务源码不带入未采用的 main 变化。主任务独立核六个新增量/上下文与 collector 全文、既有两处 import/catch 差异及各原始 SHA。换行归一化仅做语义比较，生产按实际 raw hash。最终候选166/166 PASS38.573s；187开发用例另含21个不随包的离线工具用例，不累计。

原 Worker prepare-online真实05:16:45.042–05:28:51.171Z，12分06.129秒；Django既有真实PrepareApp69.927秒，两工具原始字节未再变。原Django完整前后2933盘点，2工具+具体CF缓存六传输leaf变化，全部业务/config/drizzle/依赖/原PG工具保持。实际CF raw值不进证据，原/后hash与其他字段/type全等纳入限定资格及原manifest；没有通用cache忽略。

主任务在真实当前runtime执行标准只读collector，完整前后源/npm/config、当前head+candidate载荷、Django前后库存/CF、末chain/Django/WAL与Worker/helper身份全部通过；complete-artifact-and-head171.975s。它是实际批准前只读检查，既不是VM也不是生产切换验收。其V2批次时间戳不为V4续期；正式执行V4仍动作前全部复验。实物W/D/source元组不变，V4只更新外置引用guard、spec/tests路径及维护id。

V4引用检查支持全部盘符限定实际路径/token的realpath及最近真实祖先；未知阻断，带空格单路径保留。四个旧漏洞复现、16个VM通过；主任务实际1160个state/run/prepare/deploy JSON、818进程、215计划任务核对，无引用/未知。不是任意脚本、relative/env/encoded/UNC或全系统handle证明；当前项目绑定的启动/collector/候选按明确绝对路径检查，动作前再核，不因已复制删除被引用原目录。

旧app.previous完整3468文件已保全，tree fa434f8ec1a49dbb478f8457eda601e8089a4bb7ffbfbf8b5562797b2fd3000b；原目录未移动或删除。首次strict/full20操作保留4DB，先维护/停Worker→apply→引用guard→原DeployApp/HardenAcl→原ExitMaintenance/Start→实际验收→后保护/收尾，过渡期间没有backup/retention。原EnsureReady、迁移检查/权限治理/接收器恢复须在最终人类批准范围中，不称零写或两组件事务。

失败保留gate、owner和原WAL，不重放unknown、不直接复装不能解释sourceBinding历史的旧resolver。必要控制回退采用兼容新精确successor；业务字节本次一直保留AB。数据库恢复另批。原AB109/WAL5289及补充合同完成保留，旧engine false/unknown不回写。DailyPAUSED/unknown/unverified独立呈现，不改变调度及三份保留。

尚未执行任何生产维护、切换、新生产备份/演练或业务导入。最终来源/制品/批次与独立审查就绪后才提交精确生产确认。历史对象见[CANDIDATES_F308_HISTORY.md](CANDIDATES_F308_HISTORY.md)，操作说明见[BATCH_PLAN.md](BATCH_PLAN.md)。
