from django.test import SimpleTestCase
from .annotations import _failure_reason


class AnnotationDiagnosticsRound2Tests(SimpleTestCase):
    def test_known_validation_code_is_preserved_without_raw_field(self):
        result = _failure_reason('raw secret=credential data:image/png;base64,private [validation_code=segment_enum]', 'model_response')
        self.assertIn('validation_code=segment_enum', result)
        self.assertNotIn('credential', result)
        self.assertNotIn('private', result)
        self.assertNotIn('base64', result)

    def test_unknown_or_suffixed_codes_do_not_enter_persistence(self):
        for message in ['[validation_code=secret]', '[validation_code=segment_enum_secret]', '[validation_code=segment_enumSECRET]']:
            self.assertNotIn('validation_code', _failure_reason(message, 'model_response'))

    def test_price_and_finish_codes_are_safe_and_distinct(self):
        for code in ['image_price_value', 'price_low_value', 'price_high_value', 'confidence_value', 'no_price_not_null', 'no_price_evidence', 'finish_reason', 'output_truncated']:
            self.assertIn('validation_code=' + code, _failure_reason('[validation_code=' + code + ']', 'model_response'))
