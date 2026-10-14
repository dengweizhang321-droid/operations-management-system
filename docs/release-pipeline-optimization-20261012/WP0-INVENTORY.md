# WP-0 Git短时盘点（只调查，不治理）

记录日期：2026-10-12，Asia/Shanghai。仅从Git、CIM、计划任务和现有安装文件/快捷方式采证，不修改任何被调查检出、不切分支、不stash、不清理、不调用Status/Panel、不跑测试/构建/服务命令。

## 固定基线与采集时间

- baseSha：**b3c6018cca6c2b2b5c8fa6c5b52e376f3a84f354**。
- 调查分支：**codex/release-wpb-baseline-20261012**；工作树 **D:/codex-isolated/release-wpb-baseline-20261012/运营管理系统**。创建前本地及真实origin同名分支均未检出，故新建而非覆盖。原主检出保留。
- 已在主检出只执行Git只读状态与授权的fetch origin --prune，刷新远端跟踪信息；没有移动main、删除本地worktree或本地/真实远端分支。prune只更新过时跟踪引用，不是工作树治理。
- Git/CIM/计划任务采集开始 **2026-10-12T22:05:47.8705153+08:00**，结束 **2026-10-12T22:06:12.6522579+08:00**（24.782秒）。首次脚本在解析阶段拒绝，未执行采集或任何变更；纠正后本区间单次采集成功。范围：当时全部32个Git登记worktree、29个本地分支、main/origin-main祖先关系，普通令牌可读进程元数据和全部计划任务。
- 22:09之后至22:20:42报告复核前，另补读启动快捷方式、HKCU/HKLM Run、已安装wrapper文件/摘要及主检出保护入口。不同采样点分别保留，非全局原子快照。
- 没有冻结其他聊天。此报告用于建议与交接；实际治理必须重新核验当前所有相关证据。本次本树后续只新增两份报告并提交，表格反映提交前采集点。
- [能力基线](WPB-BASELINE.md)的固定源码/最终采用记录与本快照互补；历史清理报告或记忆不是实时删除依据。

## 主检出关系与计数定义

main = **2f55c3965e60b139381b6cc31ed868bcfe99a7bf**（commit时间2026-10-08T11:39:31+08:00）。

origin/main = **b3c6018cca6c2b2b5c8fa6c5b52e376f3a84f354**（2026-10-12T19:16:53+08:00），main是其祖先。rev-list --left-right --count main...origin/main = **0 / 159**，可快进的提交图不表示主检出可以直接安全更新。

未提交数为 git --no-optional-locks status --porcelain=v1 --untracked-files=all 的路径行数，tracked与untracked各算1，ignored不计入；主检出12项=6 tracked修改＋6 untracked文件。首个默认status折叠目录为10行，不能与12个实际路径当作新增两项。共有5棵现有树有未提交内容；本树采集时干净。

忽略文件以 git ls-files --others --ignored --exclude-standard --directory 的**折叠条目**归类，不是文件总数或占用大小；未读配置/凭据内容，未判runtime为可删缓存。Git行数/空列表不证明系统句柄缺席。

包含关系使用各精确HEAD分别对本地main和origin/main执行merge-base --is-ancestor，不用patch等价替代祖先；未被包含不等于功能未采用。32树中6个HEAD被本地main包含、25个被origin/main包含（含本树）；29本地分支中18个有同名origin跟踪引用，另有其他远端分支不在“本地分支表”的范围。

## 工作树建议表

动作只使用用户指定的五种取值。本轮**没有可安全移除项**：对干净/已合并树仍缺当前原任务归属、全部发布来源引用或独有忽略材料核验。路径在D:/.codex/worktrees下的树视为受管候选，不能因缺聊天映射改用Git删除；真正受管树只能通过应用归档。其他路径也不凭目录名宣称已排除应用归属。

