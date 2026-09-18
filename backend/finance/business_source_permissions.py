"""Candidate permission delta; not installed by production lifecycle yet."""
import re


def grant_actor_read(cursor, role="teruisi_finance_reader"):
    if type(role) is not str or re.fullmatch(r"[a-z][a-z0-9_]{0,62}", role) is None:
        raise ValueError("Invalid database role")
    cursor.execute(f'GRANT SELECT (email, role, status, scope, version) ON access_control_users TO "{role}"')
