import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("账号登录菜单显示 package.json 版本号",()=>{
  const page=readFileSync("app/page.tsx","utf8");
  const css=readFileSync("app/shell/top-navigation.css","utf8");
  assert.match(page,/import packageInfo from "\.\.\/package\.json"/);
  assert.match(page,/shell-account-version[^\n]*系统版本 v\{packageInfo\.version\}/);
  assert.match(css,/\.shell-account-version\s*\{/);
});
