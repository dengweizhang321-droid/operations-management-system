from django.urls import include, path

from . import health

urlpatterns = [
    path("health/live", health.live, name="health-live"),
    path("health/ready", health.ready, name="health-ready"),
    path("api/sales/", include("sales.urls")),
    path("api/finance/", include("finance.urls")),
    path("api/netshop/", include("netshop.urls")),
    path("api/market/", include("market.urls")),
    path("api/products/", include("products.urls")),
    path("api/inventory/", include("inventory.urls")),
    path("api/workflow/", include("workflow.urls")),
    path("api/customer-service/", include("customer_service.urls")),
    path("api/bi/", include("bi.urls")),
]
