"""Fixed bounded passive file ingress/egress; never execute supplied code."""
import base64
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import re
import stat
import sys

LIMIT = 8 * 1024 * 1024


def directory(path):
    path = Path(path)
    for parent in reversed([path, *path.parents]):
        if parent.exists() and not stat.S_ISDIR(parent.lstat().st_mode):
            raise ValueError("unsafe_directory")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    return path


def filename(value):
    if (not isinstance(value, str) or not 1 <= len(value) <= 180 or value in {".", ".."}
            or any(ord(c) < 32 for c in value) or any(c in value for c in '/\\:')
            or value.endswith((".", " "))):
        raise ValueError("invalid_file_name")
    return value


def main():
    raw = sys.stdin.buffer.read(12 * 1024 * 1024 + 1)
    if len(raw) > 12 * 1024 * 1024:
        raise ValueError("file_request_limit")
    request = json.loads(raw)
    action = request.get("action")
    if action == 'quota':
        total=count=0
        for current,dirs,files in os.walk('/workspace',followlinks=False):
            for name in dirs+files:
                info=(Path(current)/name).lstat()
                total+=info.st_size;count+=1
                if total>request['bytes'] or count>request['files']:
                    print(json.dumps({'exceeded':True,'bytes':total,'files':count}));return
        print(json.dumps({'exceeded':False,'bytes':total,'files':count}));return
    if action == "manifest":
        selection=Path('/workspace/skill-selection.json')
        active=json.loads(selection.read_text()) if selection.exists() else {'version':'1.0.0'}
        version=request.get('version',active['version'])
        if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+',version):raise ValueError('invalid_version')
        print(Path('/opt/pi/skill-bundles',version,'manifest.json').read_text())
        return
    if action == 'select_skills':
        version=request['version'];ids=request['ids']
        if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+',version):raise ValueError('invalid_version')
        manifest=json.loads(Path('/opt/pi/skill-bundles',version,'manifest.json').read_text())
        if not isinstance(ids,list) or len(set(ids))!=len(ids) or not set(ids).issubset({s['id'] for s in manifest['skills']}):raise ValueError('invalid_skills')
        target=Path('/workspace/skill-selection.json')
        temp=Path('/workspace/skill-selection.new')
        if temp.exists():raise ValueError('selection_conflict')
        with open(temp,'x',encoding='utf-8') as handle:
            json.dump({'version':version,'ids':ids},handle);handle.flush();os.fsync(handle.fileno())
        os.replace(temp,target)
        print('{"selected":true}')
        return
    if action == "import":
        files = request["files"]
        if not isinstance(files, list) or len(files) > 20:
            raise ValueError("file_count_limit")
        total, results, seen = 0, [], set()
        # Validate the complete batch before any file write.
        for item in files:
            if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", item["id"]):
                raise ValueError("file_id")
            name = filename(item["fileName"])
            target = directory("/workspace/inputs/" + item["id"]) / name
            if str(target) in seen:
                raise ValueError("file_collision")
            seen.add(str(target))
            data = base64.b64decode(item["base64"], validate=True)
            total += len(data)
            digest = hashlib.sha256(data).hexdigest()
            if total > LIMIT or len(data) != item["sizeBytes"] or digest != item["sha256"]:
                raise ValueError("file_integrity")
            if target.exists():
                info = target.lstat()
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or hashlib.sha256(target.read_bytes()).hexdigest() != digest:
                    raise ValueError("file_collision")
            results.append((target, data, digest))
        for target, data, digest in results:
            if not target.exists():
                with open(target, "xb") as handle:
                    os.chmod(target, 0o600)
                    handle.write(data)
        print(json.dumps({"files": [{"path": str(p), "sha256": h, "sizeBytes": len(d)} for p, d, h in results]}, ensure_ascii=False))
        return
    if action != "export":
        raise ValueError("file_action")
    result, total = [], 0
    root = directory("/workspace/outputs")
    for target in sorted(root.rglob("*")):
        info = target.lstat()
        if stat.S_ISDIR(info.st_mode):
            continue
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or target.is_symlink():
            raise ValueError("unsafe_output")
        # Check every ancestor; rglob must never escape through a symlink.
        for parent in target.parents:
            if parent == root.parent:
                break
            if not stat.S_ISDIR(parent.lstat().st_mode):
                raise ValueError("unsafe_output")
        if info.st_size > LIMIT or total + info.st_size > LIMIT or len(result) >= 20:
            raise ValueError("file_output_limit")
        with open(target, "rb") as handle:
            data = handle.read(LIMIT + 1)
            after = os.fstat(handle.fileno())
        if len(data) != info.st_size or after.st_mtime_ns != info.st_mtime_ns or after.st_ino != info.st_ino:
            raise ValueError("output_changed")
        total += len(data)
        relative = str(target.relative_to(root))
        result.append({"fileName": relative, "mimeType": mimetypes.guess_type(relative)[0] or "application/octet-stream",
                       "sizeBytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "base64": base64.b64encode(data).decode()})
    print(json.dumps({"files": result}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print('{"error":"file_transfer_rejected"}')
        sys.exit(1)
