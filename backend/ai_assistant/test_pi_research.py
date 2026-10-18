"""No network required; exercise the public egress and offline artifact boundary."""
import base64
import hashlib
import io
import json
import socket
import unittest
import zipfile
from unittest.mock import MagicMock, patch

from . import pi_research as research


def page(url, body, media="text/plain"):
    return {"url": url, "body": body, "contentType": media, "fetchedAt": "2026-10-18T00:00:00+00:00",
            "sha256": hashlib.sha256(body).hexdigest()}


class FakeFetcher:
    def __init__(self, pages):
        self.pages, self.calls = pages, []

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return self.pages[url]


class Response:
    def __init__(self, body=b"ok", status=200, headers=None):
        self.body, self.status, self.headers = body, status, headers or {"Content-Type": "text/plain"}

    def getheader(self, name, default=None):
        return self.headers.get(name, default)

    def isclosed(self):
        return not self.body

    def read1(self, count):
        value, self.body = self.body[:count], self.body[count:]
        return value


def address(ip="93.184.216.34", family=socket.AF_INET):
    return (family, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (ip, 443))


class PublicFetchTests(unittest.TestCase):
    def test_rejects_private_ipv4_ipv6_and_transition_addresses(self):
        for ip in ("127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1",
                   "198.18.0.1", "::1", "fe80::1", "fc00::1", "::ffff:8.8.8.8", "64:ff9b::808:808", "2002:0808:0808::1"):
            with self.subTest(ip=ip), self.assertRaises(research.ResearchError):
                research._public_ip(ip)
        self.assertEqual(str(research._public_ip("2606:4700:4700::1111")), "2606:4700:4700::1111")

    def test_rejects_unsafe_urls(self):
        for url in ("file:///etc/passwd", "https://user:pass@example.com", "https://example.com:8123/",
                    "https://localhost/", "https://metadata.google.internal/", "http://127.0.0.1/",
                    "https://example.com/a\r\nx:1", "https://example.com\\@127.0.0.1/",
                    "https://example.com/?access_token=private", "https://[fe80::1%25eth0]/"):
            with self.subTest(url=url), self.assertRaises(research.ResearchError):
                research.public_url(url)

    def test_mixed_dns_answers_fail_before_socket(self):
        with patch.object(socket, "getaddrinfo", return_value=[address(), address("127.0.0.1")]), \
                patch.object(socket, "socket") as create:
            with self.assertRaisesRegex(research.ResearchError, "address_forbidden"):
                research.SafePublicFetcher().get("https://example.com/")
            create.assert_not_called()

    def test_connection_is_numeric_tls_preserves_hostname_and_no_credentials(self):
        sock, connection = MagicMock(), MagicMock()
        connection.getresponse.return_value = Response()
        context = MagicMock()
        context.wrap_socket.return_value = sock
        with patch.object(research, "_resolve", return_value=[address()]) as resolve, \
                patch.object(socket, "socket", return_value=sock), \
                patch.object(research.ssl, "create_default_context", return_value=context), \
                patch.object(research.http.client, "HTTPConnection", return_value=connection):
            value = research.SafePublicFetcher().get("https://example.com/path?q=public")
        sock.connect.assert_called_once_with(("93.184.216.34", 443))
        self.assertEqual(context.wrap_socket.call_args.kwargs["server_hostname"], "example.com")
        self.assertEqual(resolve.call_count, 1)
        args, kwargs = connection.request.call_args
        self.assertEqual(args, ("GET", "/path?q=public"))
        self.assertFalse({"Cookie", "Authorization", "Proxy-Authorization", "Referer"} & set(kwargs["headers"]))
        self.assertEqual(value["body"], b"ok")

    def test_redirect_revalidates_dns_and_does_not_forward_cookies(self):
        connections = [MagicMock(), MagicMock()]
        connections[0].getresponse.return_value = Response(status=302, headers={
            "Location": "https://other.example/", "Set-Cookie": "private=1"})
        connections[1].getresponse.return_value = Response()
        context = MagicMock()
        context.wrap_socket.side_effect = lambda sock, **_: sock
        with patch.object(research, "_resolve", side_effect=[[address()], research.ResearchError("research_address_forbidden")]) as resolve, \
                patch.object(socket, "socket", return_value=MagicMock()), \
                patch.object(research.ssl, "create_default_context", return_value=context), \
                patch.object(research.http.client, "HTTPConnection", side_effect=connections):
            with self.assertRaisesRegex(research.ResearchError, "address_forbidden"):
                research.SafePublicFetcher().get("https://example.com/")
        self.assertEqual(resolve.call_count, 2)
        connections[1].request.assert_not_called()

    def test_length_and_chunked_body_are_bounded(self):
        for response in (Response(headers={"Content-Length": "500"}), Response(body=b"x" * 100)):
            connection = MagicMock()
            connection.getresponse.return_value = response
            with patch.object(research, "_resolve", return_value=[address()]), \
                    patch.object(socket, "socket", return_value=MagicMock()), \
                    patch.object(research.ssl, "create_default_context") as context, \
                    patch.object(research.http.client, "HTTPConnection", return_value=connection):
                context.return_value.wrap_socket.return_value = MagicMock()
                with self.assertRaisesRegex(research.ResearchError, "body_too_large"):
                    research.SafePublicFetcher(maximum=50).get("https://example.com/")

    def test_dns_recovery_question_and_public_ip_are_checked(self):
        answer = {"Status": 0, "TC": False, "Question": [{"name": "example.com.", "type": 1}],
                  "Answer": [{"type": 1, "data": "127.0.0.1"}]}
        with patch.object(research.SafePublicFetcher, "get", return_value=page("https://1.1.1.1/", json.dumps(answer).encode())):
            with self.assertRaisesRegex(research.ResearchError, "address_forbidden"):
                research.SafePublicFetcher()._recover_dns("example.com", 443, research.time.monotonic() + 5)
        answer["Question"][0]["name"] = "other.example."
        with patch.object(research.SafePublicFetcher, "get", return_value=page("https://1.1.1.1/", json.dumps(answer).encode())):
            with self.assertRaisesRegex(research.ResearchError, "dns_invalid"):
                research.SafePublicFetcher()._recover_dns("example.com", 443, research.time.monotonic() + 5)


