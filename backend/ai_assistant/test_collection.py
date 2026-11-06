"""Fixture reuse must not make unittest collect another module's tests again."""
import importlib
from pathlib import Path
import unittest


def _cases(suite):
    for item in suite:
        if isinstance(item, unittest.TestSuite):
            yield from _cases(item)
        else:
            yield item


class TestCollectionTests(unittest.TestCase):
    def test_modules_collect_only_their_own_cases_once(self):
        for path in sorted(Path(__file__).parent.glob("test*.py")):
            name = f"{__package__}.{path.stem}"
            with self.subTest(module=name):
                module = importlib.import_module(name)
                loader = unittest.TestLoader()
                cases = list(_cases(loader.loadTestsFromModule(module)))
                self.assertEqual(loader.errors, [])
                self.assertEqual(
                    [case.id() for case in cases
                     if type(case).__module__ != name], [],
                    "Import fixture modules rather than binding TestCase classes")
                ids = [case.id() for case in cases]
                self.assertEqual(len(ids), len(set(ids)))
