# 商品榜单「市场定位价（主图）」全部 missing：主图同步到价格快照（2026-11-16）

分支 `codex/market-snapshot-image-sync-20261116`，基点 `origin/main` a7cf1e47。Opus 策划与反审，Sonnet 实现。
范围：Django `backend/market` + Worker 市场命令透传。**无迁移**。本分支只交付代码；生产数据补写在发布后另行授权执行（见末节）。

## 来源

2026-11-15 只读排查结论（对话记录）：10 月、11 月正式价格为 0。原因是 9 月起京东导出无图片列，价格快照 `market_price_snapshots.image_url` 为空 → 无图片哈希 → 标注规划跳过（`annotation_planning.py:215-217`）→ 无识别、无审核、无确认价。11-05 补图只写榜单行，11-14 页面兜底只改显示。

修复建议（用户要求按此执行）：把榜单行上的主图同步到同一商品、同一月份的价格快照（只填空值、不碰价格字段），并带上图片缓存里的哈希；之后对 10 月和 11 月重新建标注任务，能沿用历史同图确认价的直接进入待审核，其余走 AI 识别。

## 本次核实的补充约束

- 页面按「行所在月份」的快照取价（`ranking_query.py:58-66`、`query.py:296`），所以 10 月行要 10 月快照被确认。
- 标注候选只取每个 SKU 身份的**最新**榜单行（`annotations.py:1151-1157` `_candidate_rows`）。10 月出现、11 月也出现的 SKU 永远不会为 10 月建任务 → 需要按月份建任务的能力，否则建议的「10 月重建」做不到。
- `_fill_missing_images`（`images.py:519-601`）填快照 URL 但不写哈希；缓存已 ready 时不会再触发 `_complete_claim` 回填哈希（`images.py:430-440`）。
- `_repairs`（`images.py:469-516`）会清空价格，**不得复用**。
- 写入规则：命令走 `views.py:438-470`（`assert_write_authority` + 回执重放）；每次改变读结果的写入调用 `bump_revision` 并 `_audit`。

## 设计

### 1. 共享函数：快照主图补齐（只填空值）

`backend/market/images.py` 新增内部函数（如 `_fill_snapshot_images(pairs)`），输入（身份四元组, 月份, 榜单图片 URL）：
- 快照 `image_url == ""` → 写入该 URL。
- 快照 URL 与该 URL 相同且 `image_content_sha256 == ""`，且 `MarketImageCache(source_url=URL, status="ready")` 有 `content_sha256` → 写入哈希。
- 快照 URL 非空且与榜单 URL **不同** → 跳过并计数 `conflicts`，不改。
- 只更新 `image_url`、`image_content_sha256`、`updated_at`；**绝不**触碰价格、AI、确认状态、`source_job_item_id` 等字段。
- 返回 filled / hashed / conflicts / notReady URL 集合。

### 2. 新管理命令 `sync_snapshot_images_from_ranking`（admin，走 market commands 通道）

payload：`{ domain: "images", action: "sync_snapshot_images_from_ranking", months: ["2026-10", "2026-11"], dryRun: bool, limit?: int(1..5000, 默认 5000) }`。
- 月份格式严格 `YYYY-MM`，1–6 个。
- 来源：这些月份内 `image_url != ""` 的榜单行（SKU 与 SPU 维度都可，按快照身份同月一一对应；同一身份同月多行时取 `period_end` 最新、再 `id` 最大的那行的 URL，不同行 URL 冲突时该身份计入 conflicts 跳过）。只处理对应快照**需要补**的身份（URL 空或哈希空），按身份排序后取 `limit` 个，返回 `remaining` 让调用方循环。
- dryRun 不写，只返回计数与前 20 个样例。
- 非 dryRun：调用共享函数；对 notReady 的 URL 按 `_fill_missing_images` 的方式建一个种子化缓存任务（`discovery_complete=True`），缓存完成后既有 `_complete_claim` 会回填哈希；`_audit("sync_market_snapshot_images", ...)`（before 记录被改快照的 id 与原值，足以回退）；有写入时 `bump_revision`。
- 查询必须走索引、按身份分块 IN 查询，避免对 40 万行做相关子查询（生产 reader 7 秒超时教训；写命令同样要有界）。

### 3. `_fill_missing_images` 同步写哈希

填快照 URL 后，若该 URL 缓存已 ready，同时写入哈希（复用共享函数），避免「已有缓存却永远没有哈希」。

### 4. 按月份建标注任务

`_create_job` 支持可选 `month`（`YYYY-MM`）：
- 有 `month` 时候选行 = 该类目、`ranking_dimension="SKU"`、`period_end` 在该月的榜单行，每个身份只保留一行（`-period_end, rank, id` 排序后首行），排序与 `_candidate_rows` 一致；无 `month` 时行为完全不变。
- `work_key` 在有 `month` 时把月份纳入，避免与全量任务互相复用；无 `month` 时 `work_key` 字节不变（已有任务复用不受影响）。
- `build_job_items` 不改；同图历史复用（`history_same_image` → `review_pending`）自动生效。
- Worker 侧把 `month` 加入 create_job 的透传/白名单（沿 `app/api/market/...` 与 `lib/market/...` 找 create_job 的 payload 校验；注意 `exact()` 类白名单多一个键就整体 403）。
- 不加页面入口；发布后由管理员 API 调用。

### 5. 文档

`docs/使用手册/` 市场分析手册追加 2026-11-16 段：问题原因、同步命令与按月建任务的用法、只填空值不改价格、后续人工审核提交。

## 测试（Django，SQLite 隔离库）

- 共享函数/同步命令：空 URL 被填；同 URL 空哈希被填哈希；不同 URL 计 conflicts 不改；价格/确认字段前后逐字段相等；未 ready URL 建种子缓存任务且不写哈希；dryRun 零写入且 revision 不变；`limit`/`remaining` 循环；月份格式与非 admin 拒绝；幂等（第二次运行 0 写入、不 bump revision）。
- `_fill_missing_images`：缓存 ready 时快照得到哈希。
- 按月建任务：10 月与 11 月都有行的 SKU，`month=2026-10` 生成 10 月条目；无 `month` 的 work_key 与改前相同；同图已确认历史 → `review_pending`。参照 `backend/market/tests/test_ranking_columns_images.py:220-259`、`backend/market/test_annotation_planning_round2.py`。
- Worker：若改了 create_job 透传白名单，补一条单测；相关既有测试保持通过。

## 必需检查

`python backend/manage.py test market --noinput`（SQLite 隔离）里与图片、标注、命令相关的模块；Worker 相关单测；tsc 只看触及文件。

## 上线后的生产数据步骤（本分支不执行；需另行授权）

1. 全库备份并核验（`tools/postgres-consistent-backup.py` 一类既有工具）。
2. `sync_snapshot_images_from_ranking` dryRun（10 月、11 月）→ 核对数量与 11-15 排查（10 月约 4,604、11 月约 2,244 个有主图商品）一致 → 正式执行，循环到 `remaining=0`。
3. 等待种子化缓存任务完成、哈希回填。
4. 每个类目按 `month=2026-11`、`month=2026-10` 建标注任务；沿用历史同图确认价的进入待审核，其余走 AI 识别（产生模型费用）。
5. 人工审核并提交。完全没有主图的商品（10 月约 6,015、11 月约 4,814）需先走京东补图，不在本次范围。
