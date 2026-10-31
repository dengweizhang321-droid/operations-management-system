#Requires -Version 5.1
# READ-ONLY: do the seven Pi153 tables have an "id" column, and what is their
# primary key? preservation() sorts every one of them by "id"; if a table has a
# different key, that ORDER BY fails and the Install step dies before touching
# anything. Creates nothing, changes nothing, never prints the password.
# ASCII-only on purpose (PowerShell 5.1 GBK trap).
$ErrorActionPreference = 'Continue'
$out = Join-Path $PSScriptRoot 'table-key-output.txt'
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
  $env:PGAPPNAME = 'teruisi_table_key_readonly'
  $env:PGOPTIONS = '-c statement_timeout=60000 -c default_transaction_read_only=on'

  function Query([string]$label, [string]$sql) {
    Log ''
    Log "--- $label ---"
    $rows = & $psql -X -A -F '|' -t -v ON_ERROR_STOP=1 -c $sql 2>&1
    foreach ($r in $rows) { Log ([string]$r) }
  }

  Query 'does each table have an id column? (table|has_id)' @"
with t(name) as (values ('ai_pi_native_states'),('ai_pi_agents'),('ai_pi_plan_revisions'),
  ('ai_pi_agent_messages'),('ai_pi_agent_waits'),('ai_pi_file_handoffs'),('ai_pi_business_delegations'))
select t.name,
  case when to_regclass('public.'||t.name) is null then 'TABLE MISSING'
       when exists (select 1 from pg_attribute a where a.attrelid=to_regclass('public.'||t.name)
                      and a.attname='id' and a.attnum>0 and not a.attisdropped) then 'has id'
       else 'NO ID COLUMN' end
from t order by t.name
"@

  Query 'primary key of each table (table|pk columns)' @"
with t(name) as (values ('ai_pi_native_states'),('ai_pi_agents'),('ai_pi_plan_revisions'),
  ('ai_pi_agent_messages'),('ai_pi_agent_waits'),('ai_pi_file_handoffs'),('ai_pi_business_delegations'))
select t.name, coalesce((
  select string_agg(a.attname, ',' order by k.ord)
  from pg_index i
  join unnest(i.indkey) with ordinality k(num,ord) on true
  join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.num
  where i.indrelid=to_regclass('public.'||t.name) and i.indisprimary), 'NO PRIMARY KEY')
from t order by t.name
"@

  Query 'all columns of ai_pi_agents' @"
select a.attnum, a.attname, format_type(a.atttypid,a.atttypmod)
from pg_attribute a
where a.attrelid=to_regclass('public.ai_pi_agents') and a.attnum>0 and not a.attisdropped
order by a.attnum
"@

  Query 'row counts (small tables, safe to count)' @"
select 'ai_pi_agents' as t, count(*) from ai_pi_agents
union all select 'ai_pi_native_states', count(*) from ai_pi_native_states
union all select 'ai_pi_plan_revisions', count(*) from ai_pi_plan_revisions
union all select 'ai_pi_agent_messages', count(*) from ai_pi_agent_messages
union all select 'ai_pi_agent_waits', count(*) from ai_pi_agent_waits
union all select 'ai_pi_file_handoffs', count(*) from ai_pi_file_handoffs
union all select 'ai_pi_business_delegations', count(*) from ai_pi_business_delegations
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
