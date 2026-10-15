"""Read-only catalogue for exactly AI 0083; independent of adoption receipts."""
import hashlib
import copy
import json
import uuid
from psycopg import sql

STEP = "ai_assistant.0083_schedule_execution_profile"
STEPS = (STEP,)
FILES = {"backend/ai_assistant/migrations/0083_schedule_execution_profile.py":
         "de5f52254f6bd0df95f73fa253ec275ce7a5c23851aa108d2f3ae2231d333420"}
COLUMNS = {
    "ai_dingtalk_schedules": {"model_id": "text", "execution_mode": "character varying(32)"},
    "ai_dingtalk_schedule_runs": {**{name: "character varying(16)" for name in
        ("data_status", "analysis_status", "delivery_status")}, **{name: "text" for name in
        ("model_snapshot_json", "facts_json", "content_text", "stage_details_json")}},
}
REFERENCE142 = {'ai_dingtalk_schedules': {'identity': ['teruisi_sales_owner', 'r', 'p', False, False],
                           'columns': [['id', 'character varying(64)', True, None, '', '', '"default"'],
                                       ['name', 'character varying(100)', True, None, '', '', '"default"'],
                                       ['prompt', 'text', True, None, '', '', '"default"'],
                                       ['cadence', 'character varying(8)', True, None, '', '', '"default"'],
                                       ['hour', 'smallint', True, None, '', '', None],
                                       ['minute', 'smallint', True, None, '', '', None],
                                       ['day', 'smallint', True, None, '', '', None],
                                       ['target_type',
                                        'character varying(8)',
                                        True,
                                        None,
                                        '',
                                        '',
                                        '"default"'],
                                       ['target_id',
                                        'character varying(256)',
                                        True,
                                        None,
                                        '',
                                        '',
                                        '"default"'],
                                       ['sender_id',
                                        'character varying(160)',
                                        True,
                                        None,
                                        '',
                                        '',
                                        '"default"'],
                                       ['owner_email',
                                        'character varying(320)',
                                        True,
                                        None,
                                        '',
                                        '',
                                        '"default"'],
                                       ['enabled', 'boolean', True, None, '', '', None],
                                       ['version', 'integer', True, None, '', '', None],
                                       ['next_run_at', 'timestamp with time zone', False, None, '', '', None],
                                       ['last_run_at', 'timestamp with time zone', False, None, '', '', None],
                                       ['updated_at', 'timestamp with time zone', True, None, '', '', None],
                                       ['content_type',
                                        'character varying(16)',
                                        True,
                                        None,
                                        '',
                                        '',
                                        '"default"'],
                                       ['source_ref',
                                        'character varying(160)',
                                        True,
                                        None,
                                        '',
                                        '',
                                        '"default"']],
                           'constraints': [['ai_ding_schedule_bound',
                                            'c',
                                            True,
                                            False,
                                            False,
                                            'CHECK-TREE ["AND",[["atom","octet_length(prompt) <= '
                                            '16000"],["atom","(cadence)::text = ANY (ARRAY[\'daily\'::text, '
                                            "'weekly'::text, "
                                            '\'monthly\'::text])"],["atom","(target_type)::text = ANY '
                                            '(ARRAY[\'group\'::text, \'person\'::text])"],["atom","hour <= '
                                            '23"],["atom","minute <= 59"],["atom","day >= 1"],["atom","day '
                                            '<= 28"],["atom","version >= 1"]]]'],
                                           ['ai_ding_schedule_media_bound',
                                            'c',
                                            True,
                                            False,
                                            False,
                                            'CHECK-TREE ["AND",[["atom","(content_type)::text = ANY '
                                            "(ARRAY['text'::text, 'screenshot'::text, "
                                            '\'report_file\'::text])"],["atom","octet_length((source_ref)::text) '
                                            '<= 160"],["OR",[["AND",[["atom","(content_type)::text = '
                                            '\'text\'::text"],["atom","(source_ref)::text = '
                                            '\'\'::text"]]],["AND",[["atom","(content_type)::text <> '
                                            '\'text\'::text"],["atom","(source_ref)::text <> '
                                            '\'\'::text"]]]]]]]'],
                                           ['ai_dingtalk_schedules_day_check',
                                            'c',
                                            True,
                                            False,
                                            False,
                                            'CHECK-TREE ["atom","day >= 0"]'],
                                           ['ai_dingtalk_schedules_hour_check',
                                            'c',
                                            True,
                                            False,
                                            False,
                                            'CHECK-TREE ["atom","hour >= 0"]'],
                                           ['ai_dingtalk_schedules_minute_check',
                                            'c',
                                            True,
                                            False,
                                            False,
                                            'CHECK-TREE ["atom","minute >= 0"]'],
                                           ['ai_dingtalk_schedules_pkey',
                                            'p',
                                            True,
                                            False,
                                            False,
                                            'PRIMARY KEY (id)'],
                                           ['ai_dingtalk_schedules_version_check',
                                            'c',
                                            True,
                                            False,
                                            False,
                                            'CHECK-TREE ["atom","version >= 0"]']],
                           'indexes': [['ai_ding_schedule_due',
                                        True,
                                        True,
                                        False,
                                        'CREATE INDEX ai_ding_schedule_due ON public.ai_dingtalk_schedules '
                                        'USING btree (enabled, next_run_at)'],
                                       ['ai_dingtalk_schedules_id_eed4c837_like',
                                        True,
                                        True,
                                        False,
                                        'CREATE INDEX ai_dingtalk_schedules_id_eed4c837_like ON '
                                        'public.ai_dingtalk_schedules USING btree (id varchar_pattern_ops)'],
                                       ['ai_dingtalk_schedules_pkey',
                                        True,
                                        True,
                                        True,
                                        'CREATE UNIQUE INDEX ai_dingtalk_schedules_pkey ON '
                                        'public.ai_dingtalk_schedules USING btree (id)']],
                           'triggers': [['ai_immutable_identity',
                                         19,
                                         'O',
                                         'public',
                                         'ai_immutable_record_guard',
                                         '6964006f776e65725f656d61696c00',
                                         'CREATE TRIGGER ai_immutable_identity BEFORE UPDATE ON '
                                         'public.ai_dingtalk_schedules FOR EACH ROW EXECUTE FUNCTION '
                                         "ai_immutable_record_guard('id', 'owner_email')"],
                                        ['ai_write_fence',
                                         31,
                                         'O',
                                         'public',
                                         'ai_runtime_write_fence',
                                         '',
                                         'CREATE TRIGGER ai_write_fence BEFORE INSERT OR DELETE OR UPDATE ON '
                                         'public.ai_dingtalk_schedules FOR EACH ROW EXECUTE FUNCTION '
                                         'ai_runtime_write_fence()']],
                           'acl': [['OWNER', 'DELETE', False],
                                   ['OWNER', 'INSERT', False],
                                   ['OWNER', 'MAINTAIN', False],
                                   ['OWNER', 'REFERENCES', False],
                                   ['OWNER', 'SELECT', False],
                                   ['OWNER', 'TRIGGER', False],
                                   ['OWNER', 'TRUNCATE', False],
                                   ['OWNER', 'UPDATE', False],
                                   ['teruisi_ai_reader', 'SELECT', False],
                                   ['teruisi_ai_writer', 'INSERT', False],
                                   ['teruisi_ai_writer', 'SELECT', False],
                                   ['teruisi_ai_writer', 'UPDATE', False]],
                           'columnAcl': [],
                           'policies': []},
 'ai_dingtalk_schedule_runs': {'identity': ['teruisi_sales_owner', 'r', 'p', False, False],
                               'columns': [['id', 'character varying(64)', True, None, '', '', '"default"'],
                                           ['schedule_id',
                                            'character varying(64)',
                                            True,
                                            None,
                                            '',
                                            '',
                                            '"default"'],
                                           ['schedule_version', 'integer', True, None, '', '', None],
                                           ['scheduled_at',
                                            'timestamp with time zone',
                                            True,
                                            None,
                                            '',
                                            '',
                                            None],
                                           ['status',
                                            'character varying(16)',
                                            True,
                                            None,
                                            '',
                                            '',
                                            '"default"'],
                                           ['error_code',
                                            'character varying(64)',
                                            True,
                                            None,
                                            '',
                                            '',
                                            '"default"'],
                                           ['created_at',
                                            'timestamp with time zone',
                                            True,
                                            None,
                                            '',
                                            '',
                                            None],
                                           ['completed_at',
                                            'timestamp with time zone',
                                            False,
                                            None,
                                            '',
                                            '',
                                            None]],
                               'constraints': [['ai_ding_run_status',
                                                'c',
                                                True,
                                                False,
                                                False,
                                                'CHECK-TREE ["atom","(status)::text = ANY '
                                                "(ARRAY['queued'::text, 'running'::text, 'ready'::text, "
                                                "'sending'::text, 'sent'::text, 'unknown'::text, "
                                                '\'denied\'::text, \'failed\'::text])"]'],
                                               ['ai_ding_schedule_slot_uq',
                                                'u',
                                                True,
                                                False,
                                                False,
                                                'UNIQUE (schedule_id, scheduled_at)'],
                                               ['ai_dingtalk_schedule_runs_pkey',
                                                'p',
                                                True,
                                                False,
                                                False,
                                                'PRIMARY KEY (id)'],
                                               ['ai_dingtalk_schedule_runs_schedule_version_check',
                                                'c',
                                                True,
                                                False,
                                                False,
                                                'CHECK-TREE ["atom","schedule_version >= 0"]'],
                                               ['ai_dingtalk_schedule_schedule_id_d1b30a18_fk_ai_dingta',
                                                'f',
                                                True,
                                                True,
                                                True,
                                                'FOREIGN KEY (schedule_id) REFERENCES '
                                                'ai_dingtalk_schedules(id) DEFERRABLE INITIALLY DEFERRED']],
                               'indexes': [['ai_ding_schedule_history',
                                            True,
                                            True,
                                            False,
                                            'CREATE INDEX ai_ding_schedule_history ON '
                                            'public.ai_dingtalk_schedule_runs USING btree (schedule_id, '
                                            'created_at)'],
                                           ['ai_ding_schedule_slot_uq',
                                            True,
                                            True,
                                            True,
                                            'CREATE UNIQUE INDEX ai_ding_schedule_slot_uq ON '
                                            'public.ai_dingtalk_schedule_runs USING btree (schedule_id, '
                                            'scheduled_at)'],
                                           ['ai_dingtalk_schedule_runs_id_b7c7ee51_like',
                                            True,
                                            True,
                                            False,
                                            'CREATE INDEX ai_dingtalk_schedule_runs_id_b7c7ee51_like ON '
                                            'public.ai_dingtalk_schedule_runs USING btree (id '
                                            'varchar_pattern_ops)'],
                                           ['ai_dingtalk_schedule_runs_pkey',
                                            True,
                                            True,
                                            True,
                                            'CREATE UNIQUE INDEX ai_dingtalk_schedule_runs_pkey ON '
                                            'public.ai_dingtalk_schedule_runs USING btree (id)'],
                                           ['ai_dingtalk_schedule_runs_schedule_id_d1b30a18',
                                            True,
                                            True,
                                            False,
                                            'CREATE INDEX ai_dingtalk_schedule_runs_schedule_id_d1b30a18 ON '
                                            'public.ai_dingtalk_schedule_runs USING btree (schedule_id)'],
                                           ['ai_dingtalk_schedule_runs_schedule_id_d1b30a18_like',
                                            True,
                                            True,
                                            False,
                                            'CREATE INDEX '
                                            'ai_dingtalk_schedule_runs_schedule_id_d1b30a18_like ON '
                                            'public.ai_dingtalk_schedule_runs USING btree (schedule_id '
                                            'varchar_pattern_ops)']],
                               'triggers': [['ai_immutable_identity',
                                             19,
                                             'O',
                                             'public',
                                             'ai_immutable_record_guard',
                                             '6964007363686564756c655f6964007363686564756c655f76657273696f6e007363686564756c65645f617400637265617465645f617400',
                                             'CREATE TRIGGER ai_immutable_identity BEFORE UPDATE ON '
                                             'public.ai_dingtalk_schedule_runs FOR EACH ROW EXECUTE FUNCTION '
                                             "ai_immutable_record_guard('id', 'schedule_id', "
                                             "'schedule_version', 'scheduled_at', 'created_at')"],
                                            ['ai_write_fence',
                                             31,
                                             'O',
                                             'public',
                                             'ai_runtime_write_fence',
                                             '',
                                             'CREATE TRIGGER ai_write_fence BEFORE INSERT OR DELETE OR '
                                             'UPDATE ON public.ai_dingtalk_schedule_runs FOR EACH ROW '
                                             'EXECUTE FUNCTION ai_runtime_write_fence()']],
                               'acl': [['OWNER', 'DELETE', False],
                                       ['OWNER', 'INSERT', False],
                                       ['OWNER', 'MAINTAIN', False],
                                       ['OWNER', 'REFERENCES', False],
                                       ['OWNER', 'SELECT', False],
                                       ['OWNER', 'TRIGGER', False],
                                       ['OWNER', 'TRUNCATE', False],
                                       ['OWNER', 'UPDATE', False],
                                       ['teruisi_ai_reader', 'SELECT', False],
                                       ['teruisi_ai_writer', 'INSERT', False],
                                       ['teruisi_ai_writer', 'SELECT', False],
                                       ['teruisi_ai_writer', 'UPDATE', False]],
                               'columnAcl': [],
                               'policies': []}}
