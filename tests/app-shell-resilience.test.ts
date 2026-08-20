import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("module failures stay inside the application shell", async () => {
  const [page, boundary] = await Promise.all([
    source("../app/page.tsx"),
    source("../app/shell/module-error-boundary.tsx"),
  ]);
  assert.match(page, /<ModuleErrorBoundary[\s\S]*?<View[\s\S]*?<\/ModuleErrorBoundary>/);
  assert.match(boundary, /getDerivedStateFromError/);
  assert.match(boundary, /previousProps\.resetKey !== this\.props\.resetKey/);
  assert.match(boundary, /role="alert"/);
  assert.match(boundary, /重试当前模块/);
  assert.match(boundary, /返回 BI 看板/);
});

test("global search dialog traps focus and restores the background", async () => {
  const [page, search, dialog] = await Promise.all([
    source("../app/page.tsx"),
    source("../app/global-search-dialog.tsx"),
    source("../app/ui/dialog.tsx"),
  ]);
  assert.match(page, /aria-haspopup="dialog"/);
  assert.match(page, /aria-controls="global-search-dialog"/);
  assert.match(page, /\{searchOpen && <Suspense[\s\S]+<GlobalSearchDialog/);
  assert.match(search, /<Dialog[\s\S]+open=\{open\}/);
  assert.match(dialog, /createPortal/);
  assert.match(dialog, /setPortalTarget\(document\.body\)/);
  assert.match(dialog, /document\.body\.style\.overflow = "hidden"/);
  assert.match(dialog, /backgroundShell\?\.setAttribute\("inert", ""\)/);
  assert.match(dialog, /if \(transition\.becameEmpty\)/);
  assert.match(dialog, /event\.key === "Escape"/);
  assert.match(dialog, /event\.key !== "Tab"/);
  assert.match(dialog, /focusTarget\?\.isConnected/);
});

test("mobile navigation releases its interaction lock at the desktop breakpoint", async () => {
  const [shell, sidebar, styles, pageSourceForMobileFocus] = await Promise.all([
    source("../app/shell/app-shell.tsx"),
    source("../app/shell/sidebar-navigation.tsx"),
    source("../app/globals.css"),
    source("../app/page.tsx"),
  ]);
  assert.match(shell, /matchMedia\("\(max-width: 860px\)"\)/);
  assert.match(shell, /if \(!matches && mobileOpen\) onCloseMobile\(\)/);
  assert.match(shell, /inert=\{mobileDrawerActive \|\| undefined\}/);
  assert.match(pageSourceForMobileFocus, /requestAnimationFrame\(\(\) => window\.requestAnimationFrame\(\(\) => pageTitleRef\.current\?\.focus\(\)\)\)/);
  assert.match(sidebar, /className="sidebar-navigation-scroll"/);
  assert.match(styles, /\.sidebar-navigation-scroll \{[^}]*overflow-y: auto/);
  assert.match(styles, /\.collapse-button \{[^}]*width: 44px; height: 44px/);
});

test("market master initial failures are visible and retryable", async () => {
  const market = await source("../app/market-view.tsx");
  assert.match(market, /if \(!data && error\) return <section[^>]*role="alert"/);
  assert.match(market, /TOP SKU 主数据中心加载失败/);
  assert.match(market, /重新加载/);
  assert.match(market, /if \(!data\) return <section[^>]*role="status"/);
});
