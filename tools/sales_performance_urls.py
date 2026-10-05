from django.urls import include, path
from teruisi_backend import health

urlpatterns = [path("health/live", health.live), path("health/ready", health.ready),
    path("api/sales/", include("sales.urls")), path("api/finance/", include("finance.urls")),
    path("api/products/", include("products.urls")), path("api/inventory/", include("inventory.urls")),
    path("api/bi/", include("bi.urls"))]
