"""Environment-driven settings for the API-only TERUISI backend."""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse


BASE_DIR = Path(__file__).resolve().parent.parent


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.getenv(name, str(default)).strip()
    try:
        value = int(raw)
    except ValueError as error:
        raise RuntimeError(f"{name} 必须是整数") from error
    if value < minimum or value > maximum:
        raise RuntimeError(f"{name} 必须在 {minimum} 到 {maximum} 之间")
    return value


def database_from_url(value: str) -> dict[str, object]:
    parsed = urlparse(value)
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise RuntimeError("TERUISI_DJANGO_DATABASE_URL 仅支持 postgresql://")
    options = {key: values[-1] for key, values in parse_qs(parsed.query).items() if values}
    return {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": unquote(parsed.path.lstrip("/")),
        "USER": unquote(parsed.username or ""),
        "PASSWORD": unquote(parsed.password or ""),
        "HOST": parsed.hostname or "",
        "PORT": str(parsed.port or ""),
        "CONN_MAX_AGE": int(os.getenv("TERUISI_DJANGO_DB_CONN_MAX_AGE", "60")),
        "OPTIONS": options,
    }


database_url = os.getenv("TERUISI_DJANGO_DATABASE_URL", "").strip()
DEBUG = env_bool("DJANGO_DEBUG", default=not bool(database_url))
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "unsafe-local-development-key")
if not DEBUG and SECRET_KEY == "unsafe-local-development-key":
    raise RuntimeError("非调试 Django 环境必须显式设置安全的 DJANGO_SECRET_KEY")
ALLOWED_HOSTS = [item.strip() for item in os.getenv("DJANGO_ALLOWED_HOSTS", "127.0.0.1,localhost,testserver").split(",") if item.strip()]

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "sales.apps.SalesConfig",
]
MIDDLEWARE: list[str] = []
ROOT_URLCONF = "teruisi_backend.urls"
TEMPLATES: list[dict[str, object]] = []
WSGI_APPLICATION = "teruisi_backend.wsgi.application"
ASGI_APPLICATION = "teruisi_backend.asgi.application"

if database_url:
    DATABASES = {"default": database_from_url(database_url)}
else:
    sqlite_path = Path(os.getenv("TERUISI_DJANGO_SQLITE_PATH", BASE_DIR.parent / ".runtime" / "django" / "teruisi.sqlite3"))
    sqlite_path.parent.mkdir(parents=True, exist_ok=True)
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": sqlite_path,
            "OPTIONS": {"timeout": 30},
        }
    }

LANGUAGE_CODE = "zh-hans"
TIME_ZONE = "Asia/Shanghai"
USE_I18N = True
USE_TZ = True
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
SALES_READ_CACHE_SECONDS = env_int("TERUISI_DJANGO_SALES_CACHE_SECONDS", 60, 0, 3600)
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "teruisi-sales-read-projection",
        "OPTIONS": {"MAX_ENTRIES": 500},
    }
}

# Django is behind the local edge adapter; it must never infer public identity.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
DATA_UPLOAD_MAX_MEMORY_SIZE = 1_048_576
