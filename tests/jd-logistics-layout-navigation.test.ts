import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeJdLogisticsLocation, buildJdLogisticsLocation, readJdLogisticsLocation } from "../lib/inventory/jd-logistics-contract";

const base = "/?module=inventory&view=inbound";

test("default and removed ERP entry resolve to inventory monitor before mounting a data view", () => {
  for (const suffix of ["", "&jdInbound=erp", "&jdInbound=unknown", "&jdTab=unknown"]) {
    const url = canonicalizeJdLogisticsLocation(`${base}${suffix}&jdPage=40`);
    const location = readJdLogisticsLocation(url);
    assert.equal(location.jdTab, "monitor"); assert.equal(location.filters.page, 1);
    assert.doesNotMatch(url, /jdInbound=|jdPopTab=|jdCTab=/);
    assert.equal(canonicalizeJdLogisticsLocation(url), url);
  }
});

test("legacy POP and C links map to four direct tabs, with fresh pagination", () => {
  const cases = [
    ["jdInbound=pop&jdPopTab=mappings", "mappings"],
    ["jdInbound=pop", "mappings"],
    ["jdInbound=pop&jdPopTab=settings", "mappings"],
    ["jdPopTab=flows", "flows"], ["jdPopTab=transfers", "transfers"],
    ["jdInbound=cwarehouse", "monitor"],
    ["jdInbound=cwarehouse&jdCTab=flows", "flows"],
    ["jdInbound=cwarehouse&jdCTab=transfers", "transfers"],
    ["jdInbound=cwarehouse&jdPopTab=flows", "monitor"],
    ["jdTab=mappings&jdInbound=cwarehouse&jdCTab=flows", "mappings"],
  ];
  for (const [legacy, tab] of cases) {
    const url = canonicalizeJdLogisticsLocation(`${base}&${legacy}&jdDepartment=D1&jdPage=20`);
    const location = readJdLogisticsLocation(url);
    assert.equal(location.jdTab, tab); assert.equal(location.filters.page, 1);
    assert.equal(location.filters.departmentId, "D1"); assert.doesNotMatch(url, /jdInbound=|jdPopTab=|jdCTab=/);
  }
});

test("old batch link remains in Data Import history while uploads and records stay distinct", () => {
  const migrated = canonicalizeJdLogisticsLocation(`${base}&jdInbound=pop&jdPopTab=batches&jdPage=9`);
  const url = new URL(migrated, "http://localhost");
  assert.equal(url.searchParams.get("module"), "import"); assert.equal(url.searchParams.get("view"), "history"); assert.equal(url.searchParams.get("jdImport"), "logistics");
  const location = readJdLogisticsLocation(migrated);
  assert.equal(location.workspace, "import"); assert.equal(location.importView, "history"); assert.equal(location.tab, "batches"); assert.equal(location.filters.page, 1);
  assert.equal(readJdLogisticsLocation("/?module=import&view=files&jdImport=logistics").importView, "files");
  assert.doesNotMatch(migrated, /jdTab=|jdInbound=|jdPopTab=|jdCTab=/);
});

test("switching direct tabs clears incompatible scope, while ledger tabs share filters", () => {
  const previous = `${base}&jdTab=flows&jdDepartment=D1&jdWarehouse=W1&jdStart=2026-10-01&jdEnd=2026-10-14&jdQuery=DOC&jdPage=20`;
  for (const jdTab of ["mappings", "monitor"] as const) {
    const next = readJdLogisticsLocation(buildJdLogisticsLocation(previous, { jdTab }));
    assert.equal(next.jdTab, jdTab); assert.equal(next.filters.page, 1); assert.equal(next.filters.departmentId, "D1");
    assert.equal(next.filters.warehouseCode, ""); assert.equal(next.filters.q, ""); assert.equal(next.filters.startDate, ""); assert.equal(next.filters.endDate, "");
  }
  const transfers = readJdLogisticsLocation(buildJdLogisticsLocation(previous, { jdTab: "transfers" }));
  assert.equal(transfers.filters.page, 1); assert.equal(transfers.filters.warehouseCode, "W1"); assert.equal(transfers.filters.q, "DOC"); assert.equal(transfers.filters.startDate, "2026-10-01");
  assert.equal(readJdLogisticsLocation(previous).filters.page, 20);
  assert.equal(buildJdLogisticsLocation(previous, { jdTab: "flows" }), previous);
});

test("canonical pagination and browser history restores the original scoped page", () => {
  for (const jdTab of ["monitor", "mappings", "flows", "transfers"] as const) {
    const original = `${base}&jdTab=${jdTab}&jdDepartment=D1&jdPage=3`;
    assert.equal(canonicalizeJdLogisticsLocation(original), original);
    const next = buildJdLogisticsLocation(original, { jdTab: jdTab === "monitor" ? "mappings" : "monitor" });
    assert.equal(readJdLogisticsLocation(next).filters.page, 1);
    assert.equal(readJdLogisticsLocation(original).filters.page, 3);
  }
  const mappings = `${base}&jdTab=mappings&jdDepartment=D1&jdPage=3`;
  const filters = { ...readJdLogisticsLocation(mappings).filters, page: 4, startDate: "2026-10-01", endDate: "2026-10-15", warehouseCode: "old-C" };
  const next = readJdLogisticsLocation(buildJdLogisticsLocation(mappings, { filters }));
  assert.equal(next.filters.page, 4); assert.equal(next.filters.warehouseCode, ""); assert.equal(next.filters.startDate, "");
  const records = "/?module=import&view=history&jdImport=logistics&jdDepartment=D1&jdPage=3";
  assert.equal(canonicalizeJdLogisticsLocation(records), records); assert.equal(readJdLogisticsLocation(records).filters.page, 3);
  const unrelated = "/?module=inventory&view=overview&jdInbound=erp&jdPopTab=flows&jdPage=7";
  assert.equal(canonicalizeJdLogisticsLocation(unrelated), unrelated);
});