| 路径 | 分支或 detached SHA | 已合入本地 main | 已合入 origin/main | 未提交改动数 | 忽略文件情况 | 建议动作 | 阻塞原因 |
| --- | --- | --- | --- | ---: | --- | --- | --- |
| D:/运营管理系统 | main @ 2f55c3965e60b139381b6cc31ed868bcfe99a7bf | 是 | 是 | 12 | 依赖/venv；Python/TS缓存；构建/Miniflare；runtime（内容用途未核）；输出/临时/附件（独有性未核）；运行配置/凭据（未读内容）；59个折叠条目 | 使用中不可动 | 主检出有用户改动、n8n任务/启动入口依赖 |
| D:/.codex/worktrees/0757/运营管理系统 | detached bc9eb01f2cab31767e7569d5f971626956f10cc0 | 否 | 是 | 0 | 未检出（Git规则范围） | 身份不明不可动 | 没有完整原任务活动/归属/发布引用核验；已合并不足以准许移除 |
| D:/.codex/worktrees/161c/运营管理系统 | detached c24c8abf06ba5f684d3970614444bff2b1965849 | 否 | 是 | 0 | 未检出（Git规则范围） | 身份不明不可动 | 没有完整原任务活动/归属/发布引用核验；已合并不足以准许移除 |
| D:/.codex/worktrees/195b/运营管理系统 | detached b3c6018cca6c2b2b5c8fa6c5b52e376f3a84f354 | 否 | 是 | 0 | 未检出（Git规则范围） | 身份不明不可动 | 没有完整原任务活动/归属/发布引用核验；已合并不足以准许移除 |
| D:/.codex/worktrees/1a40/运营管理系统 | detached f0752ec27c3fb266802c6af96881222ff8c6ca5d | 否 | 是 | 0 | 未检出（Git规则范围） | 身份不明不可动 | 没有完整原任务活动/归属/发布引用核验；已合并不足以准许移除 |
| D:/.codex/worktrees/1c0f/运营管理系统 | detached c00edc8df8a04f16fe5a26c4654a45c0bd15f9e8 | 是 | 是 | 0 | 未检出（Git规则范围） | 身份不明不可动 | 没有完整原任务活动/归属/发布引用核验；已合并不足以准许移除 |
| D:/.codex/worktrees/34b4/运营管理系统 | detached cb007f05152bccaf884e60b8cdeaad0c2077557d | 否 | 是 | 0 | 未检出（Git规则范围） | 身份不明不可动 | 没有完整原任务活动/归属/发布引用核验；已合并不足以准许移除 |
| D:/.codex/worktrees/4d2e/运营管理系统 | detached bc1d830b6770bd2858c31aa4d861354da5ec433c | 否 | 是 | 0 | 未检出（Git规则范围） | 身份不明不可动 | 没有完整原任务活动/归属/发布引用核验；已合并不足以准许移除 |
| D:/.codex/worktrees/5d78/运营管理系统 | detached 6a715362c420e48f2f4c41b84c636e5ad1a1cf41 | 是 | 是 | 0 | 未检出（Git规则范围） | 身份不明不可动 | 没有完整原任务活动/归属/发布引用核验；已合并不足以准许移除 |
| D:/.codex/worktrees/79d8/运营管理系统 | detached c6d1fad1acfe188e0262a8e3f40b3295fec33f2b | 否 | 是 | 0 | 未检出（Git规则范围） | 身份不明不可动 | 没有完整原任务活动/归属/发布引用核验；已合并不足以准许移除 |
| D:/.codex/worktrees/81e5/运营管理系统 | detached bc9eb01f2cab31767e7569d5f971626956f10cc0 | 否 | 是 | 0 | 未检出（Git规则范围） | 身份不明不可动 | 没有完整原任务活动/归属/发布引用核验；已合并不足以准许移除 |
| D:/.codex/worktrees/ai-agent-workflows/运营管理系统 | codex/ai-agent-workflows-20261009 @ da0d62bdd92bef118f617d0ce592a8e60682c231 | 否 | 是 | 17 | 依赖/venv；Python/TS缓存；构建/Miniflare；runtime（内容用途未核）；45个折叠条目 | 需先保全提交 | 未提交tracked/untracked内容；当前任务活动/归属须另核 |
| D:/.codex/worktrees/ai-model-origin-fix/运营管理系统 | codex/ai-model-origin-fix @ 88ece24fb48d8e2534ee12ad6c5a476cb2be5555 | 否 | 否 | 0 | 依赖/venv；Python/TS缓存；构建/Miniflare；runtime（内容用途未核）；48个折叠条目 | 需先保全忽略文件 | runtime/独有输出未核；保全前还需确认用途与归属 |
| D:/.codex/worktrees/ai-repairs-production-20261008/运营管理系统 | codex/ai-repairs-production-20261008 @ 8b121267c797d19f2c28478f6ddc79b689baa64f | 否 | 否 | 0 | 依赖/venv；Python/TS缓存；runtime（内容用途未核）；输出/临时/附件（独有性未核）；4个折叠条目 | 需先保全忽略文件 | runtime/独有输出未核；保全前还需确认用途与归属 |
| D:/.codex/worktrees/bf14/运营管理系统 | detached aeb2fc6590c3d306623d80f483eca554292d393f | 否 | 是 | 0 | 未检出（Git规则范围） | 身份不明不可动 | 没有完整原任务活动/归属/发布引用核验；已合并不足以准许移除 |
| D:/.codex/worktrees/c198/运营管理系统 | detached 18d0cae647ad92414f5e36574c2068d31ccdd147 | 否 | 是 | 0 | 未检出（Git规则范围） | 身份不明不可动 | 没有完整原任务活动/归属/发布引用核验；已合并不足以准许移除 |
| D:/.codex/worktrees/ccf9/运营管理系统 | detached 18d0cae647ad92414f5e36574c2068d31ccdd147 | 否 | 是 | 0 | 未检出（Git规则范围） | 身份不明不可动 | 没有完整原任务活动/归属/发布引用核验；已合并不足以准许移除 |
| D:/.codex/worktrees/cd65/运营管理系统 | detached f08b34884fdc83813e4d2c8f3ec86b8ed2a795fe | 是 | 是 | 0 | 未检出（Git规则范围） | 身份不明不可动 | 没有完整原任务活动/归属/发布引用核验；已合并不足以准许移除 |
| D:/.codex/worktrees/de9b/运营管理系统 | detached c1d89b29347ce6868b6f86dd4276c06e226b5356 | 否 | 是 | 0 | 未检出（Git规则范围） | 身份不明不可动 | 没有完整原任务活动/归属/发布引用核验；已合并不足以准许移除 |
| D:/.codex/worktrees/dfb4/运营管理系统 | detached 6a715362c420e48f2f4c41b84c636e5ad1a1cf41 | 是 | 是 | 0 | 未检出（Git规则范围） | 身份不明不可动 | 没有完整原任务活动/归属/发布引用核验；已合并不足以准许移除 |
| D:/.codex/worktrees/netshop-comparison-ui/运营管理系统 | codex/netshop-comparison-ui @ 09f9982c29ab59fdc60cae556f276faa0db39d63 | 否 | 否 | 0 | 未检出（Git规则范围） | 需先保全提交 | 未被远端main包含且无同名远端；必要恢复ref/保全尚未核 |
| D:/.codex/worktrees/netshop-presence-jsonpath/运营管理系统 | codex/netshop-presence-jsonpath @ 0be58e2189328c74e1753a606bf8e190331d68c3 | 否 | 否 | 0 | Python/TS缓存；3个折叠条目 | 身份不明不可动 | 未被远端main包含；同名远端只保全提交，未确认原任务/材料/绑定 |
| D:/.codex/worktrees/performance-experience-audit/运营管理系统 | codex/performance-experience-audit-20261008 @ ca9622ec9cb6067f698b466fefede68e0845b9f9 | 否 | 是 | 0 | 依赖/venv；runtime（内容用途未核）；2个折叠条目 | 需先保全忽略文件 | runtime/独有输出未核；保全前还需确认用途与归属 |
| D:/.codex/worktrees/release-c-native-evidence-repair/运营管理系统 | codex/release-c-native-evidence-repair @ 3f5cfb7e275d67b688f18a115c5584d619dc1346 | 否 | 否 | 0 | 未检出（Git规则范围） | 身份不明不可动 | 未被远端main包含；同名远端只保全提交，未确认原任务/材料/绑定 |
| D:/.codex/worktrees/release-integration-review/运营管理系统 | codex/release-final-readiness-actual-review @ ba656eabbb93d17d6e2f57d51ea3d13b27d1f50d | 否 | 是 | 0 | 依赖/venv；Python/TS缓存；构建/Miniflare；runtime（内容用途未核）；输出/临时/附件（独有性未核）；12个折叠条目 | 需先保全忽略文件 | runtime/独有输出未核；保全前还需确认用途与归属 |
| D:/.codex/worktrees/startup-recovery-continuation/运营管理系统 | codex/startup-recovery-continuation-20261012 @ adedaeb2d2cf0c2999aea6a474b4c8c45ede25d0 | 否 | 是 | 3 | 未检出（Git规则范围） | 需先保全提交 | 未提交tracked/untracked内容；当前任务活动/归属须另核 |
| D:/.codex/worktrees/startup-recovery-integration/运营管理系统 | codex/startup-recovery-integration-20261012 @ 423437cc8b5cb2da2df56733d19feea226f2979f | 否 | 是 | 2 | 未检出（Git规则范围） | 需先保全提交 | 未提交tracked/untracked内容；当前任务活动/归属须另核 |
| D:/.codex/worktrees/watchdog-native-census/运营管理系统 | codex/watchdog-native-census-20261012 @ 18d0cae647ad92414f5e36574c2068d31ccdd147 | 否 | 是 | 1 | 未检出（Git规则范围） | 需先保全提交 | 未提交tracked/untracked内容；当前任务活动/归属须另核 |
| D:/codex-artifacts/workflow-main-baseline-20261007 | detached 3228421c6d60fceef7d49d1f632bc69f61527e30 | 是 | 是 | 0 | 依赖/venv；1个折叠条目 | 身份不明不可动 | 没有完整原任务活动/归属/发布引用核验；已合并不足以准许移除 |
| D:/codex-isolated/netshop-finance-subset-review/运营管理系统 | codex/netshop-finance-subset-review @ e948335f6ff93df0f6e79d2ebceca0dd0cbeb380 | 否 | 否 | 0 | 依赖/venv；Python/TS缓存；构建/Miniflare；runtime（内容用途未核）；10个折叠条目 | 需先保全忽略文件 | runtime/独有输出未核；保全前还需确认用途与归属 |
| D:/codex-isolated/netshop-temporal-review/运营管理系统 | codex/netshop-temporal-review @ b2af337e6a1decb6dc0e74aefb2991297691669a | 否 | 否 | 0 | 依赖/venv；Python/TS缓存；构建/Miniflare；runtime（内容用途未核）；11个折叠条目 | 需先保全忽略文件 | runtime/独有输出未核；保全前还需确认用途与归属 |
| D:/codex-isolated/release-wpb-baseline-20261012/运营管理系统 | codex/release-wpb-baseline-20261012 @ b3c6018cca6c2b2b5c8fa6c5b52e376f3a84f354 | 否 | 是 | 0 | 未检出（Git规则范围） | 使用中不可动 | 本任务尚在交付；交付后也按用户要求保留 |

