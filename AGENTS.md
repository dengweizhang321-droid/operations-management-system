# Operations data connection

Before answering an operating-data question, read and follow [docs/OPERATIONS_DATA_QUERY.md](docs/OPERATIONS_DATA_QUERY.md). It defines the required source fallback, encoding, validation, metric, and response rules.

For questions about current TERUISI operating data, use the `teruisi_operations` MCP server instead of relying on memory or sample data.

- Start with `get_data_freshness`, then state the data cutoff date and filters used.
- Monetary fields are CNY cents unless the tool result says otherwise.
- This MCP connection is read-only: never claim to have imported data or created or changed a replenishment plan.
- Do not infer operational figures when a relevant MCP tool can be called.

# Git workflow

After completing each system optimization, create a focused Git commit and push it to the configured remote repository.