REFERENCE_FUNCTIONS = {'functions': [['ai_immutable_record_guard',
                '',
                'trigger',
                'plpgsql',
                False,
                'v',
                ['search_path=pg_catalog, public'],
                'teruisi_sales_owner',
                '92545d64941248fa1fdb7eb0e3fbc29257300062db28680e44565102802f0dae'],
               ['ai_runtime_write_fence',
                '',
                'trigger',
                'plpgsql',
                False,
                'v',
                ['search_path=pg_catalog, public'],
                'teruisi_sales_owner',
                '1a6bc526c781b99db0252d43b56745a21112885f2252954dba201192e753bf49']],
 'acl': [['ai_immutable_record_guard', 'OWNER', 'EXECUTE', False],
         ['ai_immutable_record_guard', 'PUBLIC', 'EXECUTE', False],
         ['ai_runtime_write_fence', 'OWNER', 'EXECUTE', False],
         ['ai_runtime_write_fence', 'PUBLIC', 'EXECUTE', False]]}


def inspect_tables(cursor):
    from postgres_restore_semantics import normalize_dump_expression
    result = {}
    for table in COLUMNS:
        target = "public." + table
        cursor.execute("SELECT pg_get_userbyid(relowner),relkind,relpersistence,relrowsecurity,relforcerowsecurity "
                       "FROM pg_class WHERE oid=to_regclass(%s)", [target])
        identity = cursor.fetchone()
        cursor.execute("SELECT a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,"
                       "pg_get_expr(d.adbin,d.adrelid),a.attgenerated,a.attidentity,"
                       "CASE WHEN a.attcollation=0 THEN NULL ELSE a.attcollation::regcollation::text END "
                       "FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum "
                       "WHERE a.attrelid=to_regclass(%s) AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum", [target])
        columns = cursor.fetchall()
        cursor.execute("SELECT conname,contype,convalidated,condeferrable,condeferred,pg_get_constraintdef(oid) "
                       "FROM pg_constraint WHERE conrelid=to_regclass(%s) ORDER BY conname", [target])
        constraints = [(*row[:-1], normalize_dump_expression(row[-1])) for row in cursor.fetchall()]
        cursor.execute("SELECT c.relname,i.indisvalid,i.indisready,i.indisunique,pg_get_indexdef(i.indexrelid) "
                       "FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid=to_regclass(%s) ORDER BY c.relname", [target])
        indexes = cursor.fetchall()
        cursor.execute("SELECT t.tgname,t.tgtype,t.tgenabled,n.nspname,p.proname,encode(t.tgargs,'hex'),pg_get_triggerdef(t.oid) "
                       "FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace "
                       "WHERE t.tgrelid=to_regclass(%s) AND NOT t.tgisinternal ORDER BY t.tgname", [target])
        triggers = cursor.fetchall()
        cursor.execute("SELECT CASE WHEN a.grantee=c.relowner THEN 'OWNER' WHEN a.grantee=0 THEN 'PUBLIC' ELSE r.rolname END,"
                       "a.privilege_type,a.is_grantable FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a "
                       "LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE c.oid=to_regclass(%s) ORDER BY 1,2,3", [target])
        acl = cursor.fetchall()
        cursor.execute("SELECT t.attname,CASE WHEN a.grantee=c.relowner THEN 'OWNER' WHEN a.grantee=0 THEN 'PUBLIC' ELSE r.rolname END,"
                       "a.privilege_type,a.is_grantable FROM pg_attribute t JOIN pg_class c ON c.oid=t.attrelid "
                       "CROSS JOIN LATERAL aclexplode(t.attacl) a LEFT JOIN pg_roles r ON r.oid=a.grantee "
                       "WHERE c.oid=to_regclass(%s) AND t.attnum>0 AND NOT t.attisdropped ORDER BY 1,2,3,4", [target])
        column_acl = cursor.fetchall()
        cursor.execute("SELECT polname FROM pg_policy WHERE polrelid=to_regclass(%s) ORDER BY polname", [target])
        result[table] = {"identity": identity, "columns": columns, "constraints": constraints,
                         "indexes": indexes, "triggers": triggers, "acl": acl, "columnAcl": column_acl,
                         "policies": cursor.fetchall()}
    return result


