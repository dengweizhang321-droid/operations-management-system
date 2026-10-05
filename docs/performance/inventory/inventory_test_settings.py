from teruisi_backend.settings import *  # noqa: F403

INSTALLED_APPS = ["django.contrib.contenttypes", "access_control.apps.AccessControlConfig",
                  "sales.apps.SalesConfig", "products.apps.ProductsConfig", "erp_reference.apps.ErpReferenceConfig",
                  "inventory.apps.InventoryConfig", "bi.apps.BiConfig"]
ROOT_URLCONF = "inventory_test_urls"
