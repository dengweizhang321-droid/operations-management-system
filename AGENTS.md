# Operations data connection

Before answering an operating-data question, read and follow [docs/OPERATIONS_DATA_QUERY.md](docs/OPERATIONS_DATA_QUERY.md). It defines the required source fallback, encoding, validation, metric, and response rules.

For questions about current TERUISI operating data, use the `teruisi_operations` MCP server instead of relying on memory or sample data.

- Start with `get_data_freshness`, then state the data cutoff date and filters used.
- Monetary fields are CNY cents unless the tool result says otherwise.
- This MCP connection is read-only: never claim to have imported data or created or changed a replenishment plan.
- Do not infer operational figures when a relevant MCP tool can be called.

# Git workflow

After completing each system optimization, create a focused Git commit and push it to the configured remote repository.

# Central AI tool registry

- All system queries or capabilities intended for AI use must be declared exactly once in `lib/ai/tool-registry.ts`. Each registry entry must include a stable name, title, precise description, object JSON schema with `additionalProperties: false`, allowed roles, an explicit read-only/write/dangerous risk marker, annotations, a bounded handler, and audit coverage.
- Adding a business module must also add a bounded read-only retrieval tool when its data should be searchable by AI, and register that tool in the central registry. The registry automatically drives model-provider schemas, the discoverable tool API, execution routing, permission checks, and audits.
- Never expose arbitrary SQL, database tables, application routes, or API handlers automatically. Only explicitly allowlisted, parameterized handlers may enter the registry; enforce field allowlists, server-side limits, and data-scope/role checks.
- Model-supplied identity or role claims are untrusted. Tool visibility and execution authorization must use the authenticated application principal, and every execution must audit the real actor, surface, request ID, summarized arguments, status, row count, duration, response digest, and error code without exposing secrets.
- Tests for every registry change must prove unique and complete entries, matching OpenAI/Anthropic schemas and handlers, role filtering, bounded results/calls, and synchronized registry/catalog/execution behavior. A new handler that is absent from the registry, or a registry schema without a callable handler, is a failing change.
