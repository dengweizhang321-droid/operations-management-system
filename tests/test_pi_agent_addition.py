"""Finite Pi150 installer negatives, using temporary synthetic files only."""
import json
from pathlib import Path
import tempfile
import subprocess
import sys
import unittest
from unittest.mock import patch

import pi_agent_addition as gate
import pi_agent_candidate as candidate


class PiAdditionTests(unittest.TestCase):
    def test_exact_parent_source_delta_and_unknown_migrations(self):
        with tempfile.TemporaryDirectory() as folder:
            before, after = Path(folder)/"before", Path(folder)/"after"
            migration = "backend/ai_assistant/migrations/0083_schedule_execution_profile.py"
            new = next(iter(gate.FILES))
            for root in (before, after):
                target = root/migration
                target.parent.mkdir(parents=True)
                target.write_text("# synthetic parent\n", encoding="utf8")
            (after/new).write_text("# synthetic reviewed delta\n", encoding="utf8")
            with patch.dict(gate.FILES, {new: gate.common.migrations(after)[new]}, clear=True):
                self.assertEqual(gate.source_delta(after,before),gate.common.digest(gate.common.migrations(after)))
                (after/migration).write_text("# rewritten parent\n",encoding="utf8")
                with self.assertRaises(ValueError): gate.source_delta(after,before)
                (after/migration).write_text("# synthetic parent\n",encoding="utf8")
                (after/new).with_name("0085_unknown.py").write_text("# unknown\n",encoding="utf8")
                with self.assertRaises(ValueError): gate.source_delta(after,before)
        for generation in (148,150,True,"149"):
            with self.assertRaises(ValueError): gate.steps_files(generation)

    def test_parent_requires_full149_catalogue_and_original_pointer(self):
        previous = {"synthetic."+str(n) for n in range(147)}
        previous.add("inventory.0016_jd_product_monitoring")
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root/gate.parent.ACTIVE).write_text("{}",encoding="utf8")
            with patch.object(gate.parent,"verify_active",return_value=({"migrationCount":149},{},root)), patch.object(gate.parent,"parent_proof",return_value=(previous,"b"*64)):
                result,pointer = gate.parent_proof(root,root)
                self.assertEqual(len(result),149)
                self.assertEqual(pointer,gate.common.sha(root/gate.parent.ACTIVE))
            with patch.object(gate.parent,"verify_active",return_value=({"migrationCount":148},{},root)), patch.object(gate.parent,"parent_proof",return_value=(previous,"b"*64)):
                with self.assertRaises(ValueError): gate.parent_proof(root,root)

    def test_bad_evidence_and_unsafe_references_fail_before_database(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            file=root/"evidence.json"
            file.write_text(json.dumps({"version":"wrong","status":"reviewed"}),encoding="utf8")
            base={"synthetic."+str(n) for n in range(149)}
            with patch.object(gate,"parent_proof",return_value=(base,"b"*64)):
                with self.assertRaises(ValueError): gate.admission(root,root,file,gate.common.sha(file))
            for value in ("../outside", "/absolute", "C:/private", "folder\\leaf"):
                with self.assertRaises(ValueError): candidate.relative(root,value)

    def test_original_pointer_compare_and_swap_preserves_unknown(self):
        with tempfile.TemporaryDirectory() as folder:
            target=Path(folder)/"pointer.json"
            gate.publish(target,{"version":"synthetic","owner":"first"})
            original=target.read_bytes()
            with self.assertRaises((ValueError,OSError)): gate.publish(target,{"version":"synthetic","owner":"other"})
            self.assertEqual(target.read_bytes(),original)
            with self.assertRaises(ValueError): gate.publish(target,{"owner":"wrong"},previous="0"*64)
            gate.publish(target,{"owner":"same-operation"},previous=gate.common.sha(target))
            self.assertEqual(gate.common.read(target),{"owner":"same-operation"})

    def test_lifecycle_and_bundle_use_only_pi_finite_child(self):
        root=Path(__file__).resolve().parents[1]
        lifecycle=(root/"tools/django-local-service.ps1").read_text(encoding="utf-8-sig")
        self.assertLess(lifecycle.index("# Pi150"),lifecycle.index("# Explicit149"))
        self.assertIn("'teruisi-pi-agent-schema-addition-v1'",lifecycle)
        self.assertIn('"tools\\pi_agent_catalog.json"',lifecycle)
        main=(root/"tools/main-schema-release.mjs").read_text(encoding="utf8")
        self.assertIn("additionKind:'PiAgent',fromGeneration:149,toGeneration:150",main)
        self.assertIn("ai-0084.json",main)
        native=(root/"tools/bi-app-adopt.ps1").read_text(encoding="utf-8-sig")
        self.assertIn("-ceq 'PiAgent'){'tools\\pi_agent_addition.py'}",native)
        self.assertIn("-ceq 'PiAgent'){'teruisi_pi_agent_schema_append'}",native)
        self.assertNotIn("-ceq 'TmallWarehouse','PiAgent'",native)

    def test_native_candidate_cli_uses_pi_recipe_and_evidence_names(self):
        root=Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as folder:
            source=Path(folder)/"source"
            source.mkdir()
            output=source.parent/"schema/ai-0084-evidence.json"
            args=[sys.executable,str(root/"tools/pi_agent_candidate.py"),"--source",str(source),"--runtime",r"D:\teruisi-runtime\django-sales",
                  "--recipe",str(source/"config/main-schema-releases/ai-0084.json"),"--output",str(output)]
            accepted=subprocess.run(args,capture_output=True,text=True)
            # The positive path reaches real recipe reading (the deliberate
            # synthetic fixture has no recipe); old copied names reject earlier.
            self.assertNotIn("Fixed reviewed recipe path",accepted.stderr)
            self.assertNotIn("Evidence must belong",accepted.stderr)
            self.assertIn("Unsafe addition evidence",accepted.stderr)
            for old in ("inventory-0017.json","inventory-0017-from148.json"):
                changed=list(args)
                changed[changed.index("--recipe")+1]=str(source/"config/main-schema-releases"/old)
                result=subprocess.run(changed,capture_output=True,text=True)
                self.assertNotEqual(result.returncode,0)
                self.assertIn("Fixed reviewed recipe path",result.stderr)
