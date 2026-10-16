from django.urls import include, path
from teruisi_backend import health

urlpatterns = [path("api/workflow/", include("workflow.urls")), path("health/ready", health.ready), path("health/live", health.live)]
