# W6b 数据导出与根因证据独立反审

2026-11-08，Asia/Shanghai。按本次用户逐小任务要求请求 Astra High；工具没有独立回传实际底层型号，故仅记录请求选型。审查者未参与实现，未改被审源码、生产、Git 或 main，未外发、未转派。

**结论：本子包冻结源码及已测范围通过，未发现需返修的阻断。W6 整体尚未完成。** 两来源真实 rootless 容器 DataFrame/结果、独立 Broker 内层诊断与受控轮换仍待各自补证；本结论不代表历史两次失败根因已查明、整链验证通过、可直接上线或任何合并/发布授权。

## 冻结对象与直接依赖

- 审查基线 `ec71bd21c3111769b003f537472abf00992cdb98`；当前本包源码提交 `6eee6e6a`。以 [W6B-FREEZE.json](D:/codex-artifacts/ai-repair-batch2-20261108/w6b/W6B-FREEZE.json) 中 9 个源码/测试文件和 `W6B.md` 的原始字节为准，不包含在途 W5/W8/W9。
- 冻结清单 SHA-256 `95ec4f0458f1cbd0bc8442dbdfa6d1d224e9ead205e0276913ca58b15a9c0d37`；[完整补丁](D:/codex-artifacts/ai-repair-batch2-20261108/w6b/W6B-source.patch) SHA-256 `439ad299f06fcf1878c7cbac24aeb945f2a2d9f5b02941953f8f694ed9533181`。独立核验 10 文件及 6 份冻结证据全部匹配。
- W6a `7caf36f0` 完整依赖作为 `73f3b866`；W3 `79ac59cd` 仅 transport pre-send 依赖作为 `ec71bd21`。第一批未合 main，不将这两项记为已批准主线来源。
- 已读共享记忆入口及适用记忆、完整根 AGENTS、当前模型映射/独审条款、开发、安全 AI、架构、业务口径和验证交付规范；这些规范相对本机 main 无差异。对照原 PLAN/REVIEW/EVIDENCE 的 W6、第一批 HANDOFF、PANDAS-ADOPTION-PLAN、REVIEW-W6A。审查实际差异、调用方及领域 reader，未仅采信执行摘要。

## 源码核对

1. **权限和入口。** `datasets.query` 每页重新获取中央目录、水位和 policy digest；保留原 fixed selector 与公开 schema 字段限制。内部 `pandasProductPage` 仅在 HMAC 签名 edge 的指定工具、`ai_chat`/`dingtalk_chat` surface 可用，沿中央执行器的角色/scope、参数、限时、结果上限及审计。变体继承原条目并排除 viewer；普通发现和普通调用无 page/token 扩权，Pi 专用入口未被替换。网店 adapter 拒绝无法映射的渠道/仓库 scope，平台与店铺共同限定原 reader 查询。原 transport 与派发前/结果后的当前权限校验仍保留。
2. **分页与来源。** `product_performance` 按成交额、访客、商品键、平台、店铺形成完整稳定排序；行身份为平台＋单店＋SPU，跨店同 SPU 不误去重。第一页取 `full`，后续取 `page`；原 `_consistent_read` 校验查询前后 revision，snapshot 绑定筛选、维度、平台/店铺和 scope revisions。Worker 核 reader header 与正文 revision，Django 再核逐页 revision/token、页码、页大小、总数、返回数、结束标记及重复身份。版本改变、缺页、截断、重复和超额均抑制整份导出。snapshot 不进入 DataFrame 或最终来源摘要。
3. **范围与预算。** 普通工具仍为单页最多 20 行/24,000 字符；内部也继承这一单页上限。8 秒导出、20 页、总 2,000 行/2 MiB 没有提高。商品日受 20×20 限制至多 400 行，并提前拒绝必超页数/剩余行数的总量；每页投影后继续核总字节。`complete` 仅表示所选查询集合已导完，不证明业务日期覆盖、字段可用性或跨域原子快照。
4. **销售品类。** 原 owning reader 明确只取排名前 8 品类，另有 3,000 趋势行上限；旧 `trend.truncated` 不覆盖前者。新增逻辑以 `totalMatched`、`categoryLimit`、实际独立品类数、returned、重复 category/period 和趋势自己的截断证明 `trend.items`。完整详情 `items` 使用自己的总数、返回数和截断，并允许投影已授权标量字段。筛选选项截断、详情分页截断与趋势完整性没有混为同一标记。未扩大普通 sales schema 或响应上限。
5. **隔离与诊断。** Worker/Django 未执行 Python；签名传输、被动结果验证、原容器/清理/unknown 行为保持。来源版本错误使用固定诊断码，无新增数据正文或 token 日志。