def inspect_functions(cursor):
    cursor.execute("SELECT p.proname,pg_get_function_identity_arguments(p.oid),pg_get_function_result(p.oid),l.lanname,"
                   "p.prosecdef,p.provolatile,p.proconfig,pg_get_userbyid(p.proowner),"
                   "encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "
                   "JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname='public' AND p.proname IN "
                   "('ai_runtime_write_fence','ai_immutable_record_guard') ORDER BY p.proname,2")
    functions = cursor.fetchall()
    cursor.execute("SELECT p.proname,CASE WHEN a.grantee=p.proowner THEN 'OWNER' WHEN a.grantee=0 THEN 'PUBLIC' ELSE r.rolname END,"
                   "a.privilege_type,a.is_grantable FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "
                   "CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee "
                   "WHERE n.nspname='public' AND p.proname IN ('ai_runtime_write_fence','ai_immutable_record_guard') ORDER BY 1,2,3,4")
    return {"functions": functions, "acl": cursor.fetchall()}
# PostgreSQL 17 pg_get_constraintdef output for the hash-pinned migration.
# Keep exact expressions: a renamed or weakened CHECK is not this generation.
CONSTRAINTS = {'ai_dingtalk_schedules': {'ai_schedule_execution_mode': "CHECK ((((execution_mode)::text = ANY ((ARRAY['open_analysis'::character varying, 'guangdong_monitor'::character varying])::text[])) AND (((execution_mode)::text = 'open_analysis'::text) OR ((content_type)::text = 'text'::text)) AND (octet_length(model_id) <= 200) AND (((content_type)::text = 'text'::text) OR (model_id = ''::text))))"}, 'ai_dingtalk_schedule_runs': {'ai_schedule_analysis_status': "CHECK (((analysis_status)::text = ANY ((ARRAY['pending'::character varying, 'running'::character varying, 'succeeded'::character varying, 'failed'::character varying, 'unknown'::character varying, 'not_required'::character varying])::text[])))", 'ai_schedule_artifacts_bound': "CHECK (((octet_length(model_snapshot_json) <= 8000) AND (jsonb_typeof((model_snapshot_json)::jsonb) = 'object'::text) AND (octet_length(facts_json) <= 160000) AND (jsonb_typeof((facts_json)::jsonb) = 'object'::text) AND (octet_length(stage_details_json) <= 8000) AND (jsonb_typeof((stage_details_json)::jsonb) = 'object'::text) AND (octet_length(content_text) <= 16000)))", 'ai_schedule_data_status': "CHECK (((data_status)::text = ANY ((ARRAY['pending'::character varying, 'running'::character varying, 'succeeded'::character varying, 'failed'::character varying, 'unknown'::character varying, 'not_required'::character varying])::text[])))", 'ai_schedule_delivery_status': "CHECK (((delivery_status)::text = ANY ((ARRAY['pending'::character varying, 'running'::character varying, 'succeeded'::character varying, 'failed'::character varying, 'unknown'::character varying, 'not_required'::character varying])::text[])))"}}