建议动作计数：使用中不可动2；身份不明不可动19；需先保全提交5；需先保全忽略文件6。动作是当前优先保全/阻塞标签；“需先保全提交/忽略文件”不表示完成保全后可以立即删除，仍须解开活动、归属与绑定门槛。“使用中不可动”对本树由本任务身份确定，对主树由真实启动/任务依赖确定；其他树不从未检出CIM引用推断闲置。

### HEAD提交时间

commit时间不是最后文件活动时间；无未提交记录不表示聊天已结束。

| 路径 | HEAD committer时间 |
| --- | --- |
| D:/运营管理系统 | 2026-10-08T11:39:31+08:00 |
| D:/.codex/worktrees/0757/运营管理系统 | 2026-10-12T10:33:38+08:00 |
| D:/.codex/worktrees/161c/运营管理系统 | 2026-10-12T11:46:33+08:00 |
| D:/.codex/worktrees/195b/运营管理系统 | 2026-10-12T19:16:53+08:00 |
| D:/.codex/worktrees/1a40/运营管理系统 | 2026-10-08T14:40:55+08:00 |
| D:/.codex/worktrees/1c0f/运营管理系统 | 2026-10-06T14:29:09+08:00 |
| D:/.codex/worktrees/34b4/运营管理系统 | 2026-10-10T19:12:21+08:00 |
| D:/.codex/worktrees/4d2e/运营管理系统 | 2026-10-10T16:33:06+08:00 |
| D:/.codex/worktrees/5d78/运营管理系统 | 2026-10-07T18:15:18+08:00 |
| D:/.codex/worktrees/79d8/运营管理系统 | 2026-10-12T18:30:40+08:00 |
| D:/.codex/worktrees/81e5/运营管理系统 | 2026-10-12T10:33:38+08:00 |
| D:/.codex/worktrees/ai-agent-workflows/运营管理系统 | 2026-10-09T17:06:05+08:00 |
| D:/.codex/worktrees/ai-model-origin-fix/运营管理系统 | 2026-10-11T18:52:41+08:00 |
| D:/.codex/worktrees/ai-repairs-production-20261008/运营管理系统 | 2026-10-08T18:30:08+08:00 |
| D:/.codex/worktrees/bf14/运营管理系统 | 2026-10-08T18:25:11+08:00 |
| D:/.codex/worktrees/c198/运营管理系统 | 2026-10-12T17:42:50+08:00 |
| D:/.codex/worktrees/ccf9/运营管理系统 | 2026-10-12T17:42:50+08:00 |
| D:/.codex/worktrees/cd65/运营管理系统 | 2026-09-30T18:00:16+08:00 |
| D:/.codex/worktrees/de9b/运营管理系统 | 2026-10-11T17:36:15+08:00 |
| D:/.codex/worktrees/dfb4/运营管理系统 | 2026-10-07T18:15:18+08:00 |
| D:/.codex/worktrees/netshop-comparison-ui/运营管理系统 | 2026-09-30T17:31:55+08:00 |
| D:/.codex/worktrees/netshop-presence-jsonpath/运营管理系统 | 2026-10-03T02:29:21+08:00 |
| D:/.codex/worktrees/performance-experience-audit/运营管理系统 | 2026-10-08T22:59:45+08:00 |
| D:/.codex/worktrees/release-c-native-evidence-repair/运营管理系统 | 2026-10-11T17:08:52+08:00 |
| D:/.codex/worktrees/release-integration-review/运营管理系统 | 2026-10-11T09:36:16+08:00 |
| D:/.codex/worktrees/startup-recovery-continuation/运营管理系统 | 2026-10-12T16:00:28+08:00 |
| D:/.codex/worktrees/startup-recovery-integration/运营管理系统 | 2026-10-12T13:28:37+08:00 |
| D:/.codex/worktrees/watchdog-native-census/运营管理系统 | 2026-10-12T17:42:50+08:00 |
| D:/codex-artifacts/workflow-main-baseline-20261007 | 2026-10-07T16:29:06+08:00 |
| D:/codex-isolated/netshop-finance-subset-review/运营管理系统 | 2026-10-03T08:16:28+08:00 |
| D:/codex-isolated/netshop-temporal-review/运营管理系统 | 2026-10-01T20:37:00+08:00 |
| D:/codex-isolated/release-wpb-baseline-20261012/运营管理系统 | 2026-10-12T19:16:53+08:00 |

