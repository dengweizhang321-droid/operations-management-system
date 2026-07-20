---
name: jdsz-product-detail-sku-daily
description: Download and verify JD Business Intelligence product-detail SKU daily data from jdsz.jd.com. Use when asked to fetch an operations-system missing date range, select SKU and a custom date interval, create or reuse a JD download-center task, prevent duplicate downloads, save the workbook to D:\谷歌浏览器, diagnose slow or stuck JD SKU downloads, or verify the downloaded XLSX date coverage.
---

# 京东商智商品明细 SKU 日数据

## 使用入口

优先运行仓库内的确定性程序，不要重新手写浏览器步骤：

```powershell
npm run jdsz:product-detail-export -- --start-date YYYY-MM-DD --end-date YYYY-MM-DD
```

脚本位置：`tools/jdsz-product-detail-export.ts`。

需要理解事故背景、耗时或人工排障时，阅读 [`docs/京东商智商品明细SKU日数据下载.md`](../../../docs/京东商智商品明细SKU日数据下载.md)。

## 执行流程

1. 先按 `docs/OPERATIONS_DATA_QUERY.md` 确定运营管理系统本月缺失的准确日区间。
2. 显式传入 `--start-date` 和 `--end-date`；只有确认需要整月时才使用默认范围。
3. 让程序先复用最近一小时的本地同区间完整文件。
4. 本地没有文件时，只接管本程序为该 SKU 区间保存了 manifest 指纹的任务；任务标题不含 SKU/SPU，禁止凭最近同名行猜维度。
5. 没有 manifest 时，先保存同名任务基线，再创建一个新任务，并把唯一新增行的任务 ID 或“标题 + 创建时间”指纹持久化。
6. 下载完成后验证文件非空、无 `.crdownload`、日期覆盖完整。

## 创建任务前硬门禁

按以下顺序检查，任一项失败立即停止并保存截图：

1. SKU 标签唯一且 `aria-selected=true`。
2. SKU 切换后的数据加载已经结束。
3. 点击起始日后，单元格出现 `jmt-date-picker-calendar-cell-start`。
4. 点击结束日后，单元格出现 `jmt-date-picker-calendar-cell-end`。
5. 页面“当前”日期回显与目标起止日期完全匹配。
6. 当前弹窗唯一，且包含“下载类型”“分天下载”“不包含对比时间”。
7. 两个单选框的真实 `checked` 状态均正确。

不要把 click 调用成功当成页面状态成功。京东页面存在 SKU 重绘、日历打开动画和日期点击被吞的竞态。

## 下载中心硬门禁

只处理文件名匹配店铺、下载类型和目标日期区间的唯一一行；多行同名时停止，不按“最新”猜测。必须同时确认：

- 任务指纹与当前 SKU manifest 完全一致，或任务由本轮明确创建并刚写入 manifest。
- 状态包含 `已生成`，不能只看见“下载”文字。
- 下载按钮唯一、可见且可用。

“生成中”行也可能显示“下载”文字。禁止提前点击，禁止改点较旧同名任务。

## 文件落盘与重试

以 `D:\谷歌浏览器` 的文件系统状态作为最终事实来源：

- 匹配 `.xlsx` 出现且大小连续稳定时成功。
- 匹配 `.crdownload` 存在时继续等待，不得再次点击。
- 初始等待最多 120 秒；有临时文件时额外等待最多 300 秒。
- 只有完整文件和临时文件都不存在时，最多重试一次下载点击。
- 不得因浏览器事件、控制桥或页面响应超时直接重复点击。
- 复用或下载完成后必须读取工作簿表头，第二列严格为 `SKU`；不得只依赖文件名。

## 浏览器选择

当前程序使用持久化专用 Chrome 配置，以复用京东登录状态和固定 D 盘下载目录。不要改用内置浏览器执行日常任务，除非用户明确要求并接受独立登录状态与下载路径差异。

当前可见 Chrome 可能抢占桌面焦点。把“后台无窗口”作为待验证改造，不要提前声称已经实现：

1. 优先在原标签页直接导航到固定下载中心，避免“前往查看”弹出新标签页。
2. 验证 `headless=new` 能复用登录并下载后，再将其设为日常默认。
3. 登录失效时退出后台任务，要求用户在显式可见登录模式中登录。

## 成功报告

报告以下信息：

- 数据起止日期。
- 文件绝对路径和大小。
- 是否复用了本地文件或下载中心任务。
- 实际下载点击次数。
- 工作表数量、行列数和日期覆盖。
- 总耗时，并区分页面操作、京东后台生成和文件下载时间。

没有验证工作簿时，不要声称日期完整；没有实际导入时，不要声称数据已经写入运营管理系统。
