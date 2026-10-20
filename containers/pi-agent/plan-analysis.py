"""Reviewed read-only calculations. No code, paths, imports, or writes from input."""
import json
import math
import statistics
import sys

raw = sys.stdin.buffer.read(1048577)
if len(raw) > 1048576:
    raise ValueError('analysis_input_limit')
value = json.loads(raw)
if set(value) != {'helper', 'rows'} or not isinstance(value['rows'], list) or len(value['rows']) > 10000:
    raise ValueError('invalid_analysis_input')
if value['helper'] == 'statistics':
    numbers = value['rows']
    if any(type(n) not in (int, float) or not math.isfinite(n) for n in numbers):
        raise ValueError('invalid_number')
    result = {'count': len(numbers), 'sum': sum(numbers), 'mean': statistics.mean(numbers) if numbers else None,
              'min': min(numbers) if numbers else None, 'max': max(numbers) if numbers else None}
elif value['helper'] == 'replenishment':
    result = []
    for row in value['rows']:
        keys = {'available', 'in_transit', 'positive_units', 'window_days', 'target_days'}
        if (not isinstance(row, dict) or set(row) != keys
                or any(type(row[k]) not in (int, float) or not math.isfinite(row[k]) or row[k] < 0 for k in keys)
                or row['window_days'] <= 0 or row['target_days'] <= 0):
            raise ValueError('invalid_replenishment_row')
        daily = row['positive_units'] / row['window_days']
        result.append({'daily_positive_units': daily, 'suggested_units': max(0, math.ceil(daily * row['target_days'] - row['available'] - row['in_transit']))})
else:
    raise ValueError('unregistered_analysis_helper')
sys.stdout.write(json.dumps(result, ensure_ascii=False, allow_nan=False))
