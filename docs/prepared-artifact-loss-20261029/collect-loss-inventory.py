"""Read queue metadata only; write review artifacts outside the production tree."""
import argparse
import collections
import datetime
import hashlib
import json
import pathlib
import stat


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def read_record(file):
    info = file.lstat()
    assert stat.S_ISREG(info.st_mode) and not file.is_symlink()
    assert info.st_nlink == 1 and info.st_size <= 1024 * 1024
    raw = file.read_bytes()
    return json.loads(raw), digest(raw)


def collect(state):
    queue = state / 'prebuild-queue-v2'
    leaves = ('tickets', 'dispatches', 'results', 'abandoned',
              'publication-retired', 'reconciliation-requests', 'reconciliation-results')
    records = {}
    hashes = {}
    for leaf in leaves:
        folder = queue / leaf
        if not folder.exists():
            continue
        assert not folder.is_symlink()
        records[leaf] = {}
        for file in sorted(folder.glob('*.json')):
            value, sha = read_record(file)
            records[leaf][file.stem] = (value, sha)
            hashes[f'{leaf}/{file.name}'] = sha
    counts = collections.Counter()
    missing = []
    excluded = []
    surviving = []
    for dispatch_id, (dispatch, dispatch_sha) in records['dispatches'].items():
        packet = pathlib.Path(dispatch['selection']['packet'])
        try:
            info = packet.lstat()
            assert stat.S_ISDIR(info.st_mode) and not packet.is_symlink(), str(packet)
            present = True
        except FileNotFoundError:
            present = False
        result, result_sha = records['results'].get(dispatch['requestId'], ({}, None))
        status = result.get('status', 'NO_RESULT')
        counts[f'{"present" if present else "missing"}:{status}'] += 1
        refs = []
        for ref in dispatch['tickets']:
            ticket, ticket_sha = records['tickets'][ref['requestId']]
            assert ticket_sha == ref['ticketSha256']
            terminal, terminal_sha = records['results'].get(ref['requestId'], ({}, None))
            if terminal:
                assert terminal['dispatchId'] == dispatch_id
                assert terminal['dispatchSha256'] == dispatch_sha
                assert terminal['ticketSha256'] == ticket_sha
            refs.append({'requestId': ref['requestId'], 'ticketSha256': ticket_sha,
                         'resultSha256': terminal_sha, 'status': terminal.get('status')})
        row = {'dispatchId': dispatch_id, 'dispatchSha256': dispatch_sha,
               'requestId': dispatch['requestId'], 'resultSha256': result_sha,
               'selectedTarget': dispatch['selectedTarget'], 'packet': dispatch['selection']['packet'],
               'status': status, 'configSha256': dispatch['configSha256'],
               'bundleSha256': dispatch['bundleSha256'], 'tickets': refs}
        if status == 'prepared':
            row.update({'preparationFile': result['nativeResult']['preparationFile'],
                        'preparationSha256': result['nativeResult']['preparationSha256']})
            (surviving if present else missing).append(row)
        elif not present:
            excluded.append(row)
    receipt_groups = {}
    for row in missing:
        key = row['preparationFile'].replace('\\', '/').lower()
        group = receipt_groups.setdefault(key, {'preparationFile': row['preparationFile'],
                                                'preparationSha256': row['preparationSha256'],
                                                'packet': row['packet'], 'dispatchIds': []})
        assert group['preparationSha256'] == row['preparationSha256']
        group['dispatchIds'].append(row['dispatchId'])
    expected = {'missing:prepared': 35, 'missing:unknown': 14,
                'missing:non-production': 4, 'present:prepared': 3}
    assert dict(counts) == expected, {'actual': dict(counts), 'expected': expected}
    assert len(receipt_groups) == 26, len(receipt_groups)
    expected_survivors = {'1b02c93791bb-d349107e-99df9f68', '18c25a3a153e-4a9cb3f5-b05895d2'}
    assert {pathlib.Path(row['packet']).name for row in surviving} == expected_survivors
    # A second bounded read proves the exported relationship did not span a queue mutation.
    for relative, sha in hashes.items():
        assert digest((queue / relative).read_bytes()) == sha, relative
    pending = [{'requestId': key, 'ticketSha256': sha, **value}
               for key, (value, sha) in records['tickets'].items() if key not in records['results']]
    return {'observedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'stateDirectory': str(state), 'counts': dict(counts),
            'missingReceiptCount': len(receipt_groups), 'missingPrepared': missing,
            'receiptGroups': list(receipt_groups.values()), 'excludedMissing': excluded,
            'survivingPrepared': surviving, 'pendingTickets': pending, 'queueFileSha256': hashes}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--state', required=True, type=pathlib.Path)
    parser.add_argument('--out', required=True, type=pathlib.Path)
    args = parser.parse_args()
    state, out = args.state.resolve(), args.out.resolve()
    assert not out.is_relative_to(state), 'Review artifacts cannot be written to production state'
    data = collect(state)
    out.mkdir(parents=True, exist_ok=True)
    for name, value in [('LOSS-INVENTORY.json', data), ('MISSING-PREPARED.json', data['missingPrepared'])]:
        with (out / name).open('x', encoding='utf-8', newline='\n') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
    lines = ['# 待用户核对的损失清单', '',
             '仅只读盘点产物；不是核销记录，也不授权采用或核销。35 条 prepared dispatch 对应 26 份缺失回执。', '',
             '| dispatchId | requestId | selectedTarget | packet | preparationSha256 |',
             '| --- | --- | --- | --- | --- |']
    for row in data['missingPrepared']:
        lines.append('| ' + ' | '.join('`' + row[key] + '`' for key in
                     ('dispatchId', 'requestId', 'selectedTarget', 'packet', 'preparationSha256')) + ' |')
    with (out / 'MISSING-PREPARED.md').open('x', encoding='utf-8', newline='\n') as stream:
        stream.write('\n'.join(lines) + '\n')
    print(json.dumps({'counts': data['counts'], 'missingReceiptCount': data['missingReceiptCount'],
                      'pending': len(data['pendingTickets']), 'outputs': str(out)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