def constraint_rows(cursor, table):
    cursor.execute("SELECT conname,contype,convalidated,condeferrable,condeferred,pg_get_constraintdef(oid) "
                   "FROM pg_constraint WHERE conrelid=to_regclass(%s) AND conname LIKE 'ai_schedule_%%' ORDER BY conname",
                   ["public." + table])
    return cursor.fetchall()


def verify_catalog(cursor, *, installed):
    from postgres_restore_semantics import normalize_dump_expression
    if set(REFERENCE142) != set(COLUMNS) or not REFERENCE_FUNCTIONS:
        raise ValueError("AI schedule reference catalogue is not frozen")
    expected = copy.deepcopy(REFERENCE142)
    if installed:
        for table, columns in COLUMNS.items():
            for name, kind in columns.items():
                expected[table]["columns"].append([name, kind, True, None, "", "", '"default"'])
            expected[table]["constraints"] += [[name, "c", True, False, False, normalize_dump_expression(expression)]
                for name, expression in CONSTRAINTS[table].items()]
            expected[table]["constraints"].sort(key=lambda row: row[0])
    if json.loads(json.dumps(inspect_tables(cursor))) != expected:
        raise ValueError("AI schedule complete table schema, identity, guards or ACL differs")
    if json.loads(json.dumps(inspect_functions(cursor))) != REFERENCE_FUNCTIONS:
        raise ValueError("AI schedule trigger function body, identity or ACL differs")
    for table, columns in COLUMNS.items():
        cursor.execute("SELECT a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.atthasdef,"
                       "a.attgenerated,a.attidentity FROM pg_attribute a WHERE a.attrelid=to_regclass(%s) "
                       "AND NOT a.attisdropped AND a.attname=ANY(%s) ORDER BY a.attname",
                       ["public." + table, list(columns)])
        actual = cursor.fetchall()
        expected = sorted((name, kind, True, False, "", "") for name, kind in columns.items()) if installed else []
        if actual != expected:
            raise ValueError("AI schedule columns differ from the exact recorded generation")
        checks = [(*row[:-1], normalize_dump_expression(row[-1])) for row in constraint_rows(cursor, table)]
        expected_checks = [(name, "c", True, False, False, normalize_dump_expression(expression))
            for name, expression in sorted(CONSTRAINTS.get(table, {}).items())] if installed else []
        if checks != expected_checks or installed and not expected_checks:
            raise ValueError("AI schedule constraint semantics differ from the exact recorded generation")


