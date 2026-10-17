# PiAgent reviewed skills

Canonical bundles and their byte manifests live in
`backend/pi_runner/bundled_skills/<version>/` so the native Django deployment
can read the same frozen resources included in the runner image.

Version 1.0.0 contains sales/promotion/inventory analysis, stock/replenishment
suggestions, and evidence-bearing Excel reports. Version 1.1.0 adds per-source
business cutoff disclosure and is used by the real idle-update acceptance test.
Only these immutable image bundles can load. No host skill directory, extension,
AGENTS file, MCP server or route is discovered.
