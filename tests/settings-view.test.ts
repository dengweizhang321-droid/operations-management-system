import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  canEditOperatingSettings,
  nextMarketSettingsPane,
  nextSettingsTab,
  marketStatusMatchesCurrentRequest,
  shouldLoadMarketSettingsStatus,
} from "../app/settings-view";

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

test("market settings panes implement deterministic automatic-activation roving", () => {
  assert.equal(nextMarketSettingsPane("master-data", "ArrowRight"), "imports");
  assert.equal(nextMarketSettingsPane("master-data", "ArrowLeft"), "annotation");
  assert.equal(nextMarketSettingsPane("imports", "ArrowDown"), "annotation");
  assert.equal(nextMarketSettingsPane("annotation", "ArrowRight"), "master-data");
  assert.equal(nextMarketSettingsPane("imports", "Home"), "master-data");
  assert.equal(nextMarketSettingsPane("imports", "End"), "annotation");
  assert.equal(nextMarketSettingsPane("imports", "Enter"), null);
});

test("market settings status is requested only for the import and task pane", () => {
  assert.equal(shouldLoadMarketSettingsStatus("master", "master-data"), false);
  assert.equal(shouldLoadMarketSettingsStatus("master", "annotation"), false);
  assert.equal(shouldLoadMarketSettingsStatus("parameters", "imports"), false);
  assert.equal(shouldLoadMarketSettingsStatus("permissions", "imports"), false);
  assert.equal(shouldLoadMarketSettingsStatus("master", "imports"), true);
});

test("market settings status belongs only to the current request and reload scope", () => {
  assert.equal(marketStatusMatchesCurrentRequest("request-2", "request-2", 2, 2), true);
  assert.equal(marketStatusMatchesCurrentRequest("", "", 2, 2), false);
  assert.equal(marketStatusMatchesCurrentRequest("request-2", "request-1", 2, 2), false);
  assert.equal(marketStatusMatchesCurrentRequest("request-2", "request-2", 1, 2), false);
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

test("market settings code is lazy and each internal pane mounts only its own work", async () => {
  const settings = await source("../app/settings-view.tsx");
  assert.doesNotMatch(settings, /^import .* from "\.\/market-view"/m);
  assert.doesNotMatch(settings, /^import .* from "\.\/market-annotation-view"/m);
  assert.match(settings, /createReloadableLazy\("settings", \(\) => import\("\.\/market-master-admin-panel"\)\)/);
  assert.match(settings, /createReloadableLazy<Market(?:DataImport|Workflow)PanelProps>\("settings", \(\) => import\("\.\/market-view"\)/);
  assert.match(settings, /createReloadableLazy\("settings", \(\) => import\("\.\/market-annotation-view"\)\)/);
  assert.match(settings, /useState<MarketSettingsPane>\("master-data"\)/);
  assert.match(settings, /marketPane === "master-data" && <section[\s\S]*?<LazyMarketMasterAdminPanel/);
  assert.match(settings, /marketPane === "imports" && <section[\s\S]*?<LazyMarketDataImportPanel[\s\S]*?<LazyMarketWorkflowPanel/);
  assert.match(settings, /marketPane === "annotation" && <section[\s\S]*?<LazyMarketAnnotationView/);
  assert.match(settings, /if \(!shouldLoadMarketSettingsStatus\(activeTab, marketPane\)\) \{[\s\S]*?invalidateMarketSettingsStatus\(\);[\s\S]*?return;[\s\S]*?loadMarketSettingsStatus\(reloadScope\)/);
  assert.match(settings, /fetch\("\/api\/market\/master\?view=settings_status", \{ cache: "no-store", signal: controller\.signal \}\)/);
  assert.doesNotMatch(settings, /fetch\("\/api\/market\/overview"/);
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
  assert.match(settings, /const requestKey = `market-settings:\$\{reloadScope\}:\$\{generation\}`/);
  const marketStatusLoader = settings.slice(
    settings.indexOf("const loadMarketSettingsStatus"),
    settings.indexOf("const invalidateMarketSettingsStatus"),
  );
  assert.doesNotMatch(marketStatusLoader, /setMarketData\(null\)/);
  assert.match(marketStatusLoader, /setMarketState\("loading"\);[\s\S]*?setMarketStatusRequestKey\(requestKey\)/);
  assert.match(settings, /setMarketData\(payload\);[\s\S]*?setMarketStatusScopeKey\(requestKey\);[\s\S]*?setMarketStatusReloadScope\(reloadScope\)/);
  assert.match(settings, /return \(\) => \{[\s\S]*?window\.clearTimeout\(timer\);[\s\S]*?invalidateMarketSettingsStatus\(\)/);
  assert.match(settings, /const currentMarketData = shouldLoadMarketSettingsStatus\(activeTab, marketPane\)[\s\S]*?marketStatusIsCurrent \|\| marketState === "loading" \|\| marketState === "error" \|\| marketStatusReloadScope < marketReloadKey/);
  assert.match(settings, /\{currentMarketData && <Suspense[\s\S]*?<LazyMarketDataImportPanel[^>]+data=\{currentMarketData\}[\s\S]*?<LazyMarketWorkflowPanel data=\{currentMarketData\}/);
  assert.doesNotMatch(settings, /<LazyMarketDataImportPanel[^>]+data=\{marketData\}/);
  assert.match(settings, /系统设置加载失败/);
  assert.match(settings, />重新加载<\/button>/);
  assert.match(settings, /导入与任务数据加载失败/);
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
  assert.match(settings, /role="tablist" aria-label="主数据与映射工作区"/);
  assert.match(settings, /aria-selected=\{marketPane === pane\}/);
  assert.match(settings, /aria-controls=\{`settings-master-panel-\$\{pane\}`\}/);
  assert.match(settings, /tabIndex=\{marketPane === pane \? 0 : -1\}/);
  assert.match(settings, /onKeyDown=\{\(event\) => handleMarketPaneKeyDown\(event, pane\)\}/);
  assert.match(settings, /aria-labelledby="settings-master-tab-master-data"/);
  assert.match(settings, /aria-labelledby="settings-master-tab-imports"/);
  assert.match(settings, /aria-labelledby="settings-master-tab-annotation"/);
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
