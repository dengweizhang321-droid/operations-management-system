import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeJdLogisticsLocation, buildJdLogisticsLocation, readJdLogisticsLocation } from "../lib/inventory/jd-logistics-contract";

const base = "/?module=inventory&view=inbound";
test("ERP/default/settings links resolve to POP product comparison before mounting a data view", () => {
  for (const suffix of ["", "&jdInbound=erp", "&jdInbound=pop&jdPopTab=settings", "&jdInbound=unknown"]) {
    const location = readJdLogisticsLocation(`${base}${suffix}&jdPage=40`);
    assert.equal(location.inbound, "pop"); assert.equal(location.tab, "mappings"); assert.equal(location.filters.page, 1);
    assert.doesNotMatch(canonicalizeJdLogisticsLocation(`${base}${suffix}`), /jdInbound=erp|jdPopTab=settings/);
  }
});

test("legacy POP flow/transfer links move to the corresponding C tab with fresh pagination", () => {
  for (const tab of ["flows", "transfers"] as const) {
    const url=canonicalizeJdLogisticsLocation(`${base}&jdInbound=pop&jdPopTab=${tab}&jdDepartment=D1&jdPage=20`);
    const location=readJdLogisticsLocation(url);
    assert.equal(location.inbound,"cwarehouse");assert.equal(location.cTab,tab);assert.equal(location.tab,tab);
    assert.equal(location.filters.departmentId,"D1");assert.equal(location.filters.page,1);assert.doesNotMatch(url,/jdPopTab=/);
  }
});

test("old batch link targets Data Import history while upload and records remain distinct", () => {
  const migrated = canonicalizeJdLogisticsLocation(`${base}&jdInbound=pop&jdPopTab=batches&jdPage=9`);
  const url=new URL(migrated,"http://localhost");
  assert.equal(url.searchParams.get("module"),"import");assert.equal(url.searchParams.get("view"),"history");assert.equal(url.searchParams.get("jdImport"),"logistics");
  const location=readJdLogisticsLocation(migrated);assert.equal(location.workspace,"import");assert.equal(location.importView,"history");assert.equal(location.tab,"batches");
  assert.equal(readJdLogisticsLocation("/?module=import&view=files&jdImport=logistics").importView,"files");
  assert.doesNotMatch(migrated,/jdInbound=|jdPopTab=/);
});

test("switching source or C data family clears incompatible scope, and history retains the old page", () => {
  const previous=`${base}&jdInbound=cwarehouse&jdCTab=flows&jdDepartment=D1&jdWarehouse=W1&jdStart=2026-10-01&jdEnd=2026-10-14&jdQuery=DOC&jdPage=20`;
  const pop=buildJdLogisticsLocation(previous,{inbound:"pop"});const location=readJdLogisticsLocation(pop);
  assert.equal(location.tab,"mappings");assert.equal(location.filters.page,1);assert.equal(location.filters.departmentId,"D1");
  assert.equal(location.filters.warehouseCode,"");assert.equal(location.filters.q,"");assert.equal(location.filters.startDate,"");
  assert.equal(readJdLogisticsLocation(previous).filters.page,20);
  const transfers=readJdLogisticsLocation(buildJdLogisticsLocation(previous,{cTab:"transfers"}));
  assert.equal(transfers.filters.page,1);assert.equal(transfers.filters.warehouseCode,"W1");assert.equal(transfers.filters.q,"DOC");
  const matrix=readJdLogisticsLocation(buildJdLogisticsLocation(previous,{cTab:"monitor"}));assert.equal(matrix.filters.page,1);assert.equal(matrix.filters.warehouseCode,"");assert.equal(matrix.filters.q,"");
});

test("canonical scoped pagination stays stable and unrelated module URLs remain unchanged", () => {
  const url=`${base}&jdInbound=pop&jdPopTab=mappings&jdDepartment=D1&jdPage=3`;
  assert.equal(readJdLogisticsLocation(canonicalizeJdLogisticsLocation(url)).filters.page,3);
  const filters={...readJdLogisticsLocation(url).filters,page:4,startDate:"2026-10-01",endDate:"2026-10-15",warehouseCode:"old-C"};
  assert.equal(readJdLogisticsLocation(buildJdLogisticsLocation(url,{filters})).filters.page,4);
  const unrelated="/?module=inventory&view=overview&jdInbound=erp&jdPopTab=flows&jdPage=7";
  assert.equal(canonicalizeJdLogisticsLocation(unrelated),unrelated);
  const monitor=readJdLogisticsLocation(canonicalizeJdLogisticsLocation(`${base}&jdInbound=cwarehouse&jdPopTab=flows&jdPage=9`));
  assert.equal(monitor.cTab,"monitor");assert.equal(monitor.filters.page,1);
});