## 本地分支与同名远端

下表远端列是本次fetch后origin跟踪引用。请求调查分支创建时只暂时跟踪origin/main；本次推送将把上游设为同名远端。报告后新文档提交不会改变下表的历史采集事实。

| 本地分支 | 精确tip SHA | 最后提交时间 | 已含于本地main | 已含于origin/main | 同名origin引用SHA |
| --- | --- | --- | --- | --- | --- |
| codex/ai-agent-workflows-20261009 | da0d62bdd92bef118f617d0ce592a8e60682c231 | 2026-10-09T17:06:05+08:00 | 否 | 是 | 未检出 |
| codex/ai-model-origin-fix | 88ece24fb48d8e2534ee12ad6c5a476cb2be5555 | 2026-10-11T18:52:41+08:00 | 否 | 否 | 88ece24fb48d8e2534ee12ad6c5a476cb2be5555（相同） |
| codex/ai-repairs-production-20261008 | 8b121267c797d19f2c28478f6ddc79b689baa64f | 2026-10-08T18:30:08+08:00 | 否 | 否 | 8b121267c797d19f2c28478f6ddc79b689baa64f（相同） |
| codex/bi-cockpit-implementation | 859c4787886a14a0935dcbb703aea4fa6fd5fe80 | 2026-10-06T09:43:53+08:00 | 否 | 否 | e7244e5f7f4763b3cee0e6e12902763a192ee6ab（不同） |
| codex/bi-production-20261006 | d4fda88fb02d9025b917580bfe5e114331b590c2 | 2026-10-06T04:41:21+08:00 | 否 | 否 | d4fda88fb02d9025b917580bfe5e114331b590c2（相同） |
| codex/bi-production-performance-20261006 | 498b7b18b3e4da29df6b6916493330a0972dfe82 | 2026-10-06T10:46:37+08:00 | 否 | 否 | 498b7b18b3e4da29df6b6916493330a0972dfe82（相同） |
| codex/jackyun-production-20261009 | 224963800233a8b2ff06f66091217d39d204c1ea | 2026-10-09T08:45:03+08:00 | 否 | 否 | 224963800233a8b2ff06f66091217d39d204c1ea（相同） |
| codex/jd-customer-service-adoption | 994efe123b741b020c829c5b400d797c19b92aa5 | 2026-10-08T14:44:24+08:00 | 否 | 否 | 未检出 |
| codex/netshop-comparison | 6f67e4995e2b432475a2c49410f7298e25c9f467 | 2026-10-01T23:19:23+08:00 | 否 | 否 | 6f67e4995e2b432475a2c49410f7298e25c9f467（相同） |
| codex/netshop-comparison-date | 63d75fc078382d0baa0d6396aae15115346edb57 | 2026-09-30T19:33:26+08:00 | 否 | 否 | 未检出 |
| codex/netshop-comparison-public-combo | 26d076f33f5a82b7ff008128a137c7a0f7e3a68a | 2026-10-01T22:19:56+08:00 | 否 | 否 | 未检出 |
| codex/netshop-comparison-ui | 09f9982c29ab59fdc60cae556f276faa0db39d63 | 2026-09-30T17:31:55+08:00 | 否 | 否 | 未检出 |
| codex/netshop-finance-subset-review | e948335f6ff93df0f6e79d2ebceca0dd0cbeb380 | 2026-10-03T08:16:28+08:00 | 否 | 否 | 未检出 |
| codex/netshop-finance-support | 7761139ae0eb76e27cea8ee87c10a1d8ef1d3b45 | 2026-10-01T14:39:15+08:00 | 否 | 否 | 7761139ae0eb76e27cea8ee87c10a1d8ef1d3b45（相同） |
| codex/netshop-integration | 38f28d6305d3cd13e92499258573eba42e94ff7e | 2026-10-03T16:16:45+08:00 | 否 | 否 | 38f28d6305d3cd13e92499258573eba42e94ff7e（相同） |
| codex/netshop-presence-jsonpath | 0be58e2189328c74e1753a606bf8e190331d68c3 | 2026-10-03T02:29:21+08:00 | 否 | 否 | 0be58e2189328c74e1753a606bf8e190331d68c3（相同） |
| codex/netshop-promotion-demos | 43392781000f0d2a9071bc0fcd5064c65d2f1fcb | 2026-09-30T19:27:38+08:00 | 否 | 否 | 43392781000f0d2a9071bc0fcd5064c65d2f1fcb（相同） |
| codex/netshop-temporal-review | b2af337e6a1decb6dc0e74aefb2991297691669a | 2026-10-01T20:37:00+08:00 | 否 | 否 | 未检出 |
| codex/netshop-wave2-review | 76cf9484fbea1712ca3b8a76d66944d7342337e2 | 2026-10-01T14:09:57+08:00 | 否 | 否 | 未检出 |
| codex/performance-experience-audit-20261008 | ca9622ec9cb6067f698b466fefede68e0845b9f9 | 2026-10-08T22:59:45+08:00 | 否 | 是 | 未检出 |
| codex/priority-interactions-production-20261009 | 01a0ea6de9bfc1237a761f927fff068eb55d6e41 | 2026-10-09T15:51:00+08:00 | 否 | 否 | 01a0ea6de9bfc1237a761f927fff068eb55d6e41（相同） |
| codex/product-overview-worker-candidate | b767499473f36eaceff080e7d04e37be8dfc4f64 | 2026-10-05T14:39:49+08:00 | 否 | 否 | 未检出 |
| codex/release-c-native-evidence-repair | 3f5cfb7e275d67b688f18a115c5584d619dc1346 | 2026-10-11T17:08:52+08:00 | 否 | 否 | 3f5cfb7e275d67b688f18a115c5584d619dc1346（相同） |
| codex/release-final-readiness-actual-review | ba656eabbb93d17d6e2f57d51ea3d13b27d1f50d | 2026-10-11T09:36:16+08:00 | 否 | 是 | ba656eabbb93d17d6e2f57d51ea3d13b27d1f50d（相同） |
| codex/release-wpb-baseline-20261012 | b3c6018cca6c2b2b5c8fa6c5b52e376f3a84f354 | 2026-10-12T19:16:53+08:00 | 否 | 是 | 未检出 |
| codex/startup-recovery-continuation-20261012 | adedaeb2d2cf0c2999aea6a474b4c8c45ede25d0 | 2026-10-12T16:00:28+08:00 | 否 | 是 | adedaeb2d2cf0c2999aea6a474b4c8c45ede25d0（相同） |
| codex/startup-recovery-integration-20261012 | 423437cc8b5cb2da2df56733d19feea226f2979f | 2026-10-12T13:28:37+08:00 | 否 | 是 | 423437cc8b5cb2da2df56733d19feea226f2979f（相同） |
| codex/watchdog-native-census-20261012 | 18d0cae647ad92414f5e36574c2068d31ccdd147 | 2026-10-12T17:42:50+08:00 | 否 | 是 | 18d0cae647ad92414f5e36574c2068d31ccdd147（相同） |
| main | 2f55c3965e60b139381b6cc31ed868bcfe99a7bf | 2026-10-08T11:39:31+08:00 | 是 | 是 | b3c6018cca6c2b2b5c8fa6c5b52e376f3a84f354（不同） |

