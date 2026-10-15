"""Targeted tests for the data codec, independent of inventory formulas."""
import random
import unittest
from integer_series_codec import encode, decode, add, SAFE_INTEGER


class IntegerSeriesTests(unittest.TestCase):
    def test_round_trip_all_days_and_phase_boundaries(self):
        randomizer = random.Random(20261015)
        vectors = [
            [None] * 3650,
            [0] * 3650,
            [SAFE_INTEGER] * 3650,
            [day * 100000000 + day % 31 for day in range(3650)],
            [randomizer.randrange(-100000, 100000) for _ in range(3650)],
        ]
        for values in vectors:
            self.assertEqual(decode(encode(values), len(values)), values)

    def test_add_matches_independent_elementwise_sum(self):
        randomizer = random.Random(30)
        for length in (1, 29, 30, 31, 60, 61, 3650):
            vectors = [[randomizer.randrange(-1000, 1000) for _ in range(length)] for _ in range(8)]
            vectors.extend([[13] * length, [0] * length])
            actual = decode(add([encode(values) for values in vectors], length), length)
            expected = [sum(values[position] for values in vectors) for position in range(length)]
            self.assertEqual(actual, expected)

    def test_run_boundaries_merge_and_cancel(self):
        left = [max(0, day - 45) for day in range(3650)]
        right = [-value for value in left]
        result = add([encode(left), encode(right)], 3650)
        self.assertEqual(result, {'kind': 'constant', 'value': 0})

    def test_unknown_empty_and_mixed_null_semantics(self):
        self.assertEqual(add([], 3650), {'kind': 'constant', 'value': None})
        self.assertEqual(add([encode([1] * 3650), encode([None] * 3650)], 3650), {'kind': 'constant', 'value': None})
        with self.assertRaises(AssertionError):
            encode([0, None])

    def test_unsafe_browser_numbers_fail_closed(self):
        for values in ([SAFE_INTEGER + 1], [1.0], [True], [1, True]):
            with self.assertRaises(AssertionError):
                encode(values)
        with self.assertRaises(AssertionError):
            add([encode([SAFE_INTEGER] * 31), encode([1] * 31)], 31)
        with self.assertRaises(AssertionError):
            decode({'kind': 'phase-delta', 'length': 31, 'stride': 30, 'phases': [{'first': 1, 'runs': [[2, 1]]}] * 30}, 31)


if __name__ == '__main__':
    unittest.main()