def original_rows(connection):
    """Only original-column streaming hashes enter preservation evidence."""
    from django.db import transaction
    result = {}
    with transaction.atomic(using=connection.alias), connection.cursor() as cursor:
        for table, additions in COLUMNS.items():
            columns = [row[0] for row in REFERENCE142[table]["columns"]]
            if "id" not in columns or len(columns) > 100:
                raise ValueError("AI schedule preservation columns are not recognized")
            query = sql.SQL("SELECT sha256(convert_to(row_to_json(r)::text,'UTF8')) AS h FROM "
                            "(SELECT {} FROM {}) r ORDER BY h").format(
                sql.SQL(",").join(map(sql.Identifier, columns)), sql.Identifier("public", table))
            hasher, count = hashlib.sha256(), 0
            with connection.connection.cursor(name="schedule_" + uuid.uuid4().hex) as stream:
                stream.itersize = 512
                stream.execute(query)
                for (row_hash,) in stream:
                    if not isinstance(row_hash, bytes) or len(row_hash) != 32:
                        raise ValueError("Invalid AI schedule original-row digest")
                    hasher.update(row_hash)
                    count += 1
                    if count > 10_000_000:
                        raise ValueError("AI schedule preservation exceeds its reviewed bound")
            result[table] = {"columns": columns, "rows": count, "sha256": hasher.hexdigest()}
    return result


def verify_defaults(cursor):
    for table, defaults in {
        "ai_dingtalk_schedules": {"model_id": "", "execution_mode": "open_analysis"},
        "ai_dingtalk_schedule_runs": {**{name: "pending" for name in
            ("data_status", "analysis_status", "delivery_status")},
            "model_snapshot_json": "{}", "facts_json": "{}", "content_text": "", "stage_details_json": "{}"},
    }.items():
        condition = sql.SQL(" OR ").join(sql.SQL("{} IS DISTINCT FROM %s").format(sql.Identifier(name)) for name in defaults)
        cursor.execute(sql.SQL("SELECT EXISTS(SELECT 1 FROM {} WHERE {})").format(sql.Identifier("public", table), condition), list(defaults.values()))
        if cursor.fetchone() != (False,):
            raise ValueError("AI schedule new-column defaults differ after installation")
