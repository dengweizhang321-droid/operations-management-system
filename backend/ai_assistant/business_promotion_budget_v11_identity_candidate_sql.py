"""Disposable v11 identity v2 SQL for an isolated PostgreSQL test only.

There is intentionally no migration, credential loader, route, publisher or
application caller. The three candidate service identities start NOLOGIN.
The isolated role test alone may temporarily activate them with random test
passwords. This proves a narrow database capability, not full ORM preflight.
"""
from __future__ import annotations

import os
from importlib import import_module

from django.conf import settings


ATTEST = "teruisi_ai_budget_v11_attest_login"
SIGN = "teruisi_ai_budget_v11_sign_login"
PUBLISH = "teruisi_ai_budget_v11_publish_login"
ROLES = (ATTEST, SIGN, PUBLISH)
TABLE = "public.protected_business_budget_v11_proof_tickets_candidate"
ISSUE = "public.ai_budget_v11_issue_proof_ticket_v2(text,integer,text)"
READ = "public.ai_budget_v11_read_proof_ticket_v2(text,text,integer,text)"
VERIFY = "public.ai_budget_v11_verify_protected_receipt_v2(text,integer,text,text)"


ISSUE_SQL = r"""CREATE FUNCTION public.ai_budget_v11_issue_proof_ticket_v2(
  selected_run text,selected_attempt integer,selected_attestation_sha text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE parent public.ai_business_file_runs%ROWTYPE;
  proof public.ai_business_promotion_budget_v11_attestations%ROWTYPE;
  ticket_id uuid;
BEGIN
  IF session_user<>'teruisi_ai_budget_v11_attest_login'
     OR selected_run IS NULL OR selected_run !~ '^[A-Za-z0-9_-]{1,160}$'
     OR selected_attempt NOT BETWEEN 1 AND 5
     OR selected_attestation_sha !~ '^[0-9a-f]{64}$'
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
       WHERE r.rolname='teruisi_ai_budget_v11_attest_login'
         AND r.rolcanlogin AND NOT r.rolinherit AND NOT r.rolsuper
         AND NOT r.rolcreatedb AND NOT r.rolcreaterole
         AND NOT r.rolreplication AND NOT r.rolbypassrls)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m
       WHERE m.roleid='teruisi_ai_budget_v11_attest_login'::regrole
          OR m.member='teruisi_ai_budget_v11_attest_login'::regrole)
  THEN RAISE EXCEPTION 'ai_budget_v11_ticket_issuer_unavailable'; END IF;
  SELECT * INTO parent FROM public.ai_business_file_runs item
    WHERE item.id=selected_run FOR SHARE;
  SELECT * INTO proof FROM public.ai_business_promotion_budget_v11_attestations item
    WHERE item.run_id=selected_run AND item.attempt=selected_attempt FOR SHARE;
  IF parent.id IS NULL OR proof.id IS NULL OR parent.renderer_version<>11
     OR parent.draft OR parent.status<>'paused'
     OR parent.error_code<>'renderer_unpublished'
     OR parent.progress_json::jsonb IS DISTINCT FROM jsonb_build_object(
       'stage','staged_unpublished','attempt',selected_attempt)
     OR parent.attempt<>selected_attempt
     OR proof.attestation_sha256 IS DISTINCT FROM selected_attestation_sha
     OR proof.report_id IS DISTINCT FROM parent.report_id
     OR proof.owner_email IS DISTINCT FROM parent.owner_email
     OR proof.binding_digest IS DISTINCT FROM parent.binding_digest
     OR encode(sha256(convert_to(proof.attestation_json,'UTF8')),'hex')
        IS DISTINCT FROM selected_attestation_sha
     OR encode(sha256(convert_to(parent.manifest_json,'UTF8')),'hex')
        IS DISTINCT FROM proof.compact_json_sha256
  THEN RAISE EXCEPTION 'ai_budget_v11_ticket_proof_drift'; END IF;
  ticket_id:=gen_random_uuid();
  INSERT INTO public.protected_business_budget_v11_proof_tickets_candidate(
    id,run_id,attempt,parent_version,report_id,binding_digest,
    attestation_sha256,created_at,expires_at)
  VALUES(ticket_id,parent.id,parent.attempt,parent.version,parent.report_id,
    parent.binding_digest,selected_attestation_sha,clock_timestamp(),
    clock_timestamp()+interval '10 minutes');
  RETURN jsonb_build_object('schemaVersion','budget-v11-proof-ticket-v2',
    'ticketId',ticket_id::text,'runId',parent.id,'attempt',parent.attempt,
    'attestationSha256',selected_attestation_sha,'readyAuthorized',false);
END $$"""


