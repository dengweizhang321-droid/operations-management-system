"""Finance/netshop-only private PostgreSQL tests, never a runtime fallback."""
from teruisi_backend.settings import *  # noqa: F403

INSTALLED_APPS = [
    "django.contrib.contenttypes", "access_control.apps.AccessControlConfig",
    "sales.apps.SalesConfig", "finance.apps.FinanceConfig", "netshop.apps.NetshopConfig",
]
ROOT_URLCONF = "netshop_finance_test_settings"
urlpatterns = []
