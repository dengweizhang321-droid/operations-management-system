# Integrated shell synthetic browser fixture

Run from the selected integration checkout:

```powershell
node tools/verify-netshop-integrated-shell-ui.mjs
```

The tool bundles the actual `app/page.tsx` Home, ShopView, registered module slots and ProductsColumn. Home remains the only navigation/history owner; the fixture supplies no router, shell replacement or history controller. A clean headless browser uses a dynamically bound loopback server, fixed test clock and GET-only mock transport. Unknown network, external hosts, writes and paid dispatch attempts are blocked and counted. Each run writes exclusively to a new UUID evidence directory under E, including source SHA, dirty state, compile-input hashes, DOM on failure, screenshots and shutdown results.

The actual `app/layout.tsx` global stylesheet imports are read and loaded in their declared order: globals, top-navigation, shared-theme. The fixture verifies layout html/body attributes and mounts Home directly into the body. Layout and all three CSS hashes are recorded. Desktop navigation/masthead/workspace geometry and the tabs' measured sticky offset are asserted, while narrow views must hide desktop navigation and show its actual menu control. Earlier runs that loaded only globals have retained interaction evidence but explicitly invalidated visual/narrow-layout conclusions; their screenshots are not canonical layout proof.

`owner-products.mjs` copies the synthetic generators from Owner P's `tools/verify-netshop-products-ui.mjs`, with the final Owner helper `tests/netshop-products-test-fixture.ts::completeProductSectionsFixture` and mandatory unverified image status. These are test-only synthetic fields; they do not prove source collection, historical mapping or production computation. The original P tool, production source, dependency files and existing evidence are unchanged.

At M3, A is unregistered and exact promotion drill is false: the tool observes the real old whole-store promotion entry and uses actual browser Back to return, rather than pretending an A return bridge exists. Q must rerun against the final P/A registration with actual Owner-A fixtures for the M4 chain. Old five-view and 01 switches currently receive an explicit source-pending error, so successful mounting is not full legacy/01 content or metrics verification. Author execution is not independent final review.

## Explicit M4 phase

```powershell
$env:NETSHOP_INTEGRATED_UI_PHASE = 'M4'
node tools/verify-netshop-integrated-shell-ui.mjs
```

M3 remains the default. M4 requires both actual P/A registered components and both real reader route source files, with the exact-product gate true. `source6/` is the byte-preserved, SHA-verified Root06 private-PG capture set (owning revision `6:cc2ab9667d7e`), including 9/1–7 natural-week data, 9/1–6 object focus, exact SKU-001/detail, and the independent report's actual current/previous-equal periods. Every run verifies the original manifest bytes and hashes. No PG, existing preview, production source/config/profile or service is accessed by the test.

Mock transport records `fixture_projection` explicitly: A's amounts, ratios, full calendar, coverage and contribution sets remain original. Literal table search, ordering supplied metric cells and pagination test UI state, not SQL semantics. The captured exact SKU detail may echo the captured whole-list parent section token when the query lacks the P identity filter; its same source revision, object, shop and full period remain unchanged. P still uses its Owner synthetic builder; its P21 identity and positive eligibility flag are aligned to the actual A SKU, and all same-kind owning members echo source6. This does not prove actual P mapping or P/A numerical parity.

M4 exercises actual Home P→A exact identity, A's real return control, same-identity flat origin, 9/1–6 weekly focus with nondefault search/sort/page→P→A restoration, unbound new-tab prefs, actual report trace via captured Blob bytes and no model dispatch. Injected 403 role/scope and 409 epoch errors verify UI clearing, not database policy. Complete layout CSS, measured sticky geometry, system SVG/menu and narrow drawer controls are checked. Independent Q must execute the final committed combination separately and combine this synthetic UI evidence with the actual backend/PG/source checks.
