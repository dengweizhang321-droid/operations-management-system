# 京准通志高切肉机 AI 推广数据 n8n 工作流

## 固定范围

- n8n ID：`JdPromotionCutMeat2026`
- 模板：`automation/n8n/jd-promotion-cut-meat-20260813-14.workflow.json`
- 店铺键：`jd-maidehao-operator1`
- 页面账号标签：志高迈德豪-运营1
- 店铺：志高切肉机旗舰店
- shopId：745866
- Chromium：Profile 2，调试端口 9226，店铺独立下载目录
- 手动入口当前日期：2026-08-20
- 定时入口：每天 11:30（`Asia/Shanghai`），只处理昨天

仓库模板默认 `active=false`，实际发布状态以本机 n8n 为准。它不会与设备旗舰店工作流共享 profile、下载目录、恢复清单或下载任务，但仍与全部京东自动化共用一个全局 Chromium 所有权锁，因此不能并发运行。定时和手动入口都先使用 `workflow key=jd-promotion + n8n execution ID` 原子领取共享 helper；未获授权时每 5 分钟等待，累计 72 次后失败关闭。

## A → B → C

1. A 节点调用独立的 `/jd-promotion-cut-meat/plan` 门禁，并通过 `X-TERUISI-JD-PROMOTION-STORE-KEY=jd-maidehao-operator1` 显式绑定切肉机店铺，同时固化起止日期和 n8n execution ID。定时入口使用上海时区昨天，手动入口使用“固定补跑日期”节点；旧版 helper 不认识该入口时会直接返回 404，避免在服务尚未更新时误用设备旗舰店。
2. B 节点使用 Profile 2 打开京准通自定义报表列表，在当前账号内按名称唯一选择“AI推广数据自动下载”，核验页面账号“志高迈德豪-运营1”，精确读回目标日期，建立下载中心 baseline，只生成或接管唯一精确范围任务。不得复用另一店铺的自定义报表 ID。CSV 通过 UTF-8、表头、连续日期、账户集合、行数和 SHA-256 校验后，才按志高切肉机旗舰店的 `jd_promotion/ad` 范围导入并回查。
3. C 节点重新读取保存文件并重算证据，再按精确 batch ID 回查 `completed`、零告警、店铺、日期、行数和原文件哈希。

## 使用说明

2026-08-16 的 2026-08-13 至 2026-08-14 首次真实任务只得到表头空文件，执行器按规则在导入前失败关闭，没有删除事实。2026-08-21 来源就绪后，重新下载同一区间得到 4,650 行并完成零告警导入，说明首次失败是来源当时未就绪，不是允许导入空集合的证据。

2026-08-21 已按互不重叠的小区间补齐 2026-07-01 至 2026-08-20：26 个 completed 批次、116,895 行、0 告警，逐日覆盖 51 天且当前事实每一天只有一个批次所有者。后续定时只补昨天；历史补数必须先计算缺失日，不得重复下载已覆盖整段。恢复时仍从完整 A → B → C 开始，不得只重试 B 或 C，也不得删除恢复清单后重复生成任务。

命令行等价入口：

```powershell
npm run jd:promotion -- --store-key jd-maidehao-operator1 --start-date 2026-08-20 --end-date 2026-08-20 --run-id jd-promotion-cut-meat-20260820
```

账号、密码、Cookie、Token、Session 和 profile 路径均不进入 n8n 工作流。登录失效、安全验证、任务歧义或日期缺口时保留恢复清单并失败关闭。
