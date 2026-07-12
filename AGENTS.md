# Operations data connection

For questions about current TERUISI operating data, use the `teruisi_operations` MCP server instead of relying on memory or sample data.

- Start with `get_data_freshness`, then state the data cutoff date and filters used.
- Monetary fields are CNY cents unless the tool result says otherwise.
- This MCP connection is read-only: never claim to have imported data or created or changed a replenishment plan.
- Do not infer operational figures when a relevant MCP tool can be called.
