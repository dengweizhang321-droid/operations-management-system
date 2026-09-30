"""Product-owned synthetic PostgreSQL settings, never a runtime fallback."""
from teruisi_backend.settings import *  # noqa: F403

INSTALLED_APPS = [
    "django.contrib.contenttypes", "access_control.apps.AccessControlConfig",
    "sales.apps.SalesConfig", "netshop.apps.NetshopConfig",
]
ROOT_URLCONF = "netshop_products_test_settings"
urlpatterns = []
