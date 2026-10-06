import assert from "node:assert/strict";
import test from "node:test";
import { customerServiceDownloadKind, customerServiceExportCount } from "../tools/jd-customer-service-export";
test("导出确认要求唯一正整数行数", () => {
  assert.equal(customerServiceExportCount("导出数据共计6998条，是否确认导出？"), 6998);
  for (const value of ["导出数据共计0条，是否确认导出？", "导出数据共计100001条，是否确认导出？", "确认导出全部？"])
    assert.throws(() => customerServiceExportCount(value), /EXPORT_COUNT_INVALID/);
});
test("下载链接精确限定京东源、路径和视图文件类型", () => {
  assert.equal(customerServiceDownloadKind("https://storage.jd.com/im-data-web.common/fixture.xlsx?Expires=1", "list"), ".xlsx");
  assert.equal(customerServiceDownloadKind("https://storage.jd.com/im-data-web.common/fixture.log", "messages"), ".log");
  for (const url of [
    "http://storage.jd.com/im-data-web.common/fixture.xlsx",
    "https://storage.jd.com.attacker.invalid/im-data-web.common/fixture.xlsx",
    "https://user@storage.jd.com/im-data-web.common/fixture.xlsx",
    "https://storage.jd.com/im-data-web.common/fixture.log",
    "https://storage.jd.com/another-prefix/fixture.xlsx",
    "https://storage.jd.com:8443/im-data-web.common/fixture.xlsx",
  ]) assert.throws(() => customerServiceDownloadKind(url, "list"), /DOWNLOAD_LINK_INVALID/);
});
