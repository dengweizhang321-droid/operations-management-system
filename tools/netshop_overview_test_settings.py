"""Domain-only synthetic test settings; not imported by any runtime entry."""
from teruisi_backend.settings import *  # noqa: F403

INSTALLED_APPS = ["django.contrib.contenttypes", "access_control.apps.AccessControlConfig", "sales.apps.SalesConfig", "netshop.apps.NetshopConfig"]
ROOT_URLCONF = "netshop_overview_test_urls"