class ResearchTests(unittest.TestCase):
    def test_explicit_input_only_and_html_is_untrusted_plain_text(self):
        url = "https://example.com/"
        fetcher = FakeFetcher({url: page(url, b"<title>Source</title><script>secret()</script><p>Public facts</p>", "text/html")})
        with self.assertRaisesRegex(research.ResearchError, "explicit_query_required"):
            research.execute_public_research("read", {"url": url}, explicit_query="business context", fetcher=fetcher)
        self.assertEqual(fetcher.calls, [])
        value = research.execute_public_research("read", {"url": url}, explicit_query=url, fetcher=fetcher)
        self.assertTrue(value["untrustedContent"])
        self.assertIn("Public facts", value["sources"][0]["text"])
        self.assertNotIn("secret", value["sources"][0]["text"])
        self.assertEqual(value["sources"][0]["evidenceType"], "page")

    def test_search_evidence_is_distinct_from_fetched_source_page(self):
        url = "https://www.bing.com/search?q=public&format=rss"
        fetcher = FakeFetcher({url: page(url, b"<rss><channel><item><title>Result</title><link>https://example.com/</link><description>Snippet</description></item></channel></rss>")})
        result = research.execute_public_research("search", {"query": "public"}, explicit_query="public", fetcher=fetcher)
        self.assertEqual(result["sources"][0]["evidenceType"], "search_result")
        self.assertEqual(result["sources"][0]["evidenceUrl"], url)
        self.assertEqual(len(fetcher.calls), 1)


def wheel(name="demo", version="1.0.0", requirement=""):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        archive.writestr(f"{name}-{version}.dist-info/METADATA", f"Name: {name}\nVersion: {version}\n{requirement}\n")
        archive.writestr("demo.py", "VALUE=42")
    return stream.getvalue()


