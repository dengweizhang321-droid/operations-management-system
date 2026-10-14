"""Report private fixture ACL structure only; all SID text is removed."""
from pathlib import Path
import json
import os
import subprocess

ROOT = Path(__file__).resolve().parents[3]
private = ROOT / ".runtime/review-guard-leaf-13988dfff335440ab694f64523462dc7"
assert private.resolve().is_relative_to((ROOT / ".runtime").resolve())
script = private / "read-private-redacted-acl.ps1"
script.write_text("$ErrorActionPreference='Stop'\n$a=Get-Acl -LiteralPath '" + str(private / "target.mjs") + "'\n"
    "$tmp=Get-ChildItem -LiteralPath '" + str(private) + "' -Filter 'target.mjs.round2-*.tmp' | Select-Object -First 1\n"
    "$b=Get-Acl -LiteralPath $tmp.FullName\n"
    "@{ownerSame=($a.Owner -ceq $b.Owner);groupSame=($a.Group -ceq $b.Group);"
    "targetProtected=$a.AreAccessRulesProtected;temporaryProtected=$b.AreAccessRulesProtected;"
    "targetRedacted=[regex]::Replace($a.Sddl,'S-[0-9-]+','<SID>');temporaryRedacted=[regex]::Replace($b.Sddl,'S-[0-9-]+','<SID>')} | ConvertTo-Json -Compress\n", encoding="utf-8-sig")
environment = {key: value for key, value in os.environ.items() if key.upper() != "PSMODULEPATH"}
environment["PSModulePath"] = "C:/Windows/System32/WindowsPowerShell/v1.0/Modules"
raw = subprocess.check_output(["C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe", "-NoProfile", "-NonInteractive", "-File", str(script)],
    cwd=private, env=environment, timeout=30, creationflags=subprocess.CREATE_NO_WINDOW)
value = json.loads(raw.decode("utf-8-sig"))
assert "S-1-" not in json.dumps(value)
(Path(__file__).parent / "review-publication-acl-diagnostic-result.json").write_text(json.dumps(value, indent=2), encoding="utf-8")
print(json.dumps(value))
