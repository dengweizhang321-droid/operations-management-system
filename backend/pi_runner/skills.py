"""Build-time manifest generation. Runtime loads only the immutable image copy."""
import argparse
import hashlib
from pathlib import Path
import re
import stat

from .protocol import encode, validate_manifest


def build(root):
    root = Path(root)
    bundle_version=root.name if re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+',root.name) else '1.0.0'
    native=bundle_version not in {'1.0.0','1.1.0','1.2.0'}
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
            resource_types={'.md':'instructions' if path=='SKILL.md' else 'reference','.py':'script','.json':'data','.csv':'data',
                            '.txt':'reference','.tsv':'data','.png':'asset','.jpg':'asset','.jpeg':'asset','.svg':'asset','.xlsx':'template','.pdf':'reference'}
            if any(p in {".pi", "extensions", "node_modules", "routes"} for p in file.parts) or file.suffix not in (resource_types if native else {".md", ".py", ".json", ".csv"}):
                raise ValueError("skill_loader_forbidden")
            if file.suffix == ".md":
                text = raw.decode("utf-8")
                for target in re.findall(r"\]\(([^)]+)\)", text):
                    if not native:
                        if re.match(r"^(?:[a-z]+:|/|\\)", target, re.I) or ".." in target.split("/"):raise ValueError("unsafe_skill_link")
                    elif not re.match(r'^https?://',target,re.I):
                        local=target.split('#',1)[0]
                        if local and (re.match(r'^(?:[a-z]+:|/|\\)',local,re.I) or not (file.parent/local).resolve().is_relative_to(directory.resolve())):
                            raise ValueError('unsafe_skill_link')
            resources.append({"path": path, "sha256": hashlib.sha256(raw).hexdigest(), "sizeBytes": len(raw),**({'type':resource_types[file.suffix]} if native else {})})
        instruction = (directory / "SKILL.md").read_text(encoding="utf-8")
        # Legacy manifests retain byte-for-byte compatibility. New packages use
        # Pi's actual YAML parser/discovery at startup, including its diagnostics.
        if not native and (not instruction.startswith("---\n") or f"name: {directory.name}\n" not in instruction or not re.search(r"^description: .+", instruction, re.M)):
            raise ValueError("skill_load_failure")
        version=re.search(r'^\s+version: ([0-9]+\.[0-9]+\.[0-9]+)\s*$',instruction,re.M)
        if not version and not native:raise ValueError('skill_version_required')
        skills.append({"id": directory.name, "version": bundle_version if native else version.group(1), "sha256": hashlib.sha256(encode(resources)).hexdigest(), "resources": resources})
    return validate_manifest({"schemaVersion":2 if native else 1,"version": bundle_version, "skills": skills})


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("root")
    args = parser.parse_args()
    root = Path(args.root)
    (root / "manifest.json").write_bytes(encode(build(root)) + b"\n")
