"""Build-time manifest generation. Runtime loads only the immutable image copy."""
import argparse
import hashlib
from pathlib import Path
import re
import stat

from .protocol import encode, validate_manifest


def build(root):
    root = Path(root)
    skills = []
    for directory in sorted(root.iterdir(),key=lambda p:p.name):
        if directory.name == "manifest.json":
            continue
        if not directory.is_dir() or directory.is_symlink():
            raise ValueError("skill_directory_required")
        resources = []
        for file in sorted(directory.rglob("*"),key=lambda p:p.relative_to(directory).as_posix()):
            info = file.lstat()
            if stat.S_ISDIR(info.st_mode):
                continue
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or file.is_symlink():
                raise ValueError("skill_special_file")
            raw = file.read_bytes()
            path = file.relative_to(directory).as_posix()
            # Skills are passive text/scripts, never extension/package loaders.
            if any(p in {".pi", "extensions", "node_modules", "routes"} for p in file.parts) or file.suffix not in {".md", ".py", ".json", ".csv"}:
                raise ValueError("skill_loader_forbidden")
            if file.suffix == ".md":
                text = raw.decode("utf-8")
                for target in re.findall(r"\]\(([^)]+)\)", text):
                    if re.match(r"^(?:[a-z]+:|/|\\)", target, re.I) or ".." in target.split("/"):
                        raise ValueError("unsafe_skill_link")
            resources.append({"path": path, "sha256": hashlib.sha256(raw).hexdigest(), "sizeBytes": len(raw)})
        instruction = (directory / "SKILL.md").read_text(encoding="utf-8")
        if not instruction.startswith("---\n") or f"name: {directory.name}\n" not in instruction or not re.search(r"^description: .+", instruction, re.M):
            raise ValueError("skill_load_failure")
        version=re.search(r'^\s+version: ([0-9]+\.[0-9]+\.[0-9]+)\s*$',instruction,re.M)
        if not version:raise ValueError('skill_version_required')
        skills.append({"id": directory.name, "version": version.group(1), "sha256": hashlib.sha256(encode(resources)).hexdigest(), "resources": resources})
    bundle_version=root.name if re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+',root.name) else '1.0.0'
    return validate_manifest({"schemaVersion":1,"version": bundle_version, "skills": skills})


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("root")
    args = parser.parse_args()
    root = Path(args.root)
    (root / "manifest.json").write_bytes(encode(build(root)) + b"\n")
