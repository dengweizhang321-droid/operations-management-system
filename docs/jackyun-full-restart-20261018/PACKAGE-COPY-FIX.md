# 原生依赖封包复制修复

## 状态

候选修复，尚未部署。基于 `origin/main=e3a72a9ad73d99ff66ee580be767b99278755fd1`，本阶段仅开发与私有验证；合并、最终绑定制品及原生 prepare-only 由负责人统一执行。用户新的“上线”指令之前不执行生产切换。

## 阻断与修改

原 prepare-only 日志在私有 `build/node_modules` → `release/node_modules` 的目录 rename 报 Windows EPERM。此前 Vinext、helper、产物预哈希及原构建合约检查通过；不据 EPERM 推断唯一底层原因。原失败包和记录保留，不热改或重试旧包。

本次失败已发生真实构建和私有 staging 写入，也已存在 PREPARING/FAILED，不能描述为“零准备作用”。rename 位于 copied tree 复验、releaseId、manifest 及候选发布之前；build 返回之后才写 rotation plan，再进入 Django PrepareApp。原失败未形成完成候选或 Worker plan、未进入 Django PrepareApp，没有 activation、维护或部署；finally 已清除该次私有 staging。

`tools/worker-local-release.mjs` 仅将此一步恢复为原有 `cp(..., { recursive: true, errorOnExist: true, force: false })`。历史 `6b9d24b3484118ec44f216cff919a543e348b284` 的父提交中，该调用与本次恢复完全一致；dist/helper 继续使用同一复制选项。复制前的 nodeModulesTree、最终 validateTree、源闭包、路径与重解析保护、工具链及制品身份核验全部保持。最终 release 目录原子发布的 rename 保持。

同步仅纠正《验证与发布》有关依赖目录转移的一句现行细则；同精确包复用、离线 tarball cache 与新包 npm ci 的规定保持。不引入提权、终止进程、盲重试或通用 fallback，不新增依赖目录缓存。

## 定向验证

原始日志：`D:/codex-artifacts/jackyun-full-restart-20261018/package-copy-fix/`。

| 验证 | 结果与证据 |
| --- | --- |
| 原生产依赖封包语句的私有真实文件树运行 | 新增两项，嵌套/空/二进制/中文文件完整复制，源树保留；最终验证拒绝输出改写和缺失；既有目标叶报 ERR_FS_CP_EEXIST 且两端字节保留 |
| `node --test tests/worker-source-read-once.test.mjs tests/release-source-binding.test.mjs tests/release-preparation-runtime-config.test.mjs` | 49 项全部通过；`worker-integrity-with-dependencies.log`；同时复用路径越界、重解析、硬链接、读取中变化与来源绑定负向验证 |
| `node --import tsx --test --test-name-pattern 'real release artifact packer\|source snapshot fingerprint\|bounded parallel tree hashing\|isolated source closure\|Vinext scratch\|release source fixes build closure' tests/worker-local-release.test.ts` | 15 项全部通过；`worker-release-targeted-with-dependencies.log`；覆盖真实受保护入口封包、原哈希协议、源闭包及 Vinext scratch 拒绝 |
| 定向 ESLint、Node 语法、差异空白 | 见 `eslint.log` 和 `VALIDATION.json` |

首轮未连接该新 worktree 的依赖，typescript/esbuild 的导入失败日志原样保留为 `worker-integrity.log`、`worker-release-targeted.log`。随后仅在私有 worktree 创建指向现有依赖目录的 junction 供测试读取，未安装或改写该依赖树，重跑通过。

这些验证没有构造现场 EPERM 的唯一根因，也不证明完整原生打包已成功。最终 main 绑定的全量原生 prepare-only 仍由负责人执行；本阶段未重跑 ERP 全部测试、全仓类型检查、生产工作流或生产数据操作。
