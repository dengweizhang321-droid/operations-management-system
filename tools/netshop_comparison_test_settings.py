"""C-owned synthetic PostgreSQL settings; no production environment fallback."""
from teruisi_backend.settings import *  # noqa: F403

INSTALLED_APPS = ["django.contrib.contenttypes", "access_control.apps.AccessControlConfig", "sales.apps.SalesConfig", "netshop.apps.NetshopConfig"]
ROOT_URLCONF = "netshop_comparison_test_settings"
urlpatterns = []