def pip_pages(body, name="demo", version="1.0.0"):
    url = f"https://files.pythonhosted.org/{name}.whl"
    metadata = {"urls": [{"filename": f"{name}-{version}-py3-none-any.whl", "packagetype": "bdist_wheel", "url": url,
                           "digests": {"sha256": hashlib.sha256(body).hexdigest()}}]}
    return {f"https://pypi.org/pypi/{name}/{version}/json": page("https://pypi.org/", json.dumps(metadata).encode()), url: page(url, body)}


class DependencyTests(unittest.TestCase):
    def test_verified_wheel_bundle_and_source_lock(self):
        body = wheel()
        bundle = research.DependencyBroker(FakeFetcher(pip_pages(body))).fetch("pip", [{"name": "demo", "version": "1.0.0"}])
        artifact = bundle["packages"][0]
        self.assertEqual(base64.b64decode(artifact["contentBase64"]), body)
        self.assertEqual(artifact["sha256"], hashlib.sha256(body).hexdigest())
        self.assertTrue(artifact["sourceUrl"].startswith("https://files.pythonhosted.org/"))
        self.assertEqual(len(bundle["lockDigest"]), 64)

    def test_complete_transitive_lock_is_required_and_version_is_checked(self):
        body = wheel(requirement="Requires-Dist: child>=2.0,<3")
        other = wheel("child", "2.1.0")
        pages = {**pip_pages(body), **pip_pages(other, "child", "2.1.0")}
        broker = research.DependencyBroker(FakeFetcher(pages))
        with self.assertRaisesRegex(research.ResearchError, "complete_lock_required"):
            broker.fetch("pip", [{"name": "demo", "version": "1.0.0"}])
        bundle = broker.fetch("uv", [{"name": "demo", "version": "1.0.0"}, {"name": "child", "version": "2.1.0"}])
        self.assertEqual(len(bundle["packages"]), 2)
        self.assertFalse(research._satisfies("3.1.0", ">=2.0,<3"))

    def test_modified_artifact_is_rejected(self):
        body = wheel()
        pages = pip_pages(body)
        pages["https://files.pythonhosted.org/demo.whl"]["body"] = body + b"tamper"
        with self.assertRaisesRegex(research.ResearchError, "integrity_mismatch"):
            research.DependencyBroker(FakeFetcher(pages)).fetch("pip", [{"name": "demo", "version": "1.0.0"}])

    def test_npm_sha512_and_complete_lock(self):
        artifact = b"opaque verified tarball; never execute on host"
        metadata_url, source = "https://registry.npmjs.org/demo/1.0.0", "https://registry.npmjs.org/demo/-/demo-1.0.0.tgz"
        metadata = {"name": "demo", "version": "1.0.0", "dist": {"tarball": source,
                    "integrity": "sha512-" + base64.b64encode(hashlib.sha512(artifact).digest()).decode()}}
        fetcher = FakeFetcher({metadata_url: page(metadata_url, json.dumps(metadata).encode()), source: page(source, artifact)})
        bundle = research.DependencyBroker(fetcher).fetch("npm", [{"name": "demo", "version": "1.0.0"}])
        self.assertEqual(bundle["packages"][0]["filename"], "demo-1.0.0.tgz")
        self.assertEqual(fetcher.calls[1][1]["allowed_hosts"], {"registry.npmjs.org"})

    def test_unknown_constraints_and_nonportable_markers_fail_closed(self):
        for constraint in ("git+https://example.com/pkg", "latest", "1.x", "file:../pkg"):
            with self.assertRaises(research.ResearchError):
                research._satisfies("1.0.0", constraint, True)
        with self.assertRaisesRegex(research.ResearchError, "environment_marker_unsupported"):
            research.DependencyBroker._wheel_dependencies(wheel(requirement='Requires-Dist: child; python_version < "3.12"'), "demo", "1.0.0")


if __name__ == "__main__":
    unittest.main()
