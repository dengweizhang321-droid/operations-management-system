from django.urls import path

from . import views


urlpatterns = [
    path("cockpit", views.cockpit, name="bi-cockpit"),
    path("flow", views.flow, name="bi-flow"),
    path("overview", views.overview, name="bi-overview"),
]
