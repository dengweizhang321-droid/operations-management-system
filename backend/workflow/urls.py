from django.conf import settings
from django.urls import path

from . import views


read_patterns = [
    path("launch-projects", views.launch_projects, name="workflow-launch-projects"),
    path("launch-projects/<uuid:project_id>", views.launch_project, name="workflow-launch-project"),
    path("new-product-lines", views.new_product_lines, name="workflow-new-product-lines"),
    path("new-product-weekly-followup", views.new_product_weekly_followup, name="workflow-new-product-weekly-followup"),
    path("new-product-weekly-report-config", views.new_product_weekly_report_config, name="workflow-new-product-weekly-report-config"),
    path("consumers/query", views.consumer_query, name="workflow-consumer-query"),
]
write_patterns = [
    path("launch-projects", views.launch_projects, name="workflow-launch-projects"),
    path("launch-projects/<uuid:project_id>", views.launch_project, name="workflow-launch-project"),
    path("new-product-lines", views.new_product_lines, name="workflow-new-product-lines"),
    path("new-product-lines/<uuid:line_id>", views.new_product_line, name="workflow-new-product-line"),
    path("new-product-lines/learn", views.new_product_line_learning, name="workflow-new-product-line-learning"),
    path("new-product-weekly-report-config", views.new_product_weekly_report_config, name="workflow-new-product-weekly-report-config"),
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
