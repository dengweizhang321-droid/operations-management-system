"""Synthetic fixtures for the reviewed workflow and annual-target screens."""
from datetime import timedelta
from pathlib import Path
import os


def seed_workflow_annual(today):
    from django.conf import settings
    from django.utils import timezone
    from workflow.models import NewProductLine, NewProductLineCode, NewProductProject, NewProductStage
    from finance.models import FinanceMonth, FinanceLine, FinanceTarget
    from sales.models import ErpProductMaster
    root = Path(__file__).resolve().parents[2]
    database = Path(settings.DATABASES["default"]["NAME"]).resolve()
    if settings.DATABASES["default"]["ENGINE"] != "django.db.backends.sqlite3" or database.parent != root / ".runtime/preview" or os.getenv("TERUISI_DJANGO_DATABASE_URL"):
        raise RuntimeError("This fixture requires the worktree's synthetic preview SQLite")
    stamp = timezone.now().isoformat()
    line = NewProductLine.objects.create(name="商用设备 · 合成演示", match_terms=["商用"], monitoring_start_date=today-timedelta(days=30), created_by="preview@teruisi.local", updated_by="preview@teruisi.local")
    NewProductLineCode.objects.create(product_line=line, product_code="DEMO-001", product_name="商用电风扇", source="manual", added_by="preview@teruisi.local")
    for index, status in enumerate(("in_progress", "blocked", "completed", "not_started")):
        project = NewProductProject.objects.create(product_name=f"合成演示商品 {index+1}", supplier_name="演示供应商", owner="演示负责人", proposed_by="演示负责人", proposed_date=today-timedelta(days=10), created_by="preview@teruisi.local", updated_by="preview@teruisi.local")
        for stage in ("modeling", "pricing", "image", "video", "listing", "stocking", "review"):
            NewProductStage.objects.create(project=project, stage_key=stage, status=status if stage == "modeling" or status == "completed" else "not_started", planned_due_date=today+timedelta(days=-2 if index == 1 else 10), updated_by="preview@teruisi.local")
    year = str(today.year)
    months = sorted({f"{year}-01", f"{year}-02", (today.replace(day=1)-timedelta(days=1)).strftime("%Y-%m")})
    for month in months:
        FinanceMonth.objects.create(month=month, batch_id="preview-finance", sheet_name="合成财报", business_name="演示事业部", source_file_name="合成示例", status="completed", shop_count=2, subject_count=3, imported_at=stamp)
        for platform, name, sales, profit in (("京东", "演示店铺1", 1_000_000, 180_000), ("天猫", "演示店铺2", 800_000, 120_000)):
            for metric, amount in (("net_sales", sales), ("gross_sales", sales), ("profit", profit)):
                FinanceLine.objects.create(month=month, section="summary", metric_key=metric, subject_name=metric, scope_key=f"shop:{platform}:{name}", scope_type="shop", scope_name=name, group_name=platform, value_type="amount", amount_cents=amount, created_at=stamp)
    FinanceTarget.objects.create(id="preview-annual-target", period_type="year", period_key=year, platform="京东", shop_name="演示店铺1", manager="演示负责人", sales_target_cents=6_000_000, profit_target_cents=1_000_000, created_at=stamp, updated_at=stamp)
