"""Private native Windows proof of the exclusive-file-handle restore leaf."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = Path(__file__).parent
ARTIFACT = Path("D:/codex-artifacts/market-ai-round2-20261015")
SHELL = Path("C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe")
PRIVATE = (ROOT / ".runtime" / ("review-guard-leaf-" + uuid.uuid4().hex)).resolve()
assert PRIVATE.is_relative_to((ROOT / ".runtime").resolve())
PRIVATE.mkdir(parents=True)
environment = {key: value for key, value in os.environ.items()
               if not key.upper().startswith(("TERUISI_", "AI_", "PG", "DJANGO_", "OPENAI_", "ARK_", "OLLAMA_", "CLOUDFLARE_"))}
for key in list(environment):
    if key.upper() == "PSMODULEPATH":
        environment.pop(key)
environment["PSModulePath"] = "C:/Windows/System32/WindowsPowerShell/v1.0/Modules"
sha = lambda raw: hashlib.sha256(raw).hexdigest()
old_sha = "ec5254ee24eed93639c2a819037b41356ea6351e7f22c0ba71402b0edc6b1f3a"
original_sha = "7dd49103f5b672dae484d3b5e70207d6644657701a5b6be23c85203cad62b72f"
old_bytes = Path("D:/teruisi-runtime/teruisi-worker-sales/releases/20261014T170130Z-17e3867852424323/source-snapshot/tools/worker-local-release-rotation.mjs").read_bytes()
original_bytes = (ARTIFACT / "protected-rotation-original.mjs").read_bytes()
assert sha(old_bytes) == old_sha and sha(original_bytes) == original_sha
raw = (ARTIFACT / "restore-guard.ps1").read_bytes()
body = raw.decode("utf-8-sig")
target, old, original = PRIVATE / "target.mjs", PRIVATE / "old.mjs", PRIVATE / "original.mjs"
target.write_bytes(original_bytes)
old.write_bytes(old_bytes)
original.write_bytes(original_bytes)
body = body.replace(r"D:\运营管理系统\tools\worker-local-release-rotation.mjs", str(target))
body = body.replace(r"D:\teruisi-runtime\teruisi-worker-sales\releases\20261014T170130Z-17e3867852424323\source-snapshot\tools\worker-local-release-rotation.mjs", str(old))
body = body.replace(r"D:\codex-artifacts\market-ai-round2-20261015\protected-rotation-original.mjs", str(original))
body = body.replace("@('D:\\','D:\\运营管理系统','D:\\运营管理系统\\tools')", "@('D:\\','" + str(PRIVATE) + "')")
assert r"D:\运营管理系统" not in body and r"D:\teruisi-runtime" not in body
script = PRIVATE / "private-restore.ps1"
script.write_text(body, encoding="utf-8-sig")

def run(script_path, expected, replacement):
    return subprocess.run([str(SHELL), "-NoProfile", "-NonInteractive", "-File", str(script_path),
        "-ExpectedSha256", expected, "-ReplacementPath", str(replacement)], cwd=PRIVATE, env=environment,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)

ordinary = subprocess.check_output([str(SHELL), "-NoProfile", "-NonInteractive", "-Command",
    "[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"],
    cwd=PRIVATE, env=environment, timeout=30, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
assert ordinary.strip() == b"False"
assert "[IO.FileStream]::new" in body and "[IO.FileShare]::None" in body
assert "Set-Acl" not in body and "[IO.File]::Replace" not in body
prior_private = ROOT / ".runtime/review-guard-leaf-71f7219710b6482eaedf36894ef65260"
prior_body = (prior_private / "private-restore.ps1").read_text(encoding="utf-8-sig")
assert "[NullString]::Value" in prior_body and "Set-Acl" not in prior_body
prior_body = prior_body.replace(str(prior_private), str(PRIVATE))
prior_script = PRIVATE / "private-prior-acl-failure.ps1"
prior_script.write_text(prior_body, encoding="utf-8-sig")
prior_result = run(prior_script, original_sha, old)
assert prior_result.returncode != 0 and sha(target.read_bytes()) == old_sha
prior_log = EVIDENCE / "review-publication-restore-leaf-acl-original-failure.log"
if not prior_log.exists():
    with prior_log.open("xb") as stream:
        stream.write(prior_result.stderr)
target.unlink()
target.write_bytes(original_bytes)
checks = []
fault = PRIVATE / "private-post-write-failure.ps1"
fault.write_text(body.replace("$taskStream.Write($taskReplacementBytes,0,$taskReplacementBytes.Length)",
    "$taskStream.Write($taskReplacementBytes,0,$taskReplacementBytes.Length)\nthrow 'Private injected post-write failure'"), encoding="utf-8-sig")
for acl_mode in ("inherited-private", "protected-private"):
    if acl_mode == "protected-private":
        acl_script = PRIVATE / "private-protect-acl.ps1"
        acl_script.write_text("$ErrorActionPreference='Stop'\n$reviewTarget='" + str(target) + "'\n"
            "$reviewAcl=Get-Acl -LiteralPath $reviewTarget\n$reviewAcl.SetAccessRuleProtection($true,$false)\n"
            "foreach($reviewRule in @($reviewAcl.Access)){$reviewAcl.RemoveAccessRuleAll($reviewRule)}\n"
            "$reviewSid=[Security.Principal.WindowsIdentity]::GetCurrent().User\n"
            "$reviewRule=[Security.AccessControl.FileSystemAccessRule]::new($reviewSid,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.AccessControlType]::Allow)\n"
            "$reviewAcl.AddAccessRule($reviewRule)\nSet-Acl -LiteralPath $reviewTarget -AclObject $reviewAcl\n"
            "if(-not (Get-Acl -LiteralPath $reviewTarget).AreAccessRulesProtected){throw 'Private DACL not protected'}\n", encoding="utf-8-sig")
        acl_result = subprocess.run([str(SHELL), "-NoProfile", "-NonInteractive", "-File", str(acl_script)],
            cwd=PRIVATE, env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        assert acl_result.returncode == 0, acl_result.stderr.decode(errors="replace")
    for expected, replacement, wanted, name in ((original_sha, old, old_sha, "current_to_old"),
                                              (old_sha, original, original_sha, "old_to_original")):
        result = run(script, expected, replacement)
        assert result.returncode == 0, result.stderr.decode(errors="replace")
        value = json.loads(result.stdout.decode("utf-8-sig"))
        assert value["aclUnchanged"] is True and value["sha256"] == wanted and sha(target.read_bytes()) == wanted
        checks.append({"case": name, "aclMode": acl_mode, "passed": True, "aclUnchanged": True})
    old.write_bytes(b"corrupt-before-copy")
    result = run(script, original_sha, old)
    assert result.returncode != 0 and sha(target.read_bytes()) == original_sha
    checks.append({"case": "changed_source_refused_before_target_write", "aclMode": acl_mode, "passed": True, "targetUnchanged": True})
    old.write_bytes(old_bytes)
    result = run(fault, original_sha, old)
    assert result.returncode != 0 and sha(target.read_bytes()) == original_sha
    checks.append({"case": "post_write_failure_rolls_back_with_same_handle", "aclMode": acl_mode, "passed": True, "targetUnchanged": True})
result = {"restorationScriptSha256": sha(raw), "guardedPrepareScriptSha256": sha((ARTIFACT / "prepare-guarded.mjs").read_bytes()),
    "ordinaryUser": True, "checks": checks, "fixture": str(PRIVATE), "fixtureAdaptation": "only fixed paths/parent allowlist; exact approved SHA literals preserved; post-write failure case explicitly injects a private seam",
    "replacementMethod": "exclusive-file-handle", "priorReplaceAclFailureReproduced": True,
    "powershellEnvironment": "fixed native PS5 Modules, matching productionCommandEnvironment; initial inherited Core module-path run failed before Replace",
    "productionWrites": 0, "productionLifecycleCalls": 0, "realModelCalls": 0, "rawSddlPersisted": False}
(EVIDENCE / "review-publication-restore-leaf-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"checksPassed": len(checks), "ordinaryUser": True, "productionWrites": 0, "realModelCalls": 0}))