codex/bi-cockpit-implementation的同名远端tip不同，不能把同名存在认作完全保全；未在本次计算其双向祖先/独有提交，处置前另核。无同名远端但tip已被origin/main包含者已有主线提交保全证据，仍不替代忽略材料和使用身份检查。对未包含引用不自动合并、不恢复旧功能、不删除。

## 现有未提交内容（全部保留）

下面是采集时Git路径证据；本任务不将这些文件纳入提交。

### D:/运营管理系统

```text
 M docs/自动化/京东/jd-customer-service-workflow.md
 M tools/operations-system-control.ps1
 M tools/worker-authority-guard.mjs
 M tools/worker-local-release-rotation.mjs
 M tools/worker-local-release.mjs
 M tools/worker-local-service.ps1
?? docs/jd-customer-service-four-stores-20261008/PRODUCTION.md
?? docs/performance-review-20261008/REPORT.md
?? docs/release-pipeline-optimization-20261012/PLAN-REVISED.md
?? docs/release-pipeline-optimization-20261012/PLAN-V3.md
?? docs/release-pipeline-optimization-20261012/PLAN.md
?? tools/process-deadline.ps1
```

### D:/.codex/worktrees/ai-agent-workflows/运营管理系统

```text
 M README.md
 M app/ai-agent-workflow-view.tsx
 M app/ai-module-view.tsx
 M app/ai-report-workbench-view.tsx
 M app/ai-report-workbench.css
 M backend/ai_assistant/report_library.py
?? backend/ai_assistant/test_report_recommendations_review.py
?? backend/ai_assistant/test_workflow_presets.py
?? backend/ai_assistant/workflow_presets.py
?? docs/AI_OPERATIONS_WORKFLOWS.md
?? docs/ai-agent-workflows-20261009/INDEPENDENT_REVIEW.md
?? docs/ai-agent-workflows-20261009/RENDERED_BASELINE_REVIEW.md
?? docs/ai-agent-workflows-20261009/postgres-review.json
?? docs/ai-agent-workflows-20261009/rendered-baseline-review.json
?? lib/ai/report-workflow-period.ts
?? tests/report-workflow-period.test.ts
?? tools/verify-ai-workflow-recommendations-ui.mjs
```

