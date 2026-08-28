from django.urls import path

from . import views

urlpatterns = [
    path("summary", views.summary, name="sales-summary"),
    path("category-analysis", views.category_analysis, name="sales-category-analysis"),
    path("category-analysis/detail", views.category_detail, name="sales-category-detail"),
]
