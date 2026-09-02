from django.conf import settings
from django.urls import path

from . import views


read_patterns = [
    path("launch-projects", views.launch_projects, name="workflow-launch-projects"),
    path("launch-projects/<uuid:project_id>", views.launch_project, name="workflow-launch-project"),
    path("consumers/query", views.consumer_query, name="workflow-consumer-query"),
]
write_patterns = [
    path("launch-projects", views.launch_projects, name="workflow-launch-projects"),
    path("launch-projects/<uuid:project_id>", views.launch_project, name="workflow-launch-project"),
    path(
        "launch-projects/<uuid:project_id>/stages/<str:stage_key>",
        views.launch_project_stage,
        name="workflow-launch-project-stage",
    ),
]

urlpatterns: list[object] = []
if settings.DJANGO_PROCESS_ROLE == "workflow_reader":
    urlpatterns.extend(read_patterns)
elif settings.DJANGO_PROCESS_ROLE == "workflow_writer":
    urlpatterns.extend(write_patterns)
elif settings.DJANGO_PROCESS_ROLE == "development":
    urlpatterns.extend(read_patterns + write_patterns)
