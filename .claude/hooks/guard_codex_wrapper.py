"""Restrict this Haiku agent's shell calls; not an operating-system sandbox."""
import json
import os
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / '.claude/scripts/codex_teammate.py'


def deny(reason):
    print(json.dumps({'hookSpecificOutput': {
        'hookEventName': 'PreToolUse', 'permissionDecision': 'deny',
        'permissionDecisionReason': reason}}, ensure_ascii=False))
    return 0


def check(command):
    # A deliberately small shared Bash/PowerShell grammar: no expansion,
    # statements, redirects, escape characters, single quotes or backslashes.
    if not isinstance(command, str) or re.search(r'[\r\n\x00$`;&|<>\\\'(){}\[\]*?!#%]', command):
        raise ValueError('Only a single bridge command with forward-slash paths is permitted')
    tokens = re.findall(r'"[^"\r\n]*"|[^\s"]+', command)
    if re.sub(r'"[^"\r\n]*"|[^\s"]+|\s+', '', command):
        raise ValueError('Malformed quoting')
    args = [t[1:-1] if t.startswith('"') else t for t in tokens]
    if len(args) < 3 or args[0] != 'python':
        raise ValueError('Use python "<absolute bridge script>" <action>')
    if not Path(args[1]).is_absolute() or Path(args[1]).resolve() != SCRIPT:
        raise ValueError('Only the bridge script belonging to this agent definition is permitted')
    action, tail = args[2], args[3:]
    run = r'[0-9a-f]{32}'
    if action == 'doctor' and not tail:
        return
    if action in {'status', 'verify', 'stop'} and len(tail) == 1 and re.fullmatch(run, tail[0]):
        return
    if action == 'wait' and tail and re.fullmatch(run, tail[0]):
        if len(tail) == 1 or (len(tail) == 3 and tail[1] == '--seconds' and
                              tail[2].isdigit() and 1 <= int(tail[2]) <= 50):
            return
    paths = []
    if action == 'start' and len(tail) == 4 and tail[0] == '--cwd' and tail[2] == '--task':
        paths = [tail[1], tail[3]]
    if action == 'resume' and len(tail) == 3 and re.fullmatch(run, tail[0]) and tail[1] == '--task':
        paths = [tail[2]]
    if paths and all(Path(p).is_absolute() and not p.startswith('-') for p in paths):
        return
    raise ValueError('Unknown bridge command or parameters; do not bypass the wrapper')


def main():
    try:
        raw = sys.stdin.buffer.read(256 * 1024 + 1)
        if len(raw) > 256 * 1024:
            raise ValueError('Hook input exceeds bound')
        event = json.loads(raw.decode('utf-8-sig'))
        tool = event.get('tool_name')
        if tool in {'Read', 'SendMessage'}:
            return 0
        if tool not in {'Bash', 'PowerShell'}:
            raise ValueError('Wrapper may only read required files, coordinate with Lead, or call the bridge')
        check(event.get('tool_input', {}).get('command'))
        # No blanket allow: keep Claude's existing permission evaluation.
        return 0
    except Exception as exc:
        return deny(str(exc))


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.exit(main())
