CREATE TABLE IF NOT EXISTS operation_runs (
  id TEXT PRIMARY KEY NOT NULL,
  trace_id TEXT NOT NULL,
  parent_run_id TEXT,
  run_type TEXT NOT NULL,
  surface TEXT NOT NULL,
  actor_email TEXT NOT NULL DEFAULT '',
  actor_role TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  shop_name TEXT NOT NULL DEFAULT '',
  dataset TEXT NOT NULL DEFAULT '',
  scope_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  error_code TEXT NOT NULL DEFAULT '',
  summary_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  heartbeat_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS operation_runs_idempotency_uq
  ON operation_runs (run_type, idempotency_key)
  WHERE idempotency_key <> '';

CREATE INDEX IF NOT EXISTS operation_runs_status_updated_idx
  ON operation_runs (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS operation_runs_trace_idx
  ON operation_runs (trace_id, created_at);

CREATE INDEX IF NOT EXISTS operation_runs_scope_idx
  ON operation_runs (platform, shop_name, dataset, created_at DESC);

CREATE TABLE IF NOT EXISTS operation_steps (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL UNIQUE,
  parent_span_id TEXT,
  step_type TEXT NOT NULL,
  step_key TEXT NOT NULL,
  attempt_no INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled', 'skipped')),
  error_code TEXT NOT NULL DEFAULT '',
  attributes_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  heartbeat_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (run_id, step_key, attempt_no),
  FOREIGN KEY (run_id) REFERENCES operation_runs(id)
);

CREATE INDEX IF NOT EXISTS operation_steps_run_created_idx
  ON operation_steps (run_id, created_at);

CREATE INDEX IF NOT EXISTS operation_steps_type_status_idx
  ON operation_steps (step_type, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS operation_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  run_id TEXT NOT NULL,
  step_id TEXT,
  trace_id TEXT NOT NULL,
  span_id TEXT,
  parent_span_id TEXT,
  event_type TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warning', 'error')),
  stage TEXT NOT NULL DEFAULT '',
  attributes_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES operation_runs(id),
  FOREIGN KEY (step_id) REFERENCES operation_steps(id)
);

CREATE INDEX IF NOT EXISTS operation_events_run_sequence_idx
  ON operation_events (run_id, sequence);

CREATE INDEX IF NOT EXISTS operation_events_trace_sequence_idx
  ON operation_events (trace_id, sequence);

CREATE TABLE IF NOT EXISTS ai_model_runtime_health (
  model_id TEXT PRIMARY KEY NOT NULL,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  circuit_open_until TEXT,
  last_failure_code TEXT NOT NULL DEFAULT '',
  last_failure_at TEXT,
  last_success_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ai_model_runtime_health_circuit_idx
  ON ai_model_runtime_health (circuit_open_until, updated_at);
