#Requires -Version 5.1
# READ-ONLY probe: did sales.0012 apply? Is the partial index present?
# Creates nothing, changes nothing, never prints the password. ASCII-only on purpose.
# Output: migration-state-output.txt next to this script.
$ErrorActionPreference = 'Continue'
$out = Join-Path $PSScriptRoot 'migration-state-output.txt'
"=== start $(Get-Date -Format o) ===" | Set-Content -LiteralPath $out -Encoding UTF8

function Log([string]$text) {
  Write-Host $text
  Add-Content -LiteralPath $out -Value $text -Encoding UTF8
}

try {
  $credPath = 'D:\teruisi-runtime\django-sales\secrets\credentials.dpapi.json'
  $cred = Get-Content -LiteralPath $credPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $stored = [string]$cred.postgresSuperuser
  if ([string]::IsNullOrWhiteSpace($stored)) { throw 'postgresSuperuser missing' }
  $secure = ConvertTo-SecureString $stored
  $plain = [System.Management.Automation.PSCredential]::new('local', $secure).GetNetworkCredential().Password

  $psql = 'D:\teruisi-runtime\django-sales\postgresql-17.11\bin\psql.exe'
  if (-not (Test-Path -LiteralPath $psql)) { throw "psql not found: $psql" }

  $env:PGHOST = '127.0.0.1'
  $env:PGPORT = '5432'
  $env:PGDATABASE = 'teruisi_sales'
  $env:PGUSER = 'postgres'
  $env:PGPASSWORD = $plain
  $env:PGCLIENTENCODING = 'UTF8'
  $env:PGAPPNAME = 'teruisi_migration_state_readonly'
  # Read-only: Postgres itself refuses any write from this connection.
  $env:PGOPTIONS = '-c statement_timeout=60000 -c default_transaction_read_only=on'

  function Query([string]$label, [string]$sql) {
    Log ''
    Log "--- $label ---"
    $rows = & $psql -X -A -F '|' -t -v ON_ERROR_STOP=1 -c $sql 2>&1
    foreach ($r in $rows) { Log ([string]$r) }
  }

  Query 'target index present?' "select coalesce(to_regclass('public.sales_excluded_date_idx')::text,'ABSENT') as idx"

  Query 'if present: valid and ready?' @"
select i.indisvalid as is_valid, i.indisready as is_ready,
       pg_get_expr(i.indpred, i.indrelid) as predicate
from pg_index i join pg_class c on c.oid = i.indexrelid
where c.oid = to_regclass('public.sales_excluded_date_idx')
"@

  Query 'sales.0012 recorded in django_migrations?' @"
select count(*) as recorded from django_migrations
where app = 'sales' and name = '0012_excluded_business_date_index'
"@

  Query 'total django_migrations (153 before, 154 after)' "select count(*) as total from django_migrations"

  Query 'last 3 sales migrations' @"
select name, applied from django_migrations where app = 'sales' order by id desc limit 3
"@

  Query 'any invalid index on the table?' @"
select c.relname, i.indisvalid, i.indisready
from pg_index i join pg_class c on c.oid = i.indexrelid
where i.indrelid = to_regclass('public.sales_order_lines')
  and (i.indisvalid = false or i.indisready = false)
"@

  Log ''
  Log '=== done (read-only, nothing changed) ==='
}
catch {
  Log ''
  Log '=== FAILED ==='
  Log ("type: " + $_.Exception.GetType().FullName)
  Log ("message: " + $_.Exception.Message)
}
finally {
  foreach ($n in 'PGPASSWORD','PGHOST','PGPORT','PGDATABASE','PGUSER','PGOPTIONS','PGAPPNAME','PGCLIENTENCODING') {
    Remove-Item -Path ("Env:" + $n) -ErrorAction SilentlyContinue
  }
  Log ''
  Log "output saved: $out"
  Read-Host 'Press Enter to close'
}