## 历史根因与 Broker 保全

独立核验四份历史原件 SHA，并从 `pandas-audit-corrected.json` 原行重建事件顺序：商品日 19:24:18 started、19:24:19 failed；销售品类 19:29:10 started、19:29:11 failed；19:29:17 才出现额度拒绝。商品日原诊断限定窗口的 retainedMatchingNonceCount 为 0，不能由此细分为配置、导出、发送或登记前的哪一阶段。没有重放旧调用。

当前 [W6B.md](W6B.md) 将两个原失败的实际内层原因保留未知，把独立复现的分页/趋势完整性缺口分别陈述，未倒因为额度，也未声称两来源共同根因。

独立核验归档 manifest 的 15 个源码原件；阅读从精确基线与原补丁重建 8 改动 blob 的脚本和证明。当前实际 8 个 Broker 非测试 Python 文件复算为 `3173042892d14e6edcf8465b8ea97e878f307e08fdb1c81d2752f82e03dcc610`。归档完整候选为 `5bfb727f33095c0d3e4f9b63644fc0dda8c2b69293a38ea25acf49ca5d3913c5`，没有恢复进运行源码。本包不要求放松摘要门禁或现在采用 Broker 候选；专用轮换另包审查。

## 验证与剩余边界

| 证据 | 本轮结论与限制 |
| --- | --- |
| 执行者 Django 原件 | 38 项：36 通过，2 项既有真实 PG/Broker 集成跳过；已核测试源码和冻结日志，不写成 38 全通过 |
| 执行者 Worker 原件 | 10/10；签名 edge 使用合成 reader/审计响应，无真实业务或模型请求 |
| 独立 Django 复跑 | [20/20](D:/codex-artifacts/ai-repair-batch2-20261108/w6b/review-django-tests.txt)：PandasExportTests 与实际 owning ORM 稳定并列分页/范围/scope token 失效；独立 SQLite 内存测试库，没有连接 PG/生产 |
| 独立 Worker 复跑 | [4/4](D:/codex-artifacts/ai-repair-batch2-20261108/w6b/review-worker-tests.txt)：pandas 工具/审计/签名内部翻页；未重复其他未变 edge 测试 |
| 类型与语法 | 冻结证据记载语法/diff 检查通过；全仓类型命令 exit 2，owned 文件没有类型错误，未将全仓红项写为通过或扩修 |
| 真实容器 | 两来源各自 DataFrame/结果尚未验证；已有真实 HTTP/HMAC 配合 Docker 替身不等于真实 rootless 执行 |

后续只将新的真实容器原件、精确源码/镜像绑定及对应结果交回本审查上下文做增量复核。若补证触发源码修改，重新冻结改动及直接影响；未变源码不需要整包重审。W6 整体完成判定还须遵守原计划的“各来源得到结果或明确新阻断”，不能用本窄包通过替代。

机器回执：[W6B-REVIEW.json](D:/codex-artifacts/ai-repair-batch2-20261108/w6b/W6B-REVIEW.json)。长期项目状态由根负责人统一回写共享记忆，避免子代理并发改同一项目笔记。
