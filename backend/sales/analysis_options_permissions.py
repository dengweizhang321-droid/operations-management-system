"""Minimal additional runtime grants for ERP options and the subdivision edit overlay; no sales fact write grants."""
from psycopg import sql

TABLES = ("sales_analysis_options", "sales_analysis_options_state")
USER_COLUMNS = ("email", "role", "status", "scope", "version")
SUBDIVISION_TABLES = ("sales_subdivision_labels", "sales_product_subdivision_overrides")


def provision(cursor, *, reader="teruisi_sales_reader", writer="teruisi_sales_writer"):
    for role in (reader, writer):
        cursor.execute(sql.SQL("GRANT SELECT ON {} TO {}").format(sql.SQL(',').join(map(sql.Identifier,TABLES)),sql.Identifier(role)))
        cursor.execute(sql.SQL("GRANT SELECT ({}) ON access_control_users TO {}").format(sql.SQL(',').join(map(sql.Identifier,USER_COLUMNS)),sql.Identifier(role)))
    cursor.execute(sql.SQL("GRANT INSERT, UPDATE, DELETE ON sales_analysis_options TO {}").format(sql.Identifier(writer)))
    cursor.execute(sql.SQL("GRANT UPDATE ON sales_analysis_options_state TO {}").format(sql.Identifier(writer)))
    cursor.execute("SELECT pg_get_serial_sequence('public.sales_analysis_options','id')")
    sequence=cursor.fetchone()[0]
    if sequence:
        cursor.execute(sql.SQL("GRANT USAGE ON SEQUENCE {} TO {}").format(sql.Identifier(*sequence.split('.')),sql.Identifier(writer)))
    provision_subdivisions(cursor, reader=reader, writer=writer)


def provision_subdivisions(cursor, *, reader="teruisi_sales_reader", writer="teruisi_sales_writer"):
    """Reader sees both overlay tables; only the writer edits them, never the static map."""
    for role in (reader, writer):
        cursor.execute(sql.SQL("GRANT SELECT ON {} TO {}").format(sql.SQL(',').join(map(sql.Identifier,SUBDIVISION_TABLES)),sql.Identifier(role)))
    cursor.execute(sql.SQL("GRANT INSERT, UPDATE ON sales_subdivision_labels TO {}").format(sql.Identifier(writer)))
    cursor.execute(sql.SQL("GRANT INSERT, UPDATE, DELETE ON sales_product_subdivision_overrides TO {}").format(sql.Identifier(writer)))
    cursor.execute("SELECT pg_get_serial_sequence('public.sales_subdivision_labels','id')")
    sequence=cursor.fetchone()[0]
    if sequence:
        cursor.execute(sql.SQL("GRANT USAGE ON SEQUENCE {} TO {}").format(sql.Identifier(*sequence.split('.')),sql.Identifier(writer)))
