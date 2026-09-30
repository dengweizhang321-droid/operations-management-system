from django.urls import include, path
from teruisi_backend import health

urlpatterns = [path("api/netshop/", include("netshop.urls")), path("health/live", health.live), path("health/ready", health.ready)]
