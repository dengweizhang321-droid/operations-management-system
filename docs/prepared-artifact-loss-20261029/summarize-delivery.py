"""Summarize candidate byte lineage without running release or queue code."""
import hashlib
import json
import pathlib
import subprocess


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def main():
    root = pathlib.Path(__file__).resolve().parents[2]
    out = pathlib.Path(__file__).resolve().parent
    baseline = json.loads((out / 'BASELINE.json').read_bytes())
    manifest = json.loads((out / 'ADOPTED-MANIFEST.json').read_bytes())
    leaves = []
    for file, digest in manifest['files'].items():
        source = subprocess.check_output(['git', 'show', manifest['sourceCommit'] + ':' + file], cwd=root)
        assert sha(source) == digest, 'Recorded source does not reproduce installed leaf: ' + file
        candidate = sha((root / file).read_bytes())
        leaves.append({'file': file, 'installedSha256': digest, 'candidateSha256': candidate,
                       'unchangedFromInstalled': digest == candidate, 'sourceCommitReproducesInstalled': True})
    protected = []
    for file, digest in baseline['protectedFiles'].items():
        current = sha((root / file).read_bytes())
        assert digest == current, 'Protected file changed: ' + file
        protected.append({'file': file, 'beforeSha256': digest, 'afterSha256': current, 'unchanged': True})
    diff = subprocess.check_output(['git', 'diff', '--name-only', 'HEAD'], cwd=root).decode().splitlines()
    untracked = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard'], cwd=root).decode().splitlines()
    paths = sorted(set(diff + untracked))
    file_digests = {p: sha((root / p).read_bytes()) for p in paths
                    if (root / p).is_file() and pathlib.Path(p).suffix in ('.mjs', '.ps1', '.py', '.json')
                    and not p.endswith(('DELIVERY-SUMMARY.json', 'eslint-final.json', 'eslint-inherited-baseline.json'))}
    value = {'mainBase': baseline['mainBase'], 'adoptedBundle': baseline['adoptedBundle'],
             'controlLeaves': leaves, 'unchangedControlLeafCount': sum(x['unchangedFromInstalled'] for x in leaves),
             'protectedFiles': protected, 'candidateFileSha256': file_digests}
    (out / 'DELIVERY-SUMMARY.json').write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'controlLeaves': len(leaves), 'unchangedControlLeaves': value['unchangedControlLeafCount'],
                      'protectedFilesUnchanged': len(protected), 'changedControlLeaves':
                      [x['file'] for x in leaves if not x['unchangedFromInstalled']]}, ensure_ascii=False))


if __name__ == '__main__':
    main()
