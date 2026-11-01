import os

# Web requests release their database connection at the end of each request.
# Override the shared runtime value before Django loads its settings.
os.environ["TERUISI_DJANGO_DB_CONN_MAX_AGE"] = "0"

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "teruisi_backend.settings")
application = get_wsgi_application()