READ_SQL = r"""CREATE FUNCTION public.ai_budget_v11_read_proof_ticket_v2(
  selected_ticket text,selected_run text,selected_attempt integer,
  selected_attestation_sha text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE parent public.ai_business_file_runs%ROWTYPE;
  ticket public.protected_business_budget_v11_proof_tickets_candidate%ROWTYPE;
  proof public.ai_business_promotion_budget_v11_attestations%ROWTYPE;
BEGIN
  IF session_user<>'teruisi_ai_budget_v11_sign_login'
     OR selected_ticket IS NULL OR selected_ticket !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR selected_run IS NULL OR selected_run !~ '^[A-Za-z0-9_-]{1,160}$'
     OR selected_attempt NOT BETWEEN 1 AND 5
     OR selected_attestation_sha !~ '^[0-9a-f]{64}$'
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
       WHERE r.rolname='teruisi_ai_budget_v11_sign_login'
         AND r.rolcanlogin AND NOT r.rolinherit AND NOT r.rolsuper
         AND NOT r.rolcreatedb AND NOT r.rolcreaterole
         AND NOT r.rolreplication AND NOT r.rolbypassrls)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m
       WHERE m.roleid='teruisi_ai_budget_v11_sign_login'::regrole
          OR m.member='teruisi_ai_budget_v11_sign_login'::regrole)
  THEN RAISE EXCEPTION 'ai_budget_v11_ticket_reader_unavailable'; END IF;
  SELECT * INTO parent FROM public.ai_business_file_runs item
    WHERE item.id=selected_run FOR SHARE;
  SELECT * INTO ticket FROM public.protected_business_budget_v11_proof_tickets_candidate item
    WHERE item.id=selected_ticket::uuid FOR UPDATE;
  SELECT * INTO proof FROM public.ai_business_promotion_budget_v11_attestations item
    WHERE item.run_id=selected_run AND item.attempt=selected_attempt FOR SHARE;
  IF parent.id IS NULL OR ticket.id IS NULL OR proof.id IS NULL
     OR parent.renderer_version<>11 OR parent.draft
     OR parent.status<>'paused' OR parent.error_code<>'renderer_unpublished'
     OR parent.progress_json::jsonb IS DISTINCT FROM jsonb_build_object(
       'stage','staged_unpublished','attempt',selected_attempt)
     OR ticket.run_id IS DISTINCT FROM selected_run
     OR ticket.attempt IS DISTINCT FROM selected_attempt
     OR ticket.parent_version IS DISTINCT FROM parent.version
     OR ticket.report_id IS DISTINCT FROM parent.report_id
     OR ticket.binding_digest IS DISTINCT FROM parent.binding_digest
     OR ticket.attestation_sha256 IS DISTINCT FROM selected_attestation_sha
     OR ticket.claimed_at IS NOT NULL OR ticket.expires_at<=clock_timestamp()
     OR proof.attestation_sha256 IS DISTINCT FROM selected_attestation_sha
     OR proof.report_id IS DISTINCT FROM parent.report_id
     OR proof.owner_email IS DISTINCT FROM parent.owner_email
     OR proof.binding_digest IS DISTINCT FROM parent.binding_digest
     OR encode(sha256(convert_to(proof.attestation_json,'UTF8')),'hex')
        IS DISTINCT FROM selected_attestation_sha
     OR encode(sha256(convert_to(parent.manifest_json,'UTF8')),'hex')
        IS DISTINCT FROM proof.compact_json_sha256
  THEN RAISE EXCEPTION 'ai_budget_v11_ticket_claim_invalid'; END IF;
  UPDATE public.protected_business_budget_v11_proof_tickets_candidate item
    SET claimed_at=clock_timestamp()
    WHERE item.id=ticket.id AND item.claimed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'ai_budget_v11_ticket_claim_conflict'; END IF;
  RETURN jsonb_build_object('schemaVersion','budget-v11-proof-read-v2',
    'ticketId',ticket.id::text,'runId',parent.id,'attempt',parent.attempt,
    'runVersion',parent.version,'reportId',parent.report_id,
    'ownerEmail',parent.owner_email,'bindingDigest',parent.binding_digest,
    'attestationId',proof.id,'attestationSha256',proof.attestation_sha256,
    'attestationText',proof.attestation_json,'readyAuthorized',false);
END $$"""


