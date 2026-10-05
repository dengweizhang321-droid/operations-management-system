from teruisi_backend.settings import *  # noqa: F403

INSTALLED_APPS = [
    "django.contrib.contenttypes", "access_control.apps.AccessControlConfig",
    "sales.apps.SalesConfig", "products.apps.ProductsConfig",
]
ROOT_URLCONF = "product_overview_test_urls"
