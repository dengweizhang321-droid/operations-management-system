# 京准通志高切肉机 AI 推广数据 n8n 工作流

## 固定范围

- n8n ID：`JdPromotionCutMeat2026`
- 模板：`automation/n8n/jd-promotion-cut-meat-20260813-14.workflow.json`
- 店铺键：`jd-maidehao-operator1`
- 页面账号标签：志高迈德豪-运营1
- 店铺：志高切肉机旗舰店
- shopId：745866
- Chromium：Profile 2，调试端口 9226，店铺独立下载目录
- 业务日期：2026-08-13 至 2026-08-14

该工作流只有手动入口，默认 `active=false`。它不会与设备旗舰店工作流共享 profile、下载目录、恢复清单或下载任务，但仍与全部京东自动化共用一个全局 Chromium 所有权锁，因此不能并发运行。

## A → B → C

1. A 节点调用独立的 `/jd-promotion-cut-meat/plan` 门禁，并通过 `X-TERUISI-JD-PROMOTION-STORE-KEY=jd-maidehao-operator1` 显式绑定切肉机店铺，同时固定起止日期和 n8n execution ID。旧版 helper 不认识该入口时会直接返回 404，避免在服务尚未更新时误用设备旗舰店；新版 helper 仍只接受推广白名单内的店铺键。
2. B 节点使用 Profile 2 打开京准通自定义报表列表，在当前账号内按名称唯一选择“AI推广数据自动下载”，核验页面账号“志高迈德豪-运营1”，设置 2026-08-13 至 2026-08-14，建立下载中心 baseline，只生成或接管唯一精确范围任务。不得复用另一店铺的自定义报表 ID。CSV 通过 UTF-8、表头、连续日期、账户集合、行数和 SHA-256 校验后，才按志高切肉机旗舰店的 `jd_promotion/ad` 范围导入并回查。
3. C 节点重新读取保存文件并重算证据，再按精确 batch ID 回查 `completed`、零告警、店铺、日期、行数和原文件哈希。

## 使用说明

2026-08-16 已完成真实流程冒烟：账号、报表、日期、任务创建和唯一下载均通过，生成任务精确绑定志高切肉机旗舰店及 2026-08-13 至 2026-08-14；下载 CSV 仅含表头、没有业务数据行，因此执行器在导入前失败关闭并保留恢复清单。该空文件为 1,188 字节，SHA-256 为 `98f3cfa4c51e79b5cab857bd72bff685d58f36147d5e25486ac5804355dcc8f5`。本机只读批次查询确认该店没有目标范围的 `jd_promotion/ad` 批次；不得把权威空集合未证明的表头空文件导入或用于删除既有事实。

后续若京准通补齐源数据，应等待来源就绪，再从该工作流的手动入口启动完整 A → B → C；不得只重试 B 或 C，也不得删除恢复清单后重复生成任务。

命令行等价入口：

```powershell
npm run jd:promotion -- --store-key jd-maidehao-operator1 --start-date 2026-08-13 --end-date 2026-08-14 --run-id jd-promotion-cut-meat-20260813-14
```

账号、密码、Cookie、Token、Session 和 profile 路径均不进入 n8n 工作流。登录失效、安全验证、任务歧义或日期缺口时保留恢复清单并失败关闭。
