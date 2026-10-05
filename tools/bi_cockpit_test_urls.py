from django.urls import include, path
from teruisi_backend import health
urlpatterns = [path("api/bi/", include("bi.urls")), path("api/finance/", include("finance.urls")), path("api/netshop/", include("netshop.urls")), path("api/workflow/", include("workflow.urls")), path("api/inventory/", include("inventory.urls")), path("health/ready", health.ready)]