def verify_sql():
    """Version the exact 0068 verifier without altering its OID/body/ACL."""
    old = import_module(
        "ai_assistant.migrations.0068_business_promotion_budget_v11_verifier_receipt")
    return old.VERIFY.replace(
        "ai_budget_v11_verify_protected_receipt(",
        "ai_budget_v11_verify_protected_receipt_v2(", 1).replace(
        "session_user<>'teruisi_ai_budget_v11_publisher'",
        "session_user<>'teruisi_ai_budget_v11_publish_login'", 1).replace(
        "OR selected_run IS NULL",
        "OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE "
        "r.rolname='teruisi_ai_budget_v11_publish_login' AND r.rolcanlogin "
        "AND NOT r.rolinherit AND NOT r.rolsuper AND NOT r.rolcreatedb "
        "AND NOT r.rolcreaterole AND NOT r.rolreplication "
        "AND NOT r.rolbypassrls) OR EXISTS (SELECT 1 FROM "
        "pg_catalog.pg_auth_members m WHERE "
        "m.roleid='teruisi_ai_budget_v11_publish_login'::regrole "
        "OR m.member='teruisi_ai_budget_v11_publish_login'::regrole) "
        "OR selected_run IS NULL", 1)


def _isolated(connection):
    data = settings.DATABASES["default"]
    if (settings.DJANGO_ENVIRONMENT != "test" or
            data["HOST"] != "127.0.0.1" or
            str(data["PORT"]) != os.getenv("TERUISI_AI_REHEARSAL_PORT") or
            not 55440 <= int(data["PORT"]) <= 55999 or
            data["NAME"] != "test_teruisi_ai_rehearsal" or
            connection.vendor != "postgresql"):
        raise RuntimeError("v11 identity candidate only installs in isolated PG test")


def install_test_only(connection):
    """No migration calls this; roles remain NOLOGIN until a test opts in."""
    _isolated(connection)
    with connection.cursor() as cursor:
        for role in ROLES:
            cursor.execute("CREATE ROLE " + role + " NOLOGIN NOINHERIT "
                "NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS")
            cursor.execute("GRANT USAGE ON SCHEMA public TO " + role)
        cursor.execute("""CREATE TABLE public.protected_business_budget_v11_proof_tickets_candidate (
          id uuid PRIMARY KEY, run_id varchar(160) NOT NULL,
          attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 5),
          parent_version bigint NOT NULL, report_id varchar(160) NOT NULL,
          binding_digest varchar(64) NOT NULL,
          attestation_sha256 varchar(64) NOT NULL,
          created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
          claimed_at timestamptz,
          CONSTRAINT budget_v11_ticket_one_per_attempt UNIQUE (run_id,attempt)
        )""")
        cursor.execute("REVOKE ALL ON " + TABLE + " FROM PUBLIC")
        cursor.execute(ISSUE_SQL)
        cursor.execute(READ_SQL)
        cursor.execute(verify_sql())
        for signature, role in ((ISSUE, ATTEST), (READ, SIGN), (VERIFY, PUBLISH)):
            cursor.execute("REVOKE ALL ON FUNCTION " + signature + " FROM PUBLIC")
            cursor.execute("GRANT EXECUTE ON FUNCTION " + signature + " TO " + role)


def uninstall_test_only(connection):
    _isolated(connection)
    with connection.cursor() as cursor:
        for signature in (VERIFY, READ, ISSUE):
            cursor.execute("DROP FUNCTION IF EXISTS " + signature)
        cursor.execute("DROP TABLE IF EXISTS " + TABLE)
        for role in reversed(ROLES):
            cursor.execute("REVOKE USAGE ON SCHEMA public FROM " + role)
            cursor.execute("DROP ROLE IF EXISTS " + role)