### D:/.codex/worktrees/startup-recovery-continuation/运营管理系统

```text
?? docs/startup-recovery-continuation-20261012/CURRENT_RELEASE_REPORT.md
?? docs/startup-recovery-continuation-20261012/prepare-readonly-native-profile.mjs
?? docs/startup-recovery-continuation-20261012/run-readonly-native-profile.mjs
```

### D:/.codex/worktrees/startup-recovery-integration/运营管理系统

```text
?? docs/startup-recovery-integration-20261012/request-approved-recovery.mjs
?? docs/startup-recovery-integration-20261012/sample-recovery-availability-v2.mjs
```

### D:/.codex/worktrees/watchdog-native-census/运营管理系统

```text
?? docs/watchdog-native-census-20261012/request-census-closeout.mjs
```

## 已知进程与正式绑定

普通令牌CIM有 **322个CommandLine不可读进程**。采到的路径命中仅是可见命令行/映像的字符串引用，可能包括本次调查命令参数；未读取所有进程cwd、模块、全系统句柄/8.3别名或实时互斥。没有受保护进程完整元数据就不能断言已排除全部占用。

- 主树候选引用：Cursor PID55808，出生2026-10-07T19:03:25.828622+08:00；Node PID2700出生22:05:44.448452+08:00；本次调查pwsh PID19824出生22:05:47.308509+08:00。后两项不是据此确认为业务进程。
- 不可变runtime明确可见：n8n launcher PID2248/父2732，出生2026-10-07T18:34:30.246490+08:00；其PS子49664。看门狗e033 NoConsole PID51616/父2732出生22:05:24.211970+08:00，其pwsh62920。均为有限创建时间快照，不能代替健康验收。
- runtime关键词筛到128个postgres.exe项、8个Chrome项及若干外壳；这是候选子进程计数，不是128个数据库服务或完成所有权验证。其他现有worktree本次可见CIM/计划任务未命中精确路径，但普通令牌缺字段、活动聊天与历史sourceBinding未完成核验。
- 唯一正式Worker启动仍绑定release **20261011T090355Z-21c2645a63247749**，Django安装manifest为 **85cf0699925aad21f98ae682f458789236d206723b10865939915d1bcacddd09**。只读文件/shortcut不证明此刻exact进程/12组件Ready；没有调用旧Status。
- 用户Startup的TERUISI Django Sales.lnk → installed django-runtime-supervisor.ps1，cwd D:/teruisi-runtime/django-sales/app；TERUISI Operations Worker.lnk → 21c/tools/worker-local-service.ps1，cwd该不可变release。
- 桌面与Start Menu的“运营管理系统”快捷方式各指本机TERUISI/Launcher可执行文件，其中桌面为Codex包LocalCache下Launcher，开始菜单为用户LocalAppData Launcher；Launcher仍可能委托主检出总控。未运行或修改快捷方式。HKCU/HKLM Run指定TERUISI/项目关键词未检出命中，不能代表所有启动机制。
- 原automation e配置只读仍PAUSED、上海22:30；不恢复/修改调度。它不是Windows任务同名结果，也不能证明最新自然备份成功。

