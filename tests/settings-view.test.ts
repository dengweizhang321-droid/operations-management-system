import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { canEditOperatingSettings, nextSettingsTab } from "../app/settings-view";

const source = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("settings tabs implement deterministic automatic-activation roving", () => {
  assert.equal(nextSettingsTab("parameters", "ArrowRight"), "master");
  assert.equal(nextSettingsTab("parameters", "ArrowLeft"), "permissions");
  assert.equal(nextSettingsTab("permissions", "ArrowRight"), "parameters");
  assert.equal(nextSettingsTab("master", "ArrowDown"), "permissions");
  assert.equal(nextSettingsTab("master", "ArrowUp"), "parameters");
  assert.equal(nextSettingsTab("master", "Home"), "parameters");
  assert.equal(nextSettingsTab("master", "End"), "permissions");
  assert.equal(nextSettingsTab("master", "Enter"), null);
});

test("only administrators can edit operating settings", async () => {
  assert.equal(canEditOperatingSettings({ role: "admin" }), true);
  assert.equal(canEditOperatingSettings({ role: "operator" }), false);
  assert.equal(canEditOperatingSettings({ role: "viewer" }), false);
  assert.equal(canEditOperatingSettings({ role: "analyst" }), false);
  assert.equal(canEditOperatingSettings(null), false);

  const settings = await source("../app/settings-view.tsx");
  assert.match(settings, /if \(!canEdit \|\| !settings \|\| saving\) return;/);
  assert.match(settings, /<input[^>]+disabled=\{!canEdit\}/);
  assert.match(settings, /role="switch"[\s\S]*?disabled=\{!canEdit\}/);
  assert.match(settings, /disabled=\{!canEdit \|\| saving \|\| settingsState === "loading"\}/);
  assert.match(settings, /当前为只读模式/);
  assert.match(settings, /仅管理员可修改并保存系统设置/);
});

test("market settings code is lazy and mounted only by the master tab", async () => {
  const settings = await source("../app/settings-view.tsx");
  assert.doesNotMatch(settings, /^import .* from "\.\/market-view"/m);
  assert.doesNotMatch(settings, /^import .* from "\.\/market-annotation-view"/m);
  assert.match(settings, /createReloadableLazy\("settings", \(\) => import\("\.\/market-master-admin-panel"\)\)/);
  assert.match(settings, /createReloadableLazy<Market(?:DataImport|Workflow)PanelProps>\("settings", \(\) => import\("\.\/market-view"\)/);
  assert.match(settings, /createReloadableLazy\("settings", \(\) => import\("\.\/market-annotation-view"\)\)/);
  assert.match(settings, /activeTab === "master" && <section[\s\S]*?<Suspense/);
  assert.match(settings, /<LazyMarketMasterAdminPanel/);
  assert.match(settings, /<LazyMarketDataImportPanel/);
  assert.match(settings, /<LazyMarketWorkflowPanel/);
  assert.match(settings, /<LazyMarketAnnotationView/);
  assert.match(settings, /if \(activeTab !== "master"\) return;[\s\S]*?loadMarketOverview/);
  assert.match(settings, /fetch\("\/api\/market\/overview", \{ cache: "no-store", signal: controller\.signal \}\)/);
});

test("settings and market requests abort superseded work and reject late responses", async () => {
  const settings = await source("../app/settings-view.tsx");
  assert.match(settings, /settingsControllerRef\.current\?\.abort\(\)/);
  assert.match(settings, /generation !== settingsGenerationRef\.current \|\| controller\.signal\.aborted/);
  assert.match(settings, /fetch\("\/api\/settings", \{ cache: "no-store", signal: controller\.signal \}\)/);
  assert.match(settings, /method: "PUT",[\s\S]*?signal: controller\.signal/);
  assert.match(settings, /generation !== saveGenerationRef\.current \|\| controller\.signal\.aborted/);
  assert.match(settings, /marketControllerRef\.current\?\.abort\(\)/);
  assert.match(settings, /generation !== marketGenerationRef\.current \|\| controller\.signal\.aborted/);
  assert.match(settings, /系统设置加载失败/);
  assert.match(settings, />重新加载<\/button>/);
  assert.match(settings, /市场主数据加载失败/);
});

test("settings tab and panel semantics are linked and keyboard operable", async () => {
  const settings = await source("../app/settings-view.tsx");
  assert.match(settings, /role="tablist" aria-label="系统设置工作区"/);
  assert.match(settings, /role="tab"/);
  assert.match(settings, /aria-selected=\{activeTab === tab\}/);
  assert.match(settings, /tabIndex=\{activeTab === tab \? 0 : -1\}/);
  assert.match(settings, /onKeyDown=\{\(event\) => handleTabKeyDown\(event, tab\)\}/);
  assert.match(settings, /role="tabpanel"/);
  assert.match(settings, /aria-labelledby="settings-tab-parameters"/);
  assert.match(settings, /aria-labelledby="settings-tab-master"/);
  assert.match(settings, /aria-labelledby="settings-tab-permissions"/);
  assert.match(settings, /role="switch"/);
  assert.match(settings, /aria-checked=\{settings\[key\]\}/);
});

test("page lazy-loads the extracted settings implementation", async () => {
  const page = await source("../app/page.tsx");
  assert.doesNotMatch(page, /function SettingsView\(/);
  assert.match(page, /Component: SettingsView \} = createReloadableLazy\("settings", \(\) => import\("\.\/settings-view"\)\)/);
  assert.match(page, /settings: \([^\n]+<SettingsView/);
  assert.doesNotMatch(page, /type OperatingSettings =/);
  assert.doesNotMatch(page, /MarketMasterAdminPanel|MarketDataImportPanel|MarketWorkflowPanel|MarketAnnotationView/);
});
