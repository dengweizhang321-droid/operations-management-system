---
name: jd-multi-store-pipeline-review
description: 对京东多店铺商品主数据、商智 SKU/SPU 分天下载与运营系统导入链路进行对抗审查、缺陷修复交接和独立复审。用户要求排查刚运行遇到的坑、提高多店铺任务速度与稳定性、核验下载是否真正导入、检查跨店隔离/恢复清单/重复任务/日期覆盖/批次幂等，或要求 Sol 审查、Terra 修复、再由 Sol 复审时使用。
---

# 京东多店铺链路审查与修复

## 先读资料

先读 `docs/京东多店铺统一下载与导入-审查修复与稳定性手册.md`。只读取与当前缺陷相关的代码和测试；不得从历史日志推断当前实现正确。

## 安全边界

- 不把账号密码、Cookie、Token、验证码写进代码、文档、注册表、审计或 Git。
- 代码审查和离线测试不得创建真实京东任务，不得调用真实导入 API。
- 未获明确授权时只执行 `--dry-run`；真实冒烟先跑一店，再决定是否扩到四店。
- 保护工作区其他改动，不重置、不覆盖、不擅自暂存或提交。

## 执行流程

1. 读取店铺注册表、三个子流程、统一 runner、导入服务、数据库约束、现有测试和运行审计。
2. 用 invalidation、race、boundary、transaction、contract 五个视角逐条寻找可达反例。
3. 每个缺陷写出文件和行号、操作序列、预期、实际、影响范围；不使用“可能”“或许”。
4. 用户要求多 Agent 时，将实现和证伪交给不同 Agent。实现者只做最小修复并补反例测试；验证者重读最终源码，主动寻找反例，不信任实现者结论。
5. 验证失败就退回实现者；只有最终验证 PASS 才进入交付。
6. 主代理最后独立执行全量单测、页面契约测试、生产构建、`git diff --check` 和单店安全 dry-run。

## 必守契约

### 店铺隔离

- `storeKey` 只允许小写字母、数字和连字符；`shopId` 只允许数字。
- 每店的 `profileDir`、`debugPort`、`downloadDir` 和活动任务清单必须唯一。
- 批次身份和商品主数据行键必须包含平台与店铺；相同文件跨店不得命中同一批次或覆盖行。
- 所有导入响应必须回查 `platform=京东` 和当前注册表项的 `shopName`。

### 任务归属与恢复

- 下载中心标题不包含 SKU/SPU 维度，禁止按“最新一行”猜任务。
- 创建前获取稳定 baseline；首帧空数组不是有效 baseline，只有明确空态连续确认后才可继续。
- 点击“确定”前即时生成并原子写入 submitting manifest；写入失败就禁止点击。
- `click()` 返回只表示浏览器事件已调用；只有下载中心出现唯一的 post-baseline 任务行，才能写“已提交/已创建”。
- 重启只接管 manifest 指纹唯一对应且创建时间邻近的任务；歧义时停止，禁止重新创建。
- SKU 与 SPU 使用独立 manifest；店铺主数据使用按 `storeKey` 隔离的活动任务清单。

### 文件与导入

- 文件必须验证维度、标识列、目标日期全集、无区间外日期；不得仅凭文件名或修改时间。
- 本地复用仅接受最近窗口内、维度和日期覆盖均通过的完整 `.xlsx`；存在 `.crdownload` 时不得重复点击。
- 子流程只有返回唯一 `@@JD_PIPELINE_RESULT@@`，且带通过验证的 `importResult`，统一 runner 才能标记完成。
- 严格匹配导入协议：`imported` 必须是 HTTP 201，`duplicate` 必须是 HTTP 200；批次必须 completed、零警告、来源/数据集/店铺/日期一致。
- 默认日期为上海时区“昨天所在月份的 1 日至昨天”，尤其覆盖每月 1 日。

## 验证命令

```powershell
node --import tsx --test tests/*.test.ts
node --test tests/rendered-html.test.mjs
npm run build
git diff --check
npm run jd:all-stores -- --dry-run --store-key <store-key> --mode all
```

dry-run 应保持步骤为 `planned`，不得出现 `completed`。不得把离线验证写成“已真实下载”或“已真实导入”。

## 交付格式

- 先给最终 verdict：PASS 或 FAIL。
- 列出确认缺陷、根因、修复文件和反例测试。
- 分开记录已证伪主张，防止下次重复审查。
- 报告测试数量、构建、diff 和 dry-run 结果。
- 明确说明是否运行真实京东任务、是否调用真实导入接口、是否暂存或提交。
