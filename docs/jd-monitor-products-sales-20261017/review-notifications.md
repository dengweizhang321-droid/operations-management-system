# 商品监控与销量增量：独立审查补充验证

日期：2026-10-17。来源：只读独立 critical-review 子代理；请求模型 gpt-6.1-sol / high，工具未独立返回实际型号。

审查范围：D:/运营管理系统 的独立工作树 `D:/.codex/worktrees/jd-monitor-products-and-sales/运营管理系统`，基线 `0efb854102106b3eac85823ce7f148188f0f615f` 的本次未提交差异。仅下述合成内存验证及本证据文件写入；没有生产操作或真实消息发送。

## 结论

- 没有发现权限、CAS、跨事业部、取消后的发送排除、历史 unknown 投递防重或结构迁移的阻断缺陷。
- 发现上下两个商品矩阵按 index 生成重复详情 DOM ID（P3）。执行者改用 React `useId()` 实例前缀。增量核对代码与新增唯一性断言后，独立重跑 `node --test tests/jd-monitor-preferences-interaction.test.mjs`：4 项全部通过。
- 回读仓库中的 backend-tests.log（36 项通过）、postgres-tests.log（4 项通过及 0015→0016→0015→0016）、postgres-evidence.json（私有端口 54517，started/stopped 均 true）。0016 只有 AddField(JSONField(default=list))，保留原仓库偏好、商品排序和 revision；无业务回填。
- 未验证生产发布。新迁移不得复用旧 147/0015 发布凭据；通用入口尚不支持新迁移的边界须由交付报告明确。

## 独立追加的五项通知验证

使用已安装 Python 解释器的依赖，在导入 Django 前清除非白名单环境变量，强制 test/development 与 SQLite `:memory:`，迁移仅在进程内；gateway 全为 FakeGateway。五项均通过（5 tests / 0.267s / OK）：

1. 取消唯一风险商品后，零 target preflight、零 send。
2. 第一次 target preflight 内取消，返回 `notification_state_changed_before_claim`，零 send。
3. 最终 target preflight 内取消，返回 `notification_state_changed_before_send`，零 send。
4. 原投递已 unknown 后取消，继续返回 unknown，不重放原发送（总计只有原一次 fake send）。
5. 单独关闭仓库显示偏好时，保留既有独立通知策略（一次 fake send）。

首次使用系统 `python` 因没有 Django 在导入前退出；随后使用下列已安装解释器完成验证，未安装或修改任何依赖。

## 可复现命令

在目标 worktree 用 PowerShell 执行：

```powershell
@'
import os,sys,unittest
from pathlib import Path
allowed={"SYSTEMROOT","WINDIR","TEMP","TMP","PATH","COMSPEC","USERPROFILE","LOCALAPPDATA","APPDATA","PROGRAMFILES"}
for key in list(os.environ):
    if key.upper() not in allowed: del os.environ[key]
os.environ.update(DJANGO_SETTINGS_MODULE="teruisi_backend.settings",DJANGO_DEBUG="true",TERUISI_DJANGO_ENVIRONMENT="test",TERUISI_DJANGO_PROCESS_ROLE="development",TERUISI_DJANGO_SQLITE_PATH=":memory:",PYTHONDONTWRITEBYTECODE="1")
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path.cwd()/"backend"))
import django
django.setup()
from django.conf import settings
settings.DATABASES["default"]["NAME"]=":memory:"
from django.db import connection
assert connection.vendor=="sqlite" and connection.settings_dict["NAME"]==":memory:"
from django.db.migrations.executor import MigrationExecutor
MigrationExecutor(connection).migrate([("inventory","0016_jd_product_monitoring")])
from inventory.tests.test_jd_logistics_notifications import NotificationTests,FakeGateway,ACTOR
from inventory import jd_logistics as source
from inventory import jd_logistics_notifications as notify
from inventory.jd_logistics_models import JdLogisticsDepartment
from django.test import TestCase
class ReviewCases(TestCase):
    setUp=NotificationTests.setUp
    enabled=NotificationTests.enabled
    def cancel(self):
        row=JdLogisticsDepartment.objects.get(id="notify-dept")
        return source.mutate({"operation":"settings","departmentId":row.id,"expectedRevision":row.revision,"productMonitoring":{"goodsCode":"RISK-1","enabled":False}},ACTOR)
    def test_canceled_risk_never_reaches_gateway(self):
        self.cancel(); gateway=FakeGateway()
        with self.enabled(): result=notify.notify(self.body,ACTOR,gateway=gateway)
        self.assertEqual(result["riskCount"],0); self.assertEqual(gateway.preflights,0); self.assertEqual(gateway.sends,[])
    def test_cancel_during_initial_target_preflight_denies_claim(self):
        gateway=FakeGateway(on_preflight=lambda n:self.cancel() if n==1 else None)
        with self.enabled(): result=notify.notify(self.body,ACTOR,gateway=gateway)
        self.assertEqual(result["reason"],"notification_state_changed_before_claim"); self.assertEqual(gateway.sends,[])
    def test_cancel_during_final_target_preflight_denies_dispatch(self):
        gateway=FakeGateway(on_preflight=lambda n:self.cancel() if n==2 else None)
        with self.enabled(): result=notify.notify(self.body,ACTOR,gateway=gateway)
        self.assertEqual(result["reason"],"notification_state_changed_before_send"); self.assertEqual(gateway.sends,[])
    def test_prior_unknown_remains_unresolved_after_cancel(self):
        gateway=FakeGateway(outcome=RuntimeError("synthetic"))
        with self.enabled(): first=notify.notify(self.body,ACTOR,gateway=gateway)
        self.assertEqual(first["status"],"unknown"); self.cancel()
        with self.enabled(): second=notify.notify(self.body,ACTOR,gateway=gateway)
        self.assertEqual(second["status"],"unknown"); self.assertEqual(len(gateway.sends),1)
    def test_warehouse_display_off_keeps_active_notification_strategy(self):
        row=JdLogisticsDepartment.objects.get(id="notify-dept")
        key=source.inventory_monitor({"departmentId":row.id})["items"][0]["warehouseKey"]
        source.mutate({"operation":"settings","departmentId":row.id,"expectedRevision":row.revision,"warehousePreferences":[{"warehouseKey":key,"displayName":"","enabled":False}]},ACTOR)
        gateway=FakeGateway()
        with self.enabled(): result=notify.notify(self.body,ACTOR,gateway=gateway)
        self.assertEqual(result["status"],"sent"); self.assertEqual(len(gateway.sends),1)
result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(ReviewCases))
sys.exit(not result.wasSuccessful())
'@ | & 'D:\teruisi-runtime\django-sales\venv\Scripts\python.exe' -
```

审查没有改动项目源文件。共享记忆持久化由主执行者随任务统一收尾，避免并行写入。
