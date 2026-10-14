"""Reuse the existing disposable rehearsal on an independent fixed test port."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
original = ROOT / "tools/market-annotation-postgres-rehearsal.py"
# Execute the unchanged rehearsal contract except its isolated port/root. Keeping
# __file__ bound to this wrapper makes child role probes use the same port too.
source = original.read_text(encoding="utf-8").replace(
    'ROOT = Path(__file__).resolve().parents[1]', 'ROOT = Path(__file__).resolve().parents[2]',
).replace('PORT = 55447', 'PORT = 55448')
exec(compile(source, str(original), "exec"), globals())
