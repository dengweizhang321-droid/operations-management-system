"""Root-tree admission fences. Only authenticated Django commands may change them."""
import re
from .protocol import encode

FIELDS = {'mode', 'modeRevision', 'admissionEpoch', 'rootSessionId', 'treeVersion', 'scopeSha256'}


def validate(value):
    if (not isinstance(value, dict) or set(value) != FIELDS
            or value.get('mode') not in {'plan', 'execute', 'switching'}
            or any(type(value.get(k)) is not int or not 1 <= value[k] <= 9007199254740991
                   for k in ('modeRevision', 'admissionEpoch', 'treeVersion'))
            or not isinstance(value.get('rootSessionId'), str)
            or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}', value['rootSessionId'])
            or not isinstance(value.get('scopeSha256'), str)
            or not re.fullmatch(r'[a-f0-9]{64}', value['scopeSha256'])):
        raise ValueError('invalid_admission')
    return value


def current(session):
    from .workspace import value_get
    return value_get(session, 'admission')


def install(session, value):
    from .workspace import value_set
    value = validate(value)
    previous = current(session)
    if previous:
        if previous['rootSessionId'] != value['rootSessionId']:
            raise ValueError('admission_root_changed')
        if any(value[k] < previous[k] for k in ('modeRevision', 'admissionEpoch', 'treeVersion')):
            raise ValueError('stale_admission')
        if value['admissionEpoch'] == previous['admissionEpoch'] and value != previous:
            raise ValueError('admission_epoch_changed')
    value_set(session, 'admission', value)
    return value


def check(session, supplied=None, execute=False):
    value = current(session)
    # A legacy environment cannot silently acquire the new local execution surface.
    if value is None:
        raise ValueError('admission_required')
    if supplied is not None and encode(validate(supplied)) != encode(value):
        raise ValueError('stale_admission')
    if execute and value['mode'] != 'execute':
        raise ValueError('plan_execution_forbidden')
    return value
