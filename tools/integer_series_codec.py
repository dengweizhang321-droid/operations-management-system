"""Lossless data-only integer/null series encoding; no business calculations."""

SAFE_INTEGER = 2 ** 53 - 1


def safe_integer(value):
    assert type(value) is int and abs(value) <= SAFE_INTEGER, 'Unsafe JSON integer'
    return value


def encode(values, stride=30):
    assert values and type(stride) is int and stride > 0
    for value in values:
        if value is not None:
            safe_integer(value)
    if all(value == values[0] for value in values):
        if values[0] is not None:
            safe_integer(values[0])
        return {'kind': 'constant', 'value': values[0]}
    for value in values:
        safe_integer(value)
    phases = []
    for offset in range(min(stride, len(values))):
        phase = values[offset::stride]
        runs = []
        for left, right in zip(phase, phase[1:]):
            delta = safe_integer(right - left)
            if runs and runs[-1][1] == delta:
                runs[-1][0] += 1
            else:
                runs.append([1, delta])
        phases.append({'first': phase[0], 'runs': runs})
    return {'kind': 'phase-delta', 'length': len(values), 'stride': stride, 'phases': phases}


def decode(series, length):
    assert type(length) is int and length > 0
    if series['kind'] == 'constant':
        if series['value'] is not None:
            safe_integer(series['value'])
        return [series['value']] * length
    assert series['kind'] == 'phase-delta' and series['length'] == length
    stride = series['stride']
    assert stride > 0 and len(series['phases']) == min(stride, length)
    values = [None] * length
    for offset, phase in enumerate(series['phases']):
        value, position = safe_integer(phase['first']), offset
        values[position] = value
        for count, delta in phase['runs']:
            assert type(count) is int and count > 0
            safe_integer(delta)
            for _ in range(count):
                position += stride
                assert position < length
                value = safe_integer(value + delta)
                values[position] = value
        assert position + stride >= length
    assert all(value is not None for value in values)
    return values


def add(series_list, length, stride=30):
    """Add precomputed integer vectors by their delta-run boundaries."""
    if not series_list or any(series['kind'] == 'constant' and series['value'] is None for series in series_list):
        return {'kind': 'constant', 'value': None}
    if all(series['kind'] == 'constant' for series in series_list):
        return {'kind': 'constant', 'value': safe_integer(sum(series['value'] for series in series_list))}
    phases = []
    for offset in range(min(stride, length)):
        phase_length = len(range(offset, length, stride))
        first, changes = 0, {}
        for series in series_list:
            if series['kind'] == 'constant':
                first += series['value']
                continue
            assert series['length'] == length and series['stride'] == stride
            phase = series['phases'][offset]
            first += phase['first']
            position, previous = 0, 0
            for count, delta in phase['runs']:
                changes[position] = changes.get(position, 0) + delta - previous
                position += count
                previous = delta
            assert position == phase_length - 1
        first = safe_integer(first)
        runs, delta, previous_position = [], 0, 0
        for position in sorted(set(changes) | {phase_length - 1}):
            count = position - previous_position
            if count:
                if runs and runs[-1][1] == delta:
                    runs[-1][0] += count
                else:
                    runs.append([count, safe_integer(delta)])
            delta += changes.get(position, 0)
            previous_position = position
        phases.append({'first': first, 'runs': runs})
    result = {'kind': 'phase-delta', 'length': length, 'stride': stride, 'phases': phases}
    # Canonicalize constant groups and check intermediate sums for JS safety.
    values = decode(result, length)
    return {'kind': 'constant', 'value': values[0]} if all(value == values[0] for value in values) else result
