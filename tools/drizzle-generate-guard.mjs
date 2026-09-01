const message = [
  "Blocked: ordinary Drizzle migration generation is disabled after the sales-domain retirement contract.",
  "Migration 0092_sales_domain_retirement.sql is operator-only; migrations 0093_finance_write_authority.sql, 0094_netshop_write_authority.sql, 0095_market_netshop_projection.sql, 0096_netshop_domain_retirement.sql, 0097_market_write_authority.sql, 0098_market_domain_retirement.sql, 0099_product_write_authority.sql, and 0100_product_domain_retirement.sql are operator-only; all are intentionally excluded from the Drizzle journal.",
  "Create an audited post-retirement schema baseline before enabling drizzle-kit generate again.",
].join(" ");

console.error(message);
process.exitCode = 1;
