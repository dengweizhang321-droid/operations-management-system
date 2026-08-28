from django.urls import include, path

urlpatterns = [path("api/sales/", include("sales.urls"))]
