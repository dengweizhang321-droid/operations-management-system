import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SidebarNavigation from "../app/shell/sidebar-navigation";
import { toggleSingleFilter, workCardStatuses } from "../lib/ui/summary-filter";

const source = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("top navigation places standalone AI chat at far left followed by 4 grouped dropdowns", () => {
  const html = renderToStaticMarkup(createElement(SidebarNavigation, {
    active: "sales",
    activeView: "overview",
    collapsed: false,
    hrefForModule: (module, requestedView) => `/?module=${module}${requestedView ? `&view=${requestedView}` : ""}`,
    onNavigate: () => {},
    onToggleCollapsed: () => {},
  }));

  // Far-left standalone AI Chat link is first
  const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
  assert.equal(links.length, 13);
  assert.match(links[0][1], /nav-ai-direct/);
  assert.match(links[0][1], /module=ai&amp;view=assistant/);
  assert.match(links[0][2], /AI 对话/);

  // 4 group triggers rendered cleanly with active group showing current module pill
  const triggers = [...html.matchAll(/class="nav-group-trigger([^"]*)"/g)];
  assert.equal(triggers.length, 4);
  assert.match(html, /<span class="nav-group-current">销售分析<\/span>/);
});

test("layout overhaul stylesheet uses only defined tokens and wires all P0/P1 structural upgrades", async () => {
  const [tokens, overhaulCss, topNavCss, layout, sales, operations] = await Promise.all([
    source("../app/styles/tokens.css"),
    source("../app/styles/layout-overhaul.css"),
    source("../app/shell/top-navigation.css"),
    source("../app/layout.tsx"),
    source("../app/sales-module-view.tsx"),
    source("../app/operations-view.tsx"),
  ]);

  const defined = new Set([...tokens.matchAll(/--([a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
  for (const css of [overhaulCss, topNavCss]) {
    const used = new Set([...css.matchAll(/var\(--([a-z0-9-]+)/gi)].map((m) => m[1]));
    const missing = [...used].filter((name) => !defined.has(name));
    assert.deepEqual(missing, []);
  }

  assert.match(layout, /import "\.\/styles\/layout-overhaul\.css"/);
  assert.match(sales, /sales-status-strip/);
  assert.match(sales, /sales-metrics-primary/);
  assert.match(sales, /sales-secondary-ribbon/);
  assert.match(operations, /taskEditorOpen/);
  assert.match(operations, /＋ 新建工作项/);
  assert.match(overhaulCss, /height:\s*44px/);
  assert.match(overhaulCss, /\.inventory-mapping-panel\s+\.table-toolbar/);
});

test("operations task editor exposes visible confirm footer and merges in-progress + pending clickable tab", async () => {
  const [operations, launch, followup, overhaulCss] = await Promise.all([
    source("../app/operations-view.tsx"),
    source("../app/new-product-launch-view.tsx"),
    source("../app/new-product-sales-followup-view.tsx"),
    source("../app/styles/layout-overhaul.css"),
  ]);

  // Task editor appears immediately under hero (before filters/charts) with dedicated confirm footer
  const heroPos = operations.indexOf("workflow-plan-hero");
  const editorPos = operations.indexOf('id="operations-task-editor"');
  const filterPos = operations.indexOf("workflow-plan-controls");
  assert.ok(heroPos > 0 && editorPos > heroPos && editorPos < filterPos, "task editor must open right below the hero toolbar");

  assert.match(operations, /className="workflow-task-create-actions"/);
  assert.match(operations, /确定添加工作项/);
  assert.match(operations, /确定保存修改/);
  assert.match(overhaulCss, /\.workflow-task-create-actions/);

  // Audit all sibling forms in operations modules have explicit submit buttons
  assert.match(operations, /type="submit" className="primary-button" disabled=\{saving\}>确定发表评论/);
  assert.match(operations, /type="submit" className="primary-button" disabled=\{saving\}>确定添加提醒/);
  assert.match(operations, /type="submit" className="primary-button" disabled=\{saving\}>确定添加关联/);
  assert.match(operations, /type="submit" className="primary-button" disabled=\{saving\}>\{saving \? "保存中…" : editing \? "保存修改" : "保存模板"\}/);
  assert.match(launch, /type="submit" className="primary-button"/);
  assert.match(followup, /type="submit" className="primary-button"/);

  // Combined "进行中 + 未开始" summary card & bucket tab both toggle "open" -> ["待开始", "工作中"]
  assert.equal((operations.match(/<span>进行中 \+ 未开始<\/span>/g) ?? []).length, 2);
  assert.equal((operations.match(/toggleSingleFilter\(current, "open", "all"\)/g) ?? []).length, 2);
  assert.deepEqual(workCardStatuses("open"), ["待开始", "工作中"]);
  assert.equal(toggleSingleFilter("all", "open", "all"), "open");
  assert.equal(toggleSingleFilter("open", "open", "all"), "all");
});
