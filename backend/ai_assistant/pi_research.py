"""Explicit public research and registry artifacts, outside the networkless workspace.

Only GET is exposed. No caller headers, cookies, credentials, environment proxy,
browser profile, subprocess, or package code is used here. Installers consume the
returned verified bytes offline; this module never executes a downloaded package.
"""
from __future__ import annotations

import base64
import hashlib
import http.client
import io
import ipaddress
import json
import queue
import re
import socket
import ssl
import threading
import time
import zipfile
from datetime import datetime, timezone
from email.parser import BytesParser
from html.parser import HTMLParser
from urllib.parse import parse_qsl, quote, urlencode, urljoin, urlsplit, urlunsplit
from xml.etree import ElementTree

MAX_BODY = 2 * 1024 * 1024
MAX_BUNDLE = 4 * 1024 * 1024
_dns_slots = threading.BoundedSemaphore(4)
_SYNTHETIC = ipaddress.ip_network("198.18.0.0/15")
_TRANSITION = tuple(ipaddress.ip_network(v) for v in (
    "64:ff9b::/96", "64:ff9b:1::/48", "2001::/32", "2002::/16"))


class ResearchError(ValueError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()


def _now():
    return datetime.now(timezone.utc).isoformat()


def _public_ip(value):
    try:
        ip = ipaddress.ip_address(value)
    except ValueError as error:
        raise ResearchError("research_address_invalid") from error
    if (not ip.is_global or ip.is_multicast or ip.is_reserved or ip.is_unspecified
            or getattr(ip, "ipv4_mapped", None) is not None
            or any(ip.version == net.version and ip in net for net in _TRANSITION)):
        raise ResearchError("research_address_forbidden")
    return ip


def public_url(url):
    if (not isinstance(url, str) or not 1 <= len(url) <= 4096
            or any(ord(c) <= 32 or ord(c) == 127 for c in url) or "\\" in url):
        raise ResearchError("research_url_invalid")
    try:
        parts = urlsplit(url)
        host = (parts.hostname or "").encode("idna").decode("ascii").lower().rstrip(".")
        port = parts.port or (443 if parts.scheme == "https" else 80)
        if (parts.scheme not in {"https", "http"} or parts.username is not None
                or parts.password is not None or parts.fragment or not host
                or port != (443 if parts.scheme == "https" else 80) or "%" in host):
            raise ResearchError("research_url_invalid")
        if any(re.search(r"(?:token|secret|password|authorization|api.?key|signature|credential)", key, re.I)
               for key, _ in parse_qsl(parts.query, max_num_fields=100)):
            raise ResearchError("research_credentials_forbidden")
        try:
            ipaddress.ip_address(host)
        except ValueError:
            if ("." not in host or len(host) > 253 or not re.fullmatch(r"[a-z0-9.-]+", host)
                    or any(not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in host.split("."))
                    or host.endswith((".localhost", ".local", ".internal", ".invalid", ".test"))):
                raise ResearchError("research_host_forbidden")
        else:
            _public_ip(host)
        authority = "[" + host + "]" if ":" in host else host
        return urlunsplit((parts.scheme, authority, quote(parts.path or "/", safe="/%:@!$&'()*+,;=-._~"),
                           quote(parts.query, safe="%=&?/:@!$'()*+,;~-._"), ""))
    except (UnicodeError, ValueError) as error:
        if isinstance(error, ResearchError):
            raise
        raise ResearchError("research_url_invalid") from error


def _resolve(host, port, timeout):
    if not _dns_slots.acquire(blocking=False):
        raise ResearchError("research_dns_busy")
    result = queue.Queue(maxsize=1)
    def run():
        try:
            result.put(socket.getaddrinfo(host, port, 0, socket.SOCK_STREAM))
        except OSError:
            result.put(None)
        finally:
            _dns_slots.release()
    threading.Thread(target=run, name="pi-public-dns", daemon=True).start()
    try:
        values = result.get(timeout=min(5, timeout))
    except queue.Empty as error:
        raise ResearchError("research_timeout") from error
    if not values or len(values) > 32:
        raise ResearchError("research_dns_invalid")
    # Validate every answer before choosing one. Mixed public/private DNS fails.
    for family, socktype, proto, _, address in values:
        if family not in {socket.AF_INET, socket.AF_INET6} or socktype != socket.SOCK_STREAM:
            raise ResearchError("research_dns_invalid")
        ip = ipaddress.ip_address(address[0])
        if not (ip.version == 4 and ip in _SYNTHETIC):
            _public_ip(address[0])
        if ip.version != (4 if family == socket.AF_INET else 6) or address[1] != port:
            raise ResearchError("research_dns_invalid")
    return values


class SafePublicFetcher:
    def __init__(self, *, timeout=20, maximum=MAX_BODY):
        self.timeout = min(30, max(.1, timeout))
        self.maximum = min(MAX_BUNDLE, max(1, maximum))

    def get(self, url, *, maximum=None, allowed_hosts=None, _dns_json=False):
        deadline = time.monotonic() + self.timeout
        limit = min(self.maximum, maximum or self.maximum)
        current = public_url(url)
        for redirect in range(4):
            parts = urlsplit(current)
            if allowed_hosts is not None and (parts.hostname not in allowed_hosts or parts.scheme != "https"):
                raise ResearchError("research_origin_forbidden")
            budget = deadline - time.monotonic()
            if budget <= 0:
                raise ResearchError("research_timeout")
            addresses = _resolve(parts.hostname, parts.port or (443 if parts.scheme == "https" else 80), budget)
            if any(ipaddress.ip_address(v[4][0]) in _SYNTHETIC for v in addresses if v[0] == socket.AF_INET):
                if not all(v[0] == socket.AF_INET and ipaddress.ip_address(v[4][0]) in _SYNTHETIC for v in addresses):
                    raise ResearchError("research_dns_invalid")
                addresses = self._recover_dns(parts.hostname, parts.port or (443 if parts.scheme == "https" else 80), deadline)
            family, socktype, proto, _, target = addresses[0]
            sock = socket.socket(family, socktype, proto)
            connection = None
            # Close the active socket at the absolute deadline, including slow
            # status/header lines. Per-recv timeouts alone permit slowloris.
            owned = [sock]
            def expire():
                try:
                    owned[0].shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                owned[0].close()
            timer = threading.Timer(max(.001, deadline - time.monotonic()), expire)
            timer.daemon = True
            timer.start()
            try:
                sock.settimeout(max(.001, deadline - time.monotonic()))
                sock.connect(target)  # Numeric sockaddr: no second DNS lookup.
                if parts.scheme == "https":
                    sock = ssl.create_default_context().wrap_socket(sock, server_hostname=parts.hostname, do_handshake_on_connect=False)
                    owned[0] = sock
                    sock.do_handshake()
                connection = http.client.HTTPConnection(parts.hostname, parts.port, timeout=self.timeout)
                connection.sock = sock
                connection.request("GET", parts.path + ("?" + parts.query if parts.query else ""), headers={
                    "Accept": "application/dns-json" if _dns_json else "*/*", "Accept-Encoding": "identity", "User-Agent": "TERUISI-PublicResearch/1.0",
                    "Connection": "close"})
                response = connection.getresponse()
                if response.status in {301, 302, 303, 307, 308}:
                    location = response.getheader("Location")
                    if not location or redirect == 3:
                        raise ResearchError("research_redirect_invalid")
                    successor = public_url(urljoin(current, location))
                    if parts.scheme == "https" and urlsplit(successor).scheme != "https":
                        raise ResearchError("research_redirect_downgrade")
                    current = successor
                    continue
                if response.status != 200:
                    raise ResearchError("research_http_error")
                if response.getheader("Content-Encoding", "identity").lower() not in {"", "identity"}:
                    raise ResearchError("research_encoding_unsupported")
                length = response.getheader("Content-Length")
                if length and (not length.isdigit() or int(length) > limit):
                    raise ResearchError("research_body_too_large")
                body = bytearray()
                while not response.isclosed():
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise ResearchError("research_timeout")
                    sock.settimeout(remaining)
                    chunk = response.read1(min(65536, limit + 1 - len(body)))
                    if not chunk:
                        break
                    body.extend(chunk)
                    if len(body) > limit:
                        raise ResearchError("research_body_too_large")
                return {"url": current, "body": bytes(body), "contentType": response.getheader("Content-Type", ""),
                        "fetchedAt": _now(), "sha256": hashlib.sha256(body).hexdigest()}
            except ResearchError:
                raise
            except (OSError, ValueError, http.client.HTTPException) as error:
                raise ResearchError("research_timeout" if time.monotonic() >= deadline else "research_unavailable") from error
            finally:
                timer.cancel()
                if connection:
                    connection.close()
                sock.close()
        raise ResearchError("research_redirect_invalid")

    def _recover_dns(self, host, port, deadline):
        """Synthetic DNS is never a connection target. Resolve via a fixed,
        TLS-verified public resolver; the only disclosed value is the hostname.
        Literal 1.1.1.1 needs no hostname DNS and cannot recurse into recovery.
        """
        addresses = []
        for record_type, family in ((1, socket.AF_INET), (28, socket.AF_INET6)):
            remaining = min(5, deadline - time.monotonic())
            if remaining <= 0:
                raise ResearchError("research_timeout")
            page = SafePublicFetcher(timeout=remaining, maximum=16384).get(
                "https://1.1.1.1/dns-query?" + urlencode({"name": host, "type": record_type}),
                allowed_hosts={"1.1.1.1"}, _dns_json=True)
            try:
                answer = json.loads(page["body"])
                question = answer.get("Question", [])
                records = answer.get("Answer", [])
                if (answer.get("Status") != 0 or answer.get("TC") is not False or len(question) != 1
                        or question[0].get("name", "").rstrip(".").lower() != host
                        or question[0].get("type") != record_type or not isinstance(records, list) or len(records) > 32):
                    raise ResearchError("research_dns_invalid")
                for record in records:
                    if record.get("type") not in {1, 28}:
                        continue
                    if record["type"] != record_type:
                        raise ResearchError("research_dns_invalid")
                    ip = _public_ip(record["data"])
                    if ip.version != (4 if family == socket.AF_INET else 6):
                        raise ResearchError("research_dns_invalid")
                    target = (str(ip), port) if family == socket.AF_INET else (str(ip), port, 0, 0)
                    addresses.append((family, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", target))
            except (ValueError, TypeError, KeyError, AttributeError, RecursionError) as error:
                if isinstance(error, ResearchError):
                    raise
                raise ResearchError("research_dns_invalid") from error
        if not addresses:
            raise ResearchError("research_dns_invalid")
        return addresses


class _Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ignored = 0
        self.in_title = False
        self.parts, self.title = [], []

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "template", "noscript"}:
            self.ignored += 1
        if tag == "title":
            self.in_title = True

    def handle_endtag(self, tag):
        if tag in {"script", "style", "template", "noscript"} and self.ignored:
            self.ignored -= 1
        if tag == "title":
            self.in_title = False

    def handle_data(self, data):
        if not self.ignored:
            self.parts.append(data)
            if self.in_title:
                self.title.append(data)


def _text(value):
    return " ".join(value.split())


def execute_public_research(action, arguments, *, explicit_query, fetcher=None):
    if not isinstance(arguments, dict) or action not in {"search", "read"}:
        raise ResearchError("research_arguments_invalid")
    key = "query" if action == "search" else "url"
    if set(arguments) != {key} or not isinstance(explicit_query, str) or explicit_query != arguments[key]:
        raise ResearchError("research_explicit_query_required")
    query = arguments[key]
    if not 1 <= len(query.strip()) <= (500 if action == "search" else 4096) or any(ord(c) < 32 for c in query):
        raise ResearchError("research_arguments_invalid")
    fetcher = fetcher or SafePublicFetcher()
    if action == "read":
        page = fetcher.get(query)
        media = page["contentType"].split(";", 1)[0].lower().strip()
        if media not in {"text/html", "application/xhtml+xml", "text/plain", "text/markdown", "application/json"}:
            raise ResearchError("research_content_unsupported")
        charset = re.search(r"charset=([A-Za-z0-9_-]+)", page["contentType"], re.I)
        try:
            raw = page["body"].decode(charset.group(1) if charset else "utf-8", errors="replace")
        except LookupError as error:
            raise ResearchError("research_encoding_unsupported") from error
        parser = _Page()
        if media in {"text/html", "application/xhtml+xml"}:
            parser.feed(raw)
            text, title = _text(" ".join(parser.parts)), _text(" ".join(parser.title))[:300]
        else:
            text, title = raw, ""
        source = {k: v for k, v in page.items() if k != "body"}
        source.update(title=title, text=text[:80000], evidenceType="page")
        return {"schemaVersion": 1, "kind": "research", "action": action, "query": query,
                "sources": [source], "truncated": len(text) > 80000, "untrustedContent": True}
    search_url = "https://www.bing.com/search?" + urlencode({"q": query, "format": "rss"})
    result = fetcher.get(search_url, allowed_hosts={"www.bing.com", "bing.com"})
    try:
        root = ElementTree.fromstring(result["body"])
    except ElementTree.ParseError as error:
        raise ResearchError("research_search_unavailable") from error
    sources = []
    for item in root.findall("./channel/item")[:8]:
        try:
            url = public_url(item.findtext("link", ""))
        except ResearchError:
            continue
        excerpt = _text(item.findtext("description", ""))[:2000]
        sources.append({"url": url, "title": _text(item.findtext("title", ""))[:300], "text": excerpt,
                        "fetchedAt": result["fetchedAt"], "sha256": hashlib.sha256(excerpt.encode()).hexdigest(),
                        "contentType": "text/plain", "evidenceType": "search_result", "evidenceUrl": result["url"]})
    return {"schemaVersion": 1, "kind": "research", "action": action, "query": query,
            "sources": sources, "truncated": len(root.findall("./channel/item")) > 8, "untrustedContent": True}


def _name(name, npm=False):
    if not isinstance(name, str) or len(name) > 214 or not re.fullmatch(r"(?:@[a-z0-9._-]+/)?[a-z0-9][a-z0-9._-]{0,100}" if npm else r"[A-Za-z0-9][A-Za-z0-9._-]{0,100}", name):
        raise ResearchError("dependency_package_invalid")
    return name if npm else re.sub(r"[-_.]+", "-", name).lower()


def _version(version):
    if not isinstance(version, str) or not re.fullmatch(r"[0-9]{1,9}(?:\.[0-9]{1,9}){0,3}", version):
        raise ResearchError("dependency_exact_stable_version_required")
    return tuple(int(v) for v in version.split(".")) + (0,) * (4 - len(version.split(".")))


def _satisfies(version, constraint, npm=False):
    actual = _version(version)
    constraint = constraint.strip().strip("()")
    if constraint in {"", "*"}:
        return True
    # Conservative grammar: reject Git/URL dependencies, tags, wildcards,
    # prereleases and unknown marker/range forms instead of guessing a lock.
    if npm and "||" in constraint:
        return any(_satisfies(version, part, True) for part in constraint.split("||"))
    if npm and constraint.startswith(("^", "~")):
        prefix, value = constraint[0], constraint[1:]
        minimum = _version(value)
        if prefix == "^":
            index = next((i for i, n in enumerate(minimum[:3]) if n), 2)
        else:
            index = 1 if "." in value else 0
        upper = tuple(n + 1 if i == index else n if i < index else 0 for i, n in enumerate(minimum))
        return minimum <= actual < upper
    parts = constraint.split(",") if not npm else constraint.split()
    for part in parts:
        match = re.fullmatch(r"(==|!=|>=|<=|>|<|=|~=)?\s*([0-9]+(?:\.[0-9]+){0,3})", part.strip())
        if not match:
            raise ResearchError("dependency_constraint_unsupported")
        operator, value = match.groups()
        wanted = _version(value)
        if operator == "~=":
            bits = value.split(".")
            if len(bits) < 2:
                raise ResearchError("dependency_constraint_unsupported")
            index = len(bits) - 2
            upper = tuple(n + 1 if i == index else n if i < index else 0 for i, n in enumerate(wanted))
            good = wanted <= actual < upper
        else:
            good = {None: actual == wanted, "=": actual == wanted, "==": actual == wanted,
                    "!=": actual != wanted, ">=": actual >= wanted, "<=": actual <= wanted,
                    ">": actual > wanted, "<": actual < wanted}.get(operator, False)
        if not good:
            return False
    return True


class DependencyBroker:
    def __init__(self, fetcher=None):
        self.fetcher = fetcher or SafePublicFetcher(timeout=30, maximum=MAX_BUNDLE)

    def _json(self, url, hosts):
        page = self.fetcher.get(url, allowed_hosts=hosts)
        try:
            value = json.loads(page["body"])
        except (ValueError, RecursionError) as error:
            raise ResearchError("dependency_metadata_invalid") from error
        if not isinstance(value, dict):
            raise ResearchError("dependency_metadata_invalid")
        return value

    def fetch(self, ecosystem, packages):
        if ecosystem not in {"pip", "uv", "npm"} or not isinstance(packages, list) or not 1 <= len(packages) <= 16:
            raise ResearchError("dependency_arguments_invalid")
        npm = ecosystem == "npm"
        locked = {}
        for package in packages:
            if not isinstance(package, dict) or set(package) != {"name", "version"}:
                raise ResearchError("dependency_arguments_invalid")
            name = _name(package["name"], npm)
            _version(package["version"])
            if name in locked:
                raise ResearchError("dependency_duplicate_package")
            locked[name] = package["version"]
        result, total = [], 0
        for name, version in locked.items():
            if total >= MAX_BUNDLE:
                raise ResearchError("dependency_bundle_too_large")
            if npm:
                metadata = self._json("https://registry.npmjs.org/" + quote(name, safe="") + "/" + version, {"registry.npmjs.org"})
                dist = metadata.get("dist", {})
                if not isinstance(dist, dict):
                    raise ResearchError("dependency_metadata_invalid")
                url, integrity = dist.get("tarball"), dist.get("integrity", "")
                if metadata.get("name") != name or metadata.get("version") != version or not isinstance(integrity, str) or not integrity.startswith("sha512-"):
                    raise ResearchError("dependency_metadata_invalid")
                page = self.fetcher.get(url, maximum=MAX_BUNDLE - total, allowed_hosts={"registry.npmjs.org"})
                expected = "sha512-" + base64.b64encode(hashlib.sha512(page["body"]).digest()).decode()
                if integrity != expected:
                    raise ResearchError("dependency_integrity_mismatch")
                filename = name.replace("@", "").replace("/", "-") + "-" + version + ".tgz"
                dependencies, peers = metadata.get("dependencies", {}), metadata.get("peerDependencies", {})
                if not isinstance(dependencies, dict) or not isinstance(peers, dict) or metadata.get("optionalDependencies"):
                    raise ResearchError("dependency_optional_or_metadata_unsupported")
                if set(dependencies) & set(peers):
                    raise ResearchError("dependency_constraint_unsupported")
                dependencies = {**dependencies, **peers}
            else:
                metadata = self._json("https://pypi.org/pypi/" + name + "/" + version + "/json", {"pypi.org"})
                wheels = [v for v in metadata.get("urls", []) if isinstance(v, dict) and not v.get("yanked")
                          and v.get("packagetype") == "bdist_wheel" and isinstance(v.get("filename"), str)
                          and v["filename"].endswith(("-py3-none-any.whl", "-py2.py3-none-any.whl"))]
                if not wheels:
                    raise ResearchError("dependency_pure_python_wheel_required")
                artifact = sorted(wheels, key=lambda v: v["filename"])[0]
                filename, url = artifact["filename"], artifact.get("url")
                if not re.fullmatch(r"[A-Za-z0-9_.+-]+\.whl", filename):
                    raise ResearchError("dependency_filename_invalid")
                page = self.fetcher.get(url, maximum=MAX_BUNDLE - total, allowed_hosts={"files.pythonhosted.org"})
                if hashlib.sha256(page["body"]).hexdigest() != artifact.get("digests", {}).get("sha256"):
                    raise ResearchError("dependency_integrity_mismatch")
                dependencies = self._wheel_dependencies(page["body"], name, version)
            if not isinstance(dependencies, dict) or len(dependencies) > 64:
                raise ResearchError("dependency_metadata_invalid")
            for dependency, constraint in dependencies.items():
                normalized = _name(dependency, npm)
                if normalized not in locked:
                    raise ResearchError("dependency_complete_lock_required")
                if not isinstance(constraint, str) or not _satisfies(locked[normalized], constraint, npm):
                    raise ResearchError("dependency_lock_conflict")
            total += len(page["body"])
            if total > MAX_BUNDLE:
                raise ResearchError("dependency_bundle_too_large")
            result.append({"name": name, "version": version, "filename": filename, "sha256": hashlib.sha256(page["body"]).hexdigest(),
                           "sourceUrl": page["url"], "fetchedAt": page["fetchedAt"],
                           "contentBase64": base64.b64encode(page["body"]).decode(), "dependencies": dependencies})
        lock = [{k: v for k, v in item.items() if k not in {"contentBase64", "fetchedAt"}} for item in result]
        return {"schemaVersion": 1, "kind": "dependency_bundle", "ecosystem": ecosystem, "packages": result,
                "lockDigest": hashlib.sha256(_canonical(lock)).hexdigest()}

    @staticmethod
    def _wheel_dependencies(body, name, version):
        try:
            with zipfile.ZipFile(io.BytesIO(body)) as archive:
                infos = archive.infolist()
                metadata = [v for v in infos if v.filename.endswith(".dist-info/METADATA")]
                if len(infos) > 10000 or len(metadata) != 1 or metadata[0].file_size > 262144:
                    raise ResearchError("dependency_wheel_invalid")
                message = BytesParser().parsebytes(archive.read(metadata[0]), headersonly=True)
        except (zipfile.BadZipFile, RuntimeError, OSError) as error:
            raise ResearchError("dependency_wheel_invalid") from error
        if _name(message.get("Name", "")) != name or message.get("Version") != version:
            raise ResearchError("dependency_wheel_identity_mismatch")
        dependencies = {}
        for requirement in message.get_all("Requires-Dist", []):
            # Extras are never requested by the exact package manifest. Other
            # environment markers fail closed rather than resolving on Windows
            # for a different Linux execution environment.
            spec, _, marker = requirement.partition(";")
            if marker and re.fullmatch(r"\s*extra\s*==\s*['\"][A-Za-z0-9_-]+['\"]\s*", marker):
                continue
            if marker:
                raise ResearchError("dependency_environment_marker_unsupported")
            match = re.fullmatch(r"\s*([A-Za-z0-9._-]+)\s*(.*?)\s*", spec)
            if not match:
                raise ResearchError("dependency_constraint_unsupported")
            dependency, constraint = match.groups()
            normalized = _name(dependency)
            if normalized in dependencies:
                raise ResearchError("dependency_constraint_unsupported")
            dependencies[normalized] = constraint
        return dependencies
