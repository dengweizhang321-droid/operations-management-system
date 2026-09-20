# ERP 销售明细自动导入

这是独立的新流程，不调用原有 `jackyun-*` 脚本、旧状态机或旧下载 runner。

## 一次性登录

首次使用时运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\运营管理系统\tools\erp-sales-automation.ps1" --login
```

脚本会打开独立 Chrome。完成吉客云登录、确认进入首页后，关闭该 Chrome 窗口即可保存登录状态。

## 正式运行

确保运营管理系统 `http://localhost:3000` 已启动，然后运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\运营管理系统\tools\erp-sales-automation.ps1"
```

流程会依次执行：

1. 非周一至周五时自动跳过。
2. 打开吉客云并在顶部搜索框搜索“销售单明细账”。
3. 设置截止日期所属月份 1 日 00:00:00 至昨天 23:59:59；每月 1 日运行时自动取上个完整自然月。
4. 点击“筛选”，等待查询结果稳定。
5. 右键第一条数据，选择“导出 → 导出所有页”。
6. 校验下载 Excel 的格式、必要列和行数。
7. 通过 `/api/imports/sales/chunks` 上传原始 Excel。接口会应用店铺白名单、剔除刷刷仓，并对成本为 0 的记录使用系统成本清洗。

下载文件和 `audit.json` 保存于 `outputs\erp-sales-automation\<运行编号>\`。

## 调试参数

```powershell
# 只下载和校验，不调用系统接口（默认使用可见 Chrome）
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\运营管理系统\tools\erp-sales-automation.ps1" --dry-run

# 周末人工补跑
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\运营管理系统\tools\erp-sales-automation.ps1" --force-weekend

# 指定历史截止日期
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\运营管理系统\tools\erp-sales-automation.ps1" --as-of 2026-07-16
```

工作日定时任务需要另外指定每天的执行时间；定时任务只需调用正式运行命令。
