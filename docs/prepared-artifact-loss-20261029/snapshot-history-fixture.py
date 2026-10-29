"""Copy only eight already sealed history cases; never run a production queue reader."""
import argparse
import hashlib
import json
import os
import pathlib
import stat


def main():
    root = pathlib.Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=pathlib.Path, required=True)
    parser.add_argument('--out', type=pathlib.Path, required=True)
    args = parser.parse_args()
    source, out = args.source.resolve(), args.out.resolve()
    assert out.is_relative_to(root / '.runtime') and not out.is_relative_to(source)
    assert not out.exists(), 'Snapshot must be create-only'
    text = (root / 'tools/preparation-resolution-history.mjs').read_text(encoding='utf-8')
    history = json.loads(text.split('export default ', 1)[1].strip().rstrip(';'))
    assert len(history['records']) == 8
    files = []
    for pin in history['records']:
        files.extend([('dispatches/' + pin['dispatchId'] + '.json', pin['dispatchSha256']),
                      ('results/' + pin['requestId'] + '.json', pin['terminalSha256']),
                      ('resolutions/' + pin['dispatchId'] + '.json', pin['resolutionSha256'])])
        folder = source / 'resolutions' / (pin['dispatchId'] + '-evidence')
        assert folder.is_dir() and not folder.is_symlink()
        for base, directories, names in os.walk(folder, followlinks=False):
            for name in directories:
                assert not (pathlib.Path(base) / name).is_symlink()
            for name in names:
                files.append(((pathlib.Path(base) / name).relative_to(source).as_posix(), None))
    assert len(files) < 12000
    total = sum((source / name).lstat().st_size for name, _ in files)
    assert total < 128 * 1024 * 1024
    hashes = {}
    for name, expected in files:
        src = source / name
        info = src.lstat()
        assert stat.S_ISREG(info.st_mode) and not src.is_symlink() and info.st_nlink == 1
        assert src.resolve() == src
        raw = src.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if expected:
            assert digest == expected, name
        dest = out / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        with dest.open('xb') as stream:
            stream.write(raw)
        assert hashlib.sha256(dest.read_bytes()).hexdigest() == digest
        hashes[name] = digest
    receipt = {'source': str(source), 'privateFixture': str(out), 'fileCount': len(files),
               'totalBytes': total, 'productionWrites': False, 'sha256': hashes}
    (out.parent / 'historical-queue-copy-receipt.json').write_text(
        json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: value for key, value in receipt.items() if key != 'sha256'}, ensure_ascii=False))


if __name__ == '__main__':
    main()
