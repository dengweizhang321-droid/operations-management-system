"""Private loopback C/P/A GET and registered Sales RPC routes, no production env."""
from netshop_comparison_test_settings import *  # noqa: F403
ROOT_URLCONF = "netshop_comparison_signed_urls"
ALLOWED_HOSTS = ["127.0.0.1", "localhost", "testserver"]
MEDIA_URL = "/private-fixture-media/"
STATIC_URL = "/private-fixture-static/"
