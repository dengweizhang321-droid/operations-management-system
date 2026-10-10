"""Non-author boundary probes; any attempted escape stays in our temp fixture."""
import os
import sys
import sqlite3
import tempfile
import unittest
from pathlib import Path
from isolation_guards import install

WORKSPACE = Path(__file__).resolve().parents[3]
ROOT = (WORKSPACE / '.runtime/owner-acceptance').resolve()
install(ROOT, Path(__file__).with_name('owner-isolated-tests.py'))


class IndependentGuardTests(unittest.TestCase):
    def probe_relative(self, filename, uri=False, constructor=False):
        previous = Path.cwd()
        with tempfile.TemporaryDirectory(prefix='d-guard-sibling-', dir=WORKSPACE / '.runtime') as sibling:
            sibling = Path(sibling).resolve()
            assert ROOT not in sibling.parents
            assert WORKSPACE.resolve() in sibling.parents
            os.chdir(sibling)
            try:
                connect = sqlite3.Connection if constructor else sqlite3.connect
                value = 'file:' + filename + '?mode=rwc' if uri else filename
                opened = None
                try:
                    try:
                        opened = connect(value, uri=uri)
                    except RuntimeError:
                        pass
                    else:
                        self.fail('Relative input was validated against ROOT but opened in another cwd')
                finally:
                    if opened is not None:
                        opened.close()
                self.assertFalse((sibling / filename).exists())
            finally:
                os.chdir(previous)

    def test_relative_connect_cannot_create_a_database_in_another_cwd(self):
        self.probe_relative('independent-relative.sqlite3')

    def test_relative_uri_cannot_create_a_database_in_another_cwd(self):
        self.probe_relative('independent-relative-uri.sqlite3', uri=True)

    def test_relative_constructor_cannot_create_a_database_in_another_cwd(self):
        self.probe_relative('independent-relative-constructor.sqlite3', constructor=True)


if __name__ == '__main__':
    unittest.main(verbosity=2)
