"""Focused catalog/sequence regressions; never connect to the production DB."""
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
import postgres_no_key_backup as backup
spec = importlib.util.spec_from_file_location('consistent',ROOT/'tools'/'postgres-consistent-backup.py')
consistent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(consistent)

class Result:
    def __init__(self,rows): self.rows=rows
    def fetchall(self): return self.rows
    def fetchone(self): return self.rows[0]

class SequenceDB:
    def __init__(self,last=10,called=True,maximum=10,increment=1,cycle=False,count=1,limit=9223372036854775807,cache=1):
        self.last,self.called,self.maximum,self.increment,self.cycle,self.count=last,called,maximum,increment,cycle,count
        self.calls=[]
        self.limit=limit
        self.cache=cache
    def execute(self,query):
        self.calls.append(query)
        if isinstance(query,str) and query.startswith('SELECT ns.nspname'):
            return Result([('public','test_id_seq','public','test','id',self.increment,self.cycle,self.limit,self.cache)])
        if isinstance(query,str) and query.startswith('SELECT count(*)'):
            return Result([(self.count,)])
        if 'last_value' in str(query): return Result([(self.last,self.called)])
        return Result([(self.maximum,)])

class Tests(unittest.TestCase):
    def test_next_value_must_exceed_maximum_even_after_faithful_restore(self):
        self.assertTrue(backup.sequence_health(SequenceDB()))
        for db in [SequenceDB(last=1,maximum=10),SequenceDB(last=10,called=False,maximum=10)]:
            with self.assertRaisesRegex(RuntimeError,'next value'):backup.sequence_health(db)
        self.assertTrue(backup.sequence_health(SequenceDB(last=11,called=False,maximum=10)))
        self.assertTrue(backup.sequence_health(SequenceDB(maximum=None)))
        self.assertTrue(backup.sequence_health(SequenceDB(cache=10)))  # fresh isolated restore
        with self.assertRaisesRegex(RuntimeError,'cached live sequence'):
            backup.sequence_health(SequenceDB(cache=10),require_uncached=True)
    def test_unknown_sequence_ownership_cycle_and_reverse_sequences_fail_closed(self):
        for db in [SequenceDB(cycle=True),SequenceDB(increment=0),SequenceDB(increment=-1),SequenceDB(count=2),SequenceDB(last=10,limit=10)]:
            with self.assertRaises(RuntimeError):backup.sequence_health(db)
    def test_release_catalog_is_a_catalogue_only_probe_and_uses_original_contract(self):
        class DB:
            def execute(self,query):return Result([('sales','0001_initial')])
        with patch.object(backup,'verify_closed_profile') as profile,patch.object(backup,'verify_profile_scope'),patch.object(backup,'collect_catalog',return_value={'relations':'a'*64}),patch.object(backup,'role_contract',return_value={'roles':[],'settings':[]}),patch.object(backup,'sequence_health',return_value=True):
            result=backup.release_catalog(DB())
            profile.assert_called_once();self.assertFalse(profile.call_args.kwargs['lock'])
            self.assertTrue(result['sequencesValid']);self.assertEqual(len(result['schemaSha256']),64)
        # No table row streaming in this release admission path.
        with patch.object(backup,'verify_closed_profile'),patch.object(backup,'verify_profile_scope'),patch.object(backup,'collect_catalog',return_value={}),patch.object(backup,'role_contract',return_value={}),patch.object(backup,'sequence_health',return_value=True),patch.object(backup,'stream_table_roots',side_effect=AssertionError('full row scan')):
            backup.release_catalog(DB())
    def test_extra_schema_or_large_objects_block_catalog_reuse(self):
        class DB:
            def __init__(self,schemas,large):self.schemas,self.large=schemas,large
            def execute(self,query):return Result(self.schemas if query.startswith('SELECT nspname') else [(self.large,)])
        backup.verify_profile_scope(DB([],0))
        for db in [DB([('unknown',)],0),DB([],1)]:
            with self.assertRaisesRegex(RuntimeError,'unreviewed schema'):backup.verify_profile_scope(db)
    def test_cli_catalog_requires_explicit_target_and_is_read_only(self):
        args=consistent.build_parser().parse_args(['release-catalog','--expected-database','isolated','--expected-user','postgres','--port','55490'])
        class Connection:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def rollback(self):self.rolled_back=True
            def execute(self,query):
                if query.startswith('BEGIN'):self.begin=query;return Result([])
                return Result([('isolated','postgres','127.0.0.1',55490)])
        c=Connection()
        with patch.object(consistent.psycopg,'connect',return_value=c),patch.object(backup,'release_catalog',return_value={'sequencesValid':True}):
            self.assertTrue(consistent.run_release_catalog(args)['readOnly'])
            self.assertIn('READ ONLY',c.begin);self.assertTrue(c.rolled_back)
        args.port=5432
        with patch.object(consistent.psycopg,'connect',return_value=c),patch.object(backup,'release_catalog',side_effect=AssertionError('wrong target')):
            with self.assertRaisesRegex(RuntimeError,'identity'):consistent.run_release_catalog(args)

if __name__=='__main__':unittest.main()
