from teruisi_backend.settings import *  # noqa: F403

# Only synthetic databases in the task-owned runner; never inherit production URLs.
SALES_READ_CACHE_SECONDS = 30
INSTALLED_APPS = ["django.contrib.contenttypes", "access_control.apps.AccessControlConfig",
    "sales.apps.SalesConfig", "finance.apps.FinanceConfig", "erp_reference.apps.ErpReferenceConfig",
    "products.apps.ProductsConfig", "inventory.apps.InventoryConfig", "bi.apps.BiConfig"]
ROOT_URLCONF = "sales_performance_urls"
