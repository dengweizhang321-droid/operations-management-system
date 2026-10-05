from django.urls import include, path
urlpatterns = [path("api/products/", include("products.urls")), path("api/sales/", include("sales.urls"))]