本次任务筛选所得正式/相关Task Action（只列路径，不保存完整argv、用户SID或凭据）：

| 计划任务 | 快照状态 | 可见执行/工作目录/脚本绑定 |
| --- | --- | --- |
| \TERUISI Operations Watchdog | Running | D:\teruisi-runtime\operations-watchdog\versions\e0330d7aea1e17395cf56214c8c62e8d54c2e46359d30cce9296800c8802760c\Watchdog.NoConsole.exe；cwd=D:\teruisi-runtime\operations-watchdog；D:\teruisi-runtime\operations-watchdog\versions\e0330d7aea1e17395cf56214c8c62e8d54c2e46359d30cce9296800c8802760c\operations-system-watchdog.ps1 |
| \TERUISI Target Progress Preview | Ready | powershell.exe；cwd未设置 |
| \TERUISI-JD-Resume-20260831 | Ready | powershell.exe；cwd=D:\运营管理系统；D:\运营管理系统\.runtime\n8n\resume-jd-workflow-20260831.ps1 |
| \TERUISI-n8n-Service | Running | D:\teruisi-runtime\n8n-launcher\da6896ea50aa85806d6c0632f672b9582917cdfec23f88729ed1acacc93606ba\Teruisi.N8n.NoConsole.exe；cwd=D:\运营管理系统；D:\teruisi-runtime\n8n-service\20260911-daf263377b07\Start.ps1 |

