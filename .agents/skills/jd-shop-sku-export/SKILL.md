---
name: jd-shop-sku-export
description: 自动执行京东商家后台商品 SKU 导出、下载和运营管理系统导入。用户要求下载京东店铺 SKU、运行京东店铺 SKU 导出智能体、把导出的 Excel 同步到运营管理系统，或排查导出任务等待、下载和导入问题时使用。
---

# 京东店铺 SKU 导出

## 核心流程

1. 确认专用 Chrome 已登录京东商家后台，运营管理系统已启动。
2. 在项目根目录 `D:\运营管理系统` 执行 `npm run jackyun:ware-export`。
3. 让脚本打开商品列表并进入“导出查询商品 → SKU 导出”。
4. 等待导出任务状态变为“已完成”，核对“成功：N”条。
5. 只下载当前任务对应的文件，保存到 `outputs/jd-ware-export/downloads/`。
6. 下载验证成功后，将文件通过 `/api/netshop/import` 自动导入运营管理系统。
7. 在运行审计 JSON 中记录任务 ID、下载路径、导入批次、行数和状态。

## 运行命令

```powershell
# 创建新导出任务并自动下载、导入
npm run jackyun:ware-export

# 复用最近一条已完成任务
npm run jackyun:ware-export -- --reuse-latest

# 京东任务较慢时延长等待时间（秒）
npm run jackyun:ware-export -- --task-timeout-seconds 600

# 只下载，不自动导入
npm run jackyun:ware-export -- --no-auto-import
```

默认等待时间为 300 秒。只有在页面明确显示任务已完成且下载记录可定位时才继续下载；不能因超时或多个未知任务而随意点击下载。

## 导入约定

调用本地运营管理系统：

```text
POST http://localhost:3000/api/netshop/import
```

表单字段：`source=jd_product_master`、`platform=京东`、`shop_name=志高商用设备旗舰店`、当天上海时区 `snapshot_date`，以及字段名为 `file` 的 `.xlsx` 文件。

导入返回 `imported` 表示新文件已写入；返回 `duplicate` 表示系统按文件哈希去重，不应重复处理。

## 安全与故障处理

- 未登录时停止并要求用户在专用 Chrome 中登录，不要尝试绕过登录。
- 导出任务超时后直接重新运行同一命令：脚本会从 `active-task.json` 按 taskId 接管原任务；即使它已从 pending 变为 completed，也不会再次点击“确定导出”。若上次在取得 ID 前中断，则只接受相对持久化 baseline 的唯一新增任务；缺失或歧义时安全停止。
- 下载事件未验证时不自动导入未知文件，也不要重复点击下载按钮。
- 运营管理系统不可用时保留本地 `.xlsx`；失败审计必须记录任务 ID、文件路径、API 地址、`stage=auto_import` 和错误，并保持非零退出，不声称导入成功。
- 若存在多个新任务，停止自动下载，要求人工确认目标任务 ID。

## 相关文件

- 自动化脚本：`tools/jackyun-ware-export.ts`
- 可复制操作手册：`docs/京东店铺SKU下载和导出智能体.md`
- 下载目录：`outputs/jd-ware-export/downloads/`
- 审计目录：`outputs/jd-ware-export/`
