"""Bounded RPC questionnaire contract; answers never confer business authority."""
from .protocol import encode


def request(value):
    if (not isinstance(value, dict) or set(value) - {'version', 'toolCallId', 'title', 'questions'}
            or value.get('version') != 1 or not isinstance(value.get('toolCallId'), str)
            or not 1 <= len(value['toolCallId']) <= 256 or not isinstance(value.get('questions'), list)
            or not 1 <= len(value['questions']) <= 10 or len(encode(value)) > 60000
            or 'title' in value and (not isinstance(value['title'],str) or len(value['title'])>512)):
        raise ValueError('invalid_questionnaire')
    seen = set()
    for item in value['questions']:
        if (not isinstance(item, dict) or set(item) - {'id', 'header', 'question', 'options', 'allowCustom', 'allowFreeform'}
                or not isinstance(item.get('id'), str) or not 1 <= len(item['id']) <= 64 or item['id'] in seen
                or not isinstance(item.get('question'), str) or not 1 <= len(item['question']) <= 4000
                or not isinstance(item.get('options', []), list) or len(item.get('options', [])) > 10
                or any(k in item and type(item[k]) is not bool for k in ('allowCustom','allowFreeform'))
                or 'header' in item and (not isinstance(item['header'],str) or len(item['header'])>64)):
            raise ValueError('invalid_questionnaire_question')
        seen.add(item['id'])
        labels = set()
        for option in item.get('options', []):
            if (not isinstance(option, dict) or set(option) - {'label', 'description', 'recommended'}
                    or not isinstance(option.get('label'), str) or not 1 <= len(option['label']) <= 512
                    or option['label'] in labels or not isinstance(option.get('description', ''), str)
                    or len(option.get('description', '')) > 2000
                    or type(option.get('recommended', False)) is not bool):
                raise ValueError('invalid_questionnaire_option')
            labels.add(option['label'])
    return value


def answer(questionnaire, value):
    if not isinstance(value, dict) or set(value) != {'version', 'answers'} or value['version'] != 1 or not isinstance(value['answers'], dict):
        raise ValueError('invalid_questionnaire_answer')
    if set(value['answers']) != {q['id'] for q in questionnaire['questions']}:
        raise ValueError('incomplete_questionnaire_answer')
    for q in questionnaire['questions']:
        text = value['answers'][q['id']]
        if not isinstance(text, str) or not 1 <= len(text) <= 8000:
            raise ValueError('invalid_questionnaire_answer')
        if not q.get('allowCustom', q.get('allowFreeform', True)) and text not in {o['label'] for o in q.get('options', [])}:
            raise ValueError('invalid_questionnaire_selection')
    return value