TERUISI Target Progress Preview未提取到引号内脚本，不等于没有目标；本次未保存其完整参数，后续处置须精确复核。n8n及JD任务cwd/脚本明确绑定主检出，所以main不能按闲置源码目录处置。计划状态Running/Ready不等于业务健康。

### main对齐还有发布保护阻塞

本次只读发现主树文件字节与base不同：

| 保护入口 | 主树当前SHA-256 | baseSha源码SHA-256 |
| --- | --- | --- |
| tools/operations-system-control.ps1 | 0e87b26637e4aac807580432025d6291bcf87ac26752eef96b784e420ac7a810 | b7acd2bc6c9c92dc80eb9f4730fd8037ba83df6b3bc951769f9d368d15252b6d |
| tools/worker-local-service.ps1 | 717408ad7b7880617967b5e230ea110c15c58b887532d02bef8eb42236f7bc1e | ca155b4cae5f1952a1da6addb6ad5e2d3ba8290b31ab9bee24b70aef1cb6040e |

e033的driver-binding.json恰绑定主树control0e87、worker717和transport5ae、installed Django953/supervisor85d2。由此**快进覆盖主树保护入口可能导致安全wrapper拒绝漂移或改变真实启动入口**；这不是普通“把Git落后归零”操作。当前主树改动可能包含正式保护字节，不替用户stash/提交/抹掉，不以最新main字节直接替换。

## 将来对齐origin/main的待执行命令（本任务不执行）

前提须全部成立：

1. 重采main/origin-main关系及所有tracked/untracked用户内容；明确由用户或后续授权任务决定保全位置/提交范围，完成可恢复保全并核验。不得自动stash、reset、clean或删除untracked。
2. 核正在运行服务、n8n/计划任务/快捷方式、受保护guard和只读wrapper绑定；原已安装入口必须按精确发布合同协调，不能为Git快进先覆盖。如需变更实际运行入口，另形成对应授权的候选/验证/恢复方案。
3. 原main处于可对齐的干净状态，保护入口写入不会破坏当前运行/诊断；重采origin最新提交仍允许ff-only且未与其他任务冲突。不长期冻结其他任务。
4. 本任务分支只按两报告交付，不把其推送当作上述前提已满足。

以下只是在满足上述前提后的命令提案；fetch/status/diff虽只读，merge会写主树，目前**未执行**：

~~~powershell
git -C "D:\运营管理系统" fetch origin
git -C "D:\运营管理系统" status --porcelain=v1 --untracked-files=all
git -C "D:\运营管理系统" branch --show-current
git -C "D:\运营管理系统" rev-list --left-right --count main...origin/main
git -C "D:\运营管理系统" diff --name-status main..origin/main
# 确认当前分支仍是main、用户内容已保全且树干净、运行保护绑定已协调后：
git -C "D:\运营管理系统" merge --ff-only origin/main
git -C "D:\运营管理系统" status --porcelain=v1 --untracked-files=all
git -C "D:\运营管理系统" rev-parse main origin/main
~~~

merge失败就停止保留证据，不回退为reset/强推；如果保护绑定尚未协调，保持当前main并让开发在独立树继续。远端main已刷新不要求主检出立刻移动，WP-0G不是WP-1/5调查前置。

## 方法、验证与下游读取

采集仅git status/worktree/for-each-ref/show/merge-base、Get-CimInstance Win32_Process、Get-ScheduledTask、快捷方式COM属性、Run键及指定文件/hash读取。未使用Handle扫描工具，未执行被调查脚本；没有服务或下载/凭据内容复制。未治理或移除任何现有树，也没有主树分支切换。

交付仅检查两报告Markdown本地链接、源码/命令位置和git diff --check/base差异，聚焦提交并推送本分支；不测试、不构建、不合并main。本树保留；受管树未来只能经应用归档，普通树也需重新证明不受管理/无锁/无依赖及材料保全。

~~~powershell
git -C "D:\运营管理系统" fetch origin
git -C "D:\运营管理系统" show origin/codex/release-wpb-baseline-20261012:docs/release-pipeline-optimization-20261012/WP0-INVENTORY.md
git -C "D:\运营管理系统" show origin/codex/release-wpb-baseline-20261012:docs/release-pipeline-optimization-20261012/WPB-BASELINE.md
~~~
