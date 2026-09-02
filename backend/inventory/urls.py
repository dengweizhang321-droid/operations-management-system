from django.conf import settings
from django.urls import path

from . import views

read_patterns = [
    path("overview", views.overview, name="inventory-overview"),
    path("age-analysis", views.age_analysis, name="inventory-age-analysis"),
    path("inbound-monitor", views.inbound_monitor, name="inventory-inbound-monitor"),
    path("imports", views.imports, name="inventory-imports"),
    path("replenishment", views.replenishment, name="inventory-replenishment"),
    path("settings", views.settings_view, name="inventory-settings"),
    path("consumers/query", views.consumer_query, name="inventory-consumer-query"),
]
write_patterns = [
    path("imports", views.imports, name="inventory-imports"),
    path("uploads", views.uploads, name="inventory-uploads"),
    path("uploads/chunk", views.upload_chunk, name="inventory-upload-chunk"),
    path("replenishment", views.replenishment, name="inventory-replenishment"),
    path("settings", views.settings_view, name="inventory-settings"),
]

urlpatterns: list[object] = []
if settings.DJANGO_PROCESS_ROLE == "inventory_reader":
    urlpatterns.extend(read_patterns)
elif settings.DJANGO_PROCESS_ROLE == "inventory_writer":
    urlpatterns.extend(write_patterns)
elif settings.DJANGO_PROCESS_ROLE == "development":
    urlpatterns.extend(read_patterns + write_patterns)
