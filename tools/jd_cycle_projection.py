"""Offline cycle tables obtained from the inventory domain's authoritative helpers."""
from bisect import bisect_right
from integer_series_codec import encode, decode, add

MIN_CYCLE, MAX_CYCLE, DEFAULT_CYCLE = 1, 3650, 30
HEALTH_FIELDS = ('inventoryHealthState', 'inventoryHealthReasons', 'healthCounts', 'hasStockout', 'hasReplenishmentNeed')


def event_value(events, cycle, field='projection'):
    position = bisect_right([event['from'] for event in events], cycle) - 1
    assert position >= 0
    return events[position][field]


def append_event(events, cycle, value, field='projection'):
    if not events or events[-1][field] != value:
        events.append({'from': cycle, field: value})


def warehouse_cycles(service, rows):
    groups = {}
    for row in rows:
        quantities, health_events = [], []
        qualifications = row['metricQualifications']['suggestedReplenishmentQuantity']
        for cycle in range(MIN_CYCLE, MAX_CYCLE + 1):
            quantity, reasons, checked_cycle = service._replenishment_quantity(row, qualifications, cycle)
            assert reasons == qualifications and checked_cycle == cycle
            quantities.append(quantity)
            projected = {**row, 'suggestedReplenishmentQuantity': quantity, 'replenishmentCycleDays': cycle}
            append_event(health_events, cycle, service._warehouse_inventory_health(projected))
        series = encode(quantities)
        assert decode(series, MAX_CYCLE) == quantities
        groups[row['id']] = {'quantitySeries': series, 'healthEvents': health_events}
    return groups


def mask_events(service, rows, warehouse_groups, warehouses, product_index):
    result = {}
    for warehouse in ('', *warehouses):
        members = [row for row in rows if not warehouse or row['warehouseKey'] == warehouse]
        boundaries = sorted({event['from'] for row in members for event in warehouse_groups[row['id']]['healthEvents']} | {MIN_CYCLE})
        events = []
        for cycle in boundaries:
            projected = [{**row, **event_value(warehouse_groups[row['id']]['healthEvents'], cycle)} for row in members]
            values = {}
            for state in service.HEALTH_FILTER_STATES:
                selected, _counts, _filter_counts = service._health_filter_scope(projected, state)
                values[state] = format(sum(1 << product_index[code] for code in {row['goodsCode'] for row in selected}), 'x')
            append_event(events, cycle, values, 'values')
        result[warehouse] = events
    return result


def member_cycles(service, members, warehouse_groups):
    _quantity, reasons, _cycles = service._aggregate_replenishment(members)
    series = add([warehouse_groups[row['id']]['quantitySeries'] for row in members], MAX_CYCLE)
    assert (series['kind'] == 'constant' and series['value'] is None) == bool(reasons)
    boundaries = sorted({event['from'] for row in members for event in warehouse_groups[row['id']]['healthEvents']} | {MIN_CYCLE})
    events = []
    for cycle in boundaries:
        projected = [event_value(warehouse_groups[row['id']]['healthEvents'], cycle) for row in members]
        append_event(events, cycle, service._aggregate_inventory_health(projected))
    return {'quantitySeries': series, 'reasons': reasons, 'hasMembers': bool(members), 'healthEvents': events}
