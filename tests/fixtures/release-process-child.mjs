import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [mode, record] = process.argv.slice(2);
if (mode === 'grandchild') {
  setTimeout(() => process.exit(0), 60_000);
} else {
  if (['hold','hold-stdout','hold-stderr','nonzero-hold','hang-service'].includes(mode)) {
    const child = spawn(process.execPath, [process.argv[1], 'grandchild'], {
      windowsHide: true, detached: true, stdio: ['ignore', mode==='hold-stderr'?'ignore':'inherit', mode==='hold-stdout'?'ignore':'inherit'],
    });
    child.unref();
    writeFileSync(record, JSON.stringify({ direct: process.pid, service: child.pid }));
  } else if (record) writeFileSync(record, JSON.stringify({ direct: process.pid }));
  if (['hang','hang-service'].includes(mode)) setInterval(() => {}, 1000);
  else {
    if (mode === 'flood') process.stdout.write('x'.repeat(2_000_000));
    else if (mode === 'invalid') process.stdout.write('{"status":');
    else process.stdout.write('{"status":"completed","label":"运营管理系统"}');
    if (mode === 'nonzero-hold' || mode === 'nonzero') process.exitCode = 9;
  }
}
