const message = [
  "Blocked: ordinary Drizzle migration generation is disabled after the sales-domain retirement contract.",
  "Migration 0092_sales_domain_retirement.sql is operator-only; 0093_finance_write_authority.sql is operator-only; both are intentionally excluded from the Drizzle journal.",
  "Create an audited post-retirement schema baseline before enabling drizzle-kit generate again.",
].join(" ");

console.error(message);
process.exitCode = 1;
