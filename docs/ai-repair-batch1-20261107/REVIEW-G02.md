# G02 兼容适配独立审查

2026-11-08。审查上下文未参与本适配规划或实现；按用户本任务要求请求 Astra High，工具未独立回传实际底层型号。仅审查新增适配、直接依赖和原始证据，不重新全面审查六个已通过小包，不运行生产操作、正式打包或合并。共享记忆由根负责人统一维护。

## 当前结论

**源码及已有原件审查通过，未发现阻断项。最终固定入口检查待执行，本报告不表示 G02 已通过或整包已可合并。**

绑定基线 `0c7d0feb33f45cfc6ae1f283b81d401c873c5768`、已审应用提交 `eee39f9d315eaf9dd71f8390181879cdb6ba2c82`、应用 tree `18ce84ef8fe69ebd9128dc2b540ee5c67dc977ed`。此次适配五文件以外置 `G02-ADAPTER-SOURCE.json` 为冻结来源，原件 SHA-256 为 `d4898ba9172c0c5d87da766fe03c26f5b754eb6a0a98cd7b6576a48b58682938`。此结论只覆盖该原件中的实际字节。

## 核验结果

- [验证器](../../tools/verify-release-candidate.mjs) 专用 profile 要求固定基线、46 个完整已审非文档路径及其 A/M 状态、四个指定适配路径；删除、改名两端、缺项和未知运行路径不能取得该资格。实际干净候选再验证已审提交祖先关系、tree、46 路径原始字节汇总，以及 full、Worker+Django、无迁移计划。独立重算摘要为 `ba7fbd961afa817b4f8991a04bd902eea00a429e55bbb6380c3b8b97f1a2d12b`，与固定资格一致。没有扩大原控制器字节资格或改变既有 profile 的检查清单。
- [离线核对器](../../tests/ai-repair-batch1-compatibility.test.mjs) 固定 17 份原件摘要，不接受调用者任意 supplied passed。独立核对冻结清单 5 个源码文件和 7 个证据文件全部匹配；复用原件未记录的提交、工具摘要或退出码没有被补造成已知值。TypeScript 使用最终 16 文件绑定，167→167 仍表示既有诊断未消失；Python 旧原件无字节绑定，适配明确在冻结来源补 25 文件 AST 解析。
- 两发布入口的递归模块集合、直接依赖、启动与维护控制器，以及 63 个镜像输入均由固定入口内的核对器重新绑定。新增镜像选择 export 仍从既有模块导入。旧 installed inventory 缺 `publish-latest-main.mjs` 是已披露的独立基线缺口，当前冻结来源闭包通过不能替它宣称 installed 全闭包通过；没有修改旧测试或在通用分支吞掉其失败。旧 n8n 摘要和全仓 TS 红未被全局放宽。
- [原生 Pi 夹具](../../tests/ai-repair-batch1-pi-native-start.py) 从固定 Git archive 复制 Runner，直接执行 `python3 -B -m pi_runner.server`，没有手工替代 Broker、Handler 或停止 monitor。私有配置/合成密钥为 0600，使用独立 namespace、空账本和确认空闲的端口，health 通过原签名客户端；没有实际模型请求或生产凭据。
- `g02-pi-native-v3/NATIVE.json` 与 stdout 原件逐字段一致，夹具摘要、Git archive 摘要及进程退出原件匹配。两次启动 PID 为 57313、57446，均在 UID、argv、procStartTicks 核对后精确 SIGTERM 并 exit 0；同 ledger 路径/device/inode，nonce 由 1 增至 2。原件记录命名空间无容器/卷、进程退出、端口释放和私有目录清理。旧失败原件保留，v2 精确私有目录另有清理回执。该证据只证明空私有账本的 Pi Runner 原入口启动与就绪，不能替代 retained 业务恢复或完整 Windows 栈冷启动。
- 新专用分支显式选择两项 profile 反例、一项离线绑定检查、既有 PS5/PS7 参数入口及真实私有 Django 包复制/部署/hash/ACL/Wrangler 夹具。固定入口仍要求候选干净、完整载荷绑定、前后源码/工具/依赖漂移检查及 worktree 清理，失败会保留 failed。包夹具的 stopped/schema 替身和 PS 参数首副作用边界都已明确披露；完整 `nativeColdStart` 保持 false，Pi scope 单列且必须有真实 passed 原件。
- 已核 [package.json](../../package.json)、[CI](../../.github/workflows/ci.yml) 及其 curated allowlist：新 `.mjs` 离线原件检查没有被 npm test、test:unit 或 CI 自动选入，固定 profile 是其唯一代码调用方，缺原件会直接失败。旧 profile 中全文运行 `verify-release-candidate.test.mjs` 的入口会新增运行两项纯 Git/source 反例，不会加载本机外置原件；该测试文件原已依赖多组历史 Git 对象。因此无需新增通用 skip 或放宽 G02 原件要求。

## 证据与待完成项

外置证据根：`D:/codex-artifacts/ai-repair-batch1-20261107`。

- `G02-REVIEW-BINDINGS.json`：本审查独立摘要核验原件；46 路径、5 源码、7 清单证据、17 固定原件均匹配。
- `g02-profile-tests-v2.log` 与 `g02-compatibility-fixture-v2.log`：实施者定向 2+1 项通过原件已核，不冒称本审查重复执行，也不当作最终 G02 passed。
- 最初 `candidate-compatibility/REPORT.json` 仍为 failed，37 unsupported、checks 为空；未覆盖或改写。源码差异空白检查通过，适用 AGENTS/模型/发布规范与固定基线无差异。

下一步由根负责人提交干净候选后执行原固定命令，在全新工作树外目录生成 REPORT。必须实际核对四个新 checks、各退出码和 stdout/stderr 摘要、私有包与 PS 入口输出、复用证据绑定、载荷稳定与清理。原 `nativeColdStart=false` 和限定 Pi scope 继续保留。该最终报告完成后返回本上下文，只复核新增报告与实际增量；没有源码变化时不重复本轮审查或业务套件。

本轮无发现需要返修，`findings=[]`。未合并 main、未准备正式制品、未上线；审查通过不是这些操作的授权。
