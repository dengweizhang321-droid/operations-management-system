"""Only BI owning domains in a private fixture; production settings unchanged."""
from teruisi_backend.settings import *
INSTALLED_APPS = ["django.contrib.contenttypes", "sales.apps.SalesConfig", "access_control.apps.AccessControlConfig", "inventory.apps.InventoryConfig", "finance.apps.FinanceConfig", "netshop.apps.NetshopConfig", "workflow.apps.WorkflowConfig", "bi.apps.BiConfig", "erp_reference.apps.ErpReferenceConfig"]
ROOT_URLCONF = "bi_cockpit_test_urls"
