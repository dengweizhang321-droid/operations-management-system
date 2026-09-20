# 京东店铺商品 SKU 下载与自动导入

## 适用范围

用于从京东商家后台导出“售卖中”商品 SKU，并自动导入运营管理系统的网店分析数据。

- 京东页面：[商品列表](https://wares-jdm.jd.com/ware/wareList?activeTab=OnsaleWare&businessModel=0)
- 导出入口：`商品 → 导出查询商品 → SKU 导出 → 确定导出 → 导出记录 → 下载`
- 运营管理系统导入来源：`京东商品主数据`
- 店铺名称：`志高商用设备旗舰店`

## 自动执行

在项目根目录 `D:\运营管理系统` 执行：

```powershell
npm run jackyun:ware-export
```

程序会依次完成：

1. 打开京东商品列表；
2. 创建 SKU 导出任务；
3. 等待任务完成；
4. 下载对应任务的 Excel 文件；
5. 自动导入运营管理系统；
6. 输出导入批次号、行数和审计文件路径。

## 常用参数

```powershell
# 等待时间，单位为秒；默认 300 秒
npm run jackyun:ware-export -- --task-timeout-seconds 600

# 接管唯一待处理任务，或在没有待处理任务时复用最近一次已完成任务
npm run jackyun:ware-export -- --reuse-latest

# 只下载，不自动导入运营管理系统
npm run jackyun:ware-export -- --no-auto-import

# 指定运营管理系统地址
npm run jackyun:ware-export -- --base-url http://localhost:3000

# 开启页面调试截图
npm run jackyun:ware-export -- --debug
```

## 文件位置

下载文件默认保存到：

```text
outputs/jd-ware-export/downloads/
```

运行审计结果默认保存到：

```text
outputs/jd-ware-export/run-<时间戳>.json
```

## 导入字段

自动导入使用以下固定信息：

```text
source       = jd_product_master
platform     = 京东
shop_name    = 志高商用设备旗舰店
snapshotDate = 当前上海时间日期
```

运营管理系统会按文件哈希识别重复文件，重复导入时不会重复写入商品数据。

## 异常处理

### 等待超时

超时后不要直接以默认命令再次创建任务。先使用下列命令：脚本会按任务 ID 接管唯一待处理任务；若存在多个待处理任务会停止并列出 ID，不会新建任务。

```powershell
npm run jackyun:ware-export -- --task-timeout-seconds 600
```

如果没有待处理任务且京东页面已经显示任务完成，可使用：

```powershell
npm run jackyun:ware-export -- --reuse-latest
```

### 登录失效

先在专用 Chrome 窗口登录京东商家后台，再重新执行命令。

### 暂停自动导入

使用 `--no-auto-import`，程序仍会保存下载文件，之后可以在运营管理系统的“数据导入”页面手动导入。

## 当前脚本

[tools/jackyun-ware-export.ts](../tools/jackyun-ware-export.ts)
