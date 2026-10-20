# 前端热更新交付的限定准备恢复控制

本提交只增加控制工具兼容与历史准备终止分支，不修改已合并的 HMR A/B 实现，不执行控制采用、原生准备、生产发布或历史目标重放。

## 精确 native-tools 兼容

保留原 `teruisi-code-only-native-tools-update-v1`。新 `teruisi-successor-512-native-tools-update-v2` 只接受旧配置 SHA `49caa8d7a140fa614c2f28389029d07f6de6b503df499094d28e07793490200a`、旧 `65dcc585b16e7fd1db5fde4648dec81a114df00e1e5c578976e82bcac854414e` 三文件闭包及新 `d08a3c4de4bd04325bd8e63811775934e97a9f63f757e40b6afec4a3166ddf31` 闭包。仅原 rotation 的唯一 `const maximumSuccessors = 256;` 改成 `512`；另两文件字节不变，不复制其他 main 或运行包代码。输入 JSON 仍只包含 `version`、`oldConfigSha256`、`nativeToolsSource`。目录名称按原 canonical JSON（含末尾换行）的摘要计算。

新 closure 由发布负责人在复核后 create-only 准备；随后以同一干净冻结源码运行：

```powershell
node tools/install-main-prebuild.mjs --config D:/codex-isolated/main-manual-release-20261016/main-publisher-config.json --native-tools-update <精确更新JSON绝对路径> --out <全新控制材料目录>
node tools/install-main-prebuild.mjs --adopt <同一控制材料目录>
```

两步均由唯一发布负责人执行，本提交未执行。

## 原 dispatch 0038 的有限终止

只接 `00385709-d354-4d39-9e7c-bc2b42dd90f1` / `d6742ea6-30d2-4e7c-b58e-3c6399a50ee1` / `c7b817989050ac5af8d989403a0f5cbbd053ce05` 的精确 ticket、dispatch、unknown result、原 adopted/intent/transition/actor 和旧十文件 control closure。82 个源码文件覆盖原 Python `CODE_FILES`、本地 import 闭包、recipe 与 mandatory-checks proof；实际 80 文件摘要 `cb23f567...` 与原 recipe/proof `70f93385...` 不同，固定 await 链在 binder 的 mandatory-checks 异常返回后终止。

保留原 worktree/分支和 `source`、空 `schema` 目录创建事实。仅允许追加 `failed-before-native` / `awaited-schema-binder-rejection` resolution，`nativePreparationStarted/prepared/publicationPerformed/retryOriginal` 全为 false。原 ticket/dispatch/unknown 不改写；旧 c7 目标永久禁止再次准备。新 reader 是 queue 的第七个有限分支，其余未知继续阻断。

原 dispatch 的 e523 前驱继续保留在原件中；当前现场另外绑定真实 20ee SUCCESS、完整 installed Worker chain、Django manifest 和同一干净 source，不假定现场仍是 e523。初末静态观察一致，动态独立见证与普通 writer 的 census/ACK 保持最终 60 秒窗口。请求等待预算 120 秒，整轮 epoch 上限 20 分钟。writer 按 queue → rotation 持锁；高权限 observer 只读现场，仅在外部证据目录写 observation。

控制采用完成后，普通权限从同一冻结源码调用：

```powershell
node tools/main-prebuild-queue.mjs --installer-0038-write <D:/codex-artifacts下全新目录>
```

writer 依次输出 initial/final 的 request 绝对路径和精确 SHA。负责人对每个 request 用独立高权限只读进程运行，并保持到 writer ACK：

```powershell
node tools/main-prebuild-queue.mjs --installer-0038-observe <REQUEST-initial或final.json绝对路径> <writer输出的requestSHA>
```

仅成功追加 resolution 后，负责人再通过原固定入口提交最新目标的准备。不得把该 resolution 当作 c7 已准备、已上线或可重放。

## 必需代码检查

- `node --check tools/install-main-prebuild.mjs`、`node --check tools/main-prebuild-queue.mjs`。
- `node --test tests/installer-0038-control.test.mjs`：精确闭包/逆向唯一 literal、旧配置及字节负例、原 99 对象闭包篡改、packet 非空/额外请求/重定向、见证过期/权限/任务/代际/原 actor、伪成功与混源负例。
- `node --test tests/main-prebuild-queue-v2.test.mjs tests/main-prebuild-eligibility.test.mjs`：15 项通过，包括真实私有锁、已有未知阻断与原 ordinary admission。
- `git diff --check`。未做业务功能测试，未运行 binder、原生准备或生产控制。

代码检查和源码提交不等于独立复核、控制采用、原生 PREPARED 或应用上线。后续事实由负责人在外部证据目录记录，不为回填准备结果再次推进 main。
