"""Workflow-only synthetic test settings, never used by runtime entrypoints."""
from teruisi_backend.settings import *  # noqa: F403

INSTALLED_APPS = ["django.contrib.contenttypes", "sales.apps.SalesConfig", "workflow.apps.WorkflowConfig"]
ROOT_URLCONF = "workflow.tests.learning_urls"
