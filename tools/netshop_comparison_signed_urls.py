"""Mount the exact registered routes after Django's app registry is ready."""
from django.urls import include, path

urlpatterns = [path("api/netshop/", include("netshop.urls")), path("api/sales/", include("sales.urls"))]
