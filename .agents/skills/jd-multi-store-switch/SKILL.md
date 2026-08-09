---
name: jd-multi-store-switch
description: 管理京东多店铺账号的安全切换、独立浏览器会话和串行数据导出。用户要求配置店铺注册表、首次登录、按店铺顺序运行 SKU/SPU 导出或排查跨店铺串号时使用。
---

# 京东多店铺切换

## 核心规则

- 只读取 `config/jd-store-accounts.json` 中的非敏感配置：`storeKey`、店铺名、shopId、profileDir、debugPort、downloadDir。
- 严禁把密码、验证码、Cookie、Token 写入 Skill、Markdown、JSON、日志或 Git。
- 每个店铺使用独立 Chrome profile、CDP 端口和下载目录；禁止多个店铺共享 profile 或下载目录。
- 一次只运行一个店铺。当前店铺完成后才切换下一店铺；失败立即停止并保留审计现场。
- 日常 runner 默认 `headless=new`。登录失效、验证码、安全验证或店铺登录身份异常时才打开当前店铺可见 Chrome；打开后任务仍失败关闭，不自动重放业务点击。

## 首次准备

1. 检查注册表键、shopId、端口、解析后的 profileDir 和 downloadDir 全部唯一，平台字段为京东，并确认所有路径可写。
2. 对每个店铺单独启动脚本，使用对应 profile 完成人工登录和验证码验证。
3. 确认页面显示的店铺与注册表 `shopName` 一致；不一致时停止，不得继续导出。

人工首次登录时显式增加 `--interactive-login`；定时任务不传该参数。

## 执行命令

单店 SKU：

```powershell
npm run jackyun:ware-export -- --store-key jd-yiyong-director
```

单店商智 SKU/SPU：

```powershell
npm run jdsz:product-detail-export -- --store-key jd-chudian-weizhang --dimension SKU --start-date 2026-07-01 --end-date 2026-07-19
```

全部启用店铺串行运行：

```powershell
npm run jd:all-stores -- --mode all --start-date 2026-07-01 --end-date 2026-07-19
```

单独日数据使用 `--mode sku-daily` 或 `--mode spu-daily`；失败后用 `--store-key <注册表键>` 只重跑失败店铺。执行器以单个 run audit 持久化 planned/running/completed/failed 和错误 stderr 摘要；不要使用 `Promise.all` 并行启动店铺任务。

## 故障处理

- 登录提示、店铺名不匹配、任务数量歧义、下载未验证或导入失败：立即停止当前流程。
- 不要通过重复点击、刷新后盲选最新任务或自动填充密码来“恢复”。先检查对应 storeKey 的 profile、端口、审计 JSON 和下载目录。
- 修复后只重跑失败店铺；确认结果后再继续后续店铺。
- 若需要审查刚运行遇到的坑、修复程序或验证跨店数据隔离，改用 `jd-multi-store-pipeline-review` Skill，并先读 `docs/京东多店铺统一下载与导入-审查修复与稳定性手册.md`。

## 相关文件

- 注册表：`config/jd-store-accounts.json`
- 注册表加载：`lib/jd/store-registry.ts`
- 串行执行器：`tools/jd-multi-store-runner.ts`
- 店铺 SKU：`tools/jackyun-ware-export.ts`
- 商智日明细：`tools/jdsz-product-detail-export.ts`
