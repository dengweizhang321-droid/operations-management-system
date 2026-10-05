import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { readModuleViewSelection } from "../app/shell/use-module-view-state";
import { moduleViewCatalog } from "../app/shell/navigation-catalog";
import { parseShellLocation, updateModuleViewLocation } from "../app/shell/navigation-contract";

const pagePath = new URL("../app/page.tsx", import.meta.url);
const hookPath = new URL("../app/shell/use-module-view-state.ts", import.meta.url);

test("module view hook reads canonical, legacy, and invalid browser locations safely", () => {
  assert.deepEqual(readModuleViewSelection("/?module=shop&view=promotion"), {
    module: "shop",
    view: "promotion",
  });
  assert.deepEqual(readModuleViewSelection("/?module=sales&salesTab=category"), {
    module: "sales",
    view: "category",
  });
  assert.deepEqual(readModuleViewSelection("/?module=inventory&view=category"), {
    module: "inventory",
    view: "overview",
  });
});

test("controlled hook owns refresh, popstate, and pushState synchronization", async () => {
  const source = await readFile(hookPath, "utf8");
  assert.match(source, /useState<ModuleViewSelection>/);
  assert.match(source, /syncFromLocation\(\)/);
  assert.match(source, /addEventListener\("popstate"/);
  assert.match(source, /removeEventListener\("popstate"/);
  assert.match(source, /history\.pushState/);
  assert.match(source, /normalizeShellLocation/);
  assert.match(source, /updateModuleViewLocation/);
});

test("page modules consume one controlled view and route tab clicks through the shell", async () => {
  const [source, ...moduleSources] = await Promise.all([
    readFile(pagePath, "utf8"),
    ...["shop", "sales", "inventory", "product", "import"].map((name) => readFile(new URL(`../app/${name}-module-view.tsx`, import.meta.url), "utf8")),
  ]);
  assert.match(source, /useModuleViewState\(\)/);
  assert.match(source, /syncModuleViewFromLocation\(window\.location\.href\)/);
  assert.match(source, /moduleView=\{activeModuleView\}/);
  assert.match(source, /onModuleViewChange=\{selectModuleView\}/);
  assert.match(source, /resetKey=\{`\$\{active\}:\$\{activeModuleView\}:/);
  assert.doesNotMatch(source, /["']salesTab["']/);

  for (const [index, moduleName] of ["ShopView", "SalesView", "InventoryView", "ProductView", "ImportView"].entries()) {
    const declaration = new RegExp(`export default function ${moduleName}\\([^)]*moduleView[^)]*onModuleViewChange`);
    assert.match(moduleSources[index] ?? "", moduleName === "ShopView" ? /export default function ShopView\(props: ShopViewProps/ : declaration, `${moduleName} must be controlled by the shell view`);
  }
  assert.match(source, /Component: SettingsView \} = createReloadableLazy\("settings", \(\) => import\("\.\/settings-view"\)\)/);
  assert.match(source, /settings: \([^\n]+moduleView[^\n]+<SettingsView[^\n]+onModuleViewChange/);
  assert.match(source, /Component: AiModuleView \} = createReloadableLazy\("ai", \(\) => import\("\.\/ai-module-view"\)\)/);
  assert.match(source, /ai: \([^\n]+moduleView[^\n]+<AiModuleView[^\n]+onModuleViewChange/);
  // Tabs can live in shared/column components. Exercise every catalog value
  // through the single shell transition rather than count call-site strings.
  for (const moduleKey of ["shop", "sales", "inventory", "product", "import"] as const) {
    for (const view of moduleViewCatalog[moduleKey].views) {
      const location = updateModuleViewLocation("/?period=custom&from=2026-09-01&to=2026-09-07", moduleKey, view);
      const state = parseShellLocation(location);
      assert.equal(state.module, moduleKey); assert.equal(state.view, view);
      assert.deepEqual(state.period, { kind: "custom", from: "2026-09-01", to: "2026-09-07" });
    }
  }
});

test("deep links wait for shell location before mounting a business view", async () => {
  const source = await readFile(pagePath, "utf8");
  const locationReady = source.indexOf("setShellLocationReady(true)");
  const guardedView = source.indexOf("{shellLocationReady ? <Suspense");

  assert.ok(locationReady > 0);
  assert.ok(guardedView > locationReady);
  assert.match(source, /const \[active, setActive\] = useState<ModuleKey>\("dashboard"\);\s+const \[moduleTransitionPending, startModuleTransition\] = useTransition\(\);\s+const \[shellLocationReady, setShellLocationReady\] = useState\(false\)/);
  assert.match(source, /if \(shellLocationReady\) prepareNavigationModule\(active\)/);
  assert.match(source, /const prepareNavigationModule = createNavigationPreloader\(\{[\s\S]*?sales: salesCode\.preload,[\s\S]*?inventory: inventoryCode\.preload,[\s\S]*?product: productCode\.preload,[\s\S]*?market: marketCode\.preload,/);
  assert.doesNotMatch(source, /prefetchMarketRankingOverview|requestMarketOverview/, "the shell must not prefetch market data without verified identity/permission/source context");
  assert.match(source, /shellLocationReady \? <Suspense[\s\S]*?<View[\s\S]*?<\/Suspense> : <ModuleLoadingState/, "code preloading must not bypass the business-view location gate");
});
