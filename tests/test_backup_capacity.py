import argparse
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch, MagicMock

spec = importlib.util.spec_from_file_location('capacity', Path(__file__).resolve().parents[1] / 'tools/postgres-consistent-backup.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CapacityTests(unittest.TestCase):
    def test_readonly_identity_and_positive_size(self):
        args = argparse.Namespace(expected_database='fixture', expected_user='owner', port=55889)
        connection = MagicMock()
        with patch.object(module.psycopg, 'connect') as connect:
            connect.return_value.__enter__.return_value = connection
            for row in [('fixture', 'owner', '127.0.0.1', 55889, 42),
                        ('fixture', 'owner', '127.0.0.1/32', 55889, 42),
                        ('fixture', 'owner', '192.0.2.1/32', 55889, 42),
                        ('fixture', 'owner', '::1/128', 55889, 42),
                        ('wrong', 'owner', '127.0.0.1', 55889, 42),
                        ('fixture', 'wrong', '127.0.0.1', 55889, 42),
                        ('fixture', 'owner', '127.0.0.1', 5432, 42),
                        ('fixture', 'owner', '127.0.0.1', 55889, 0),
                        ('fixture', 'owner', '127.0.0.1', 55889, True), None]:
                connection.execute.return_value.fetchone.return_value = row
                if (row and type(row[-1]) is int and row[-1] == 42
                        and row[:2] == ('fixture', 'owner') and row[3] == 55889
                        and row[2] in ('127.0.0.1', '127.0.0.1/32')):
                    self.assertEqual(module.run_capacity(args), {'status': 'completed', 'databaseBytes': 42})
                else:
                    with self.assertRaises(RuntimeError):
                        module.run_capacity(args)
            connection.execute.assert_any_call('SET TRANSACTION READ ONLY')


if __name__ == '__main__':
    unittest.main()
