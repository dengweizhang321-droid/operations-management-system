# Integrated shell synthetic browser fixture

Run from the selected integration checkout:

```powershell
node tools/verify-netshop-integrated-shell-ui.mjs
```

The tool bundles the actual `app/page.tsx` Home, ShopView, registered module slots and ProductsColumn. Home remains the only navigation/history owner; the fixture supplies no router, shell replacement or history controller. A clean headless browser uses a dynamically bound loopback server, fixed test clock and GET-only mock transport. Unknown network, external hosts, writes and paid dispatch attempts are blocked and counted. Each run writes exclusively to a new UUID evidence directory under E, including source SHA, dirty state, compile-input hashes, DOM on failure, screenshots and shutdown results.

The actual `app/layout.tsx` global stylesheet imports are read and loaded in their declared order: globals, top-navigation, shared-theme. The fixture verifies layout html/body attributes and mounts Home directly into the body. Layout and all three CSS hashes are recorded. Desktop navigation/masthead/workspace geometry and the tabs' measured sticky offset are asserted, while narrow views must hide desktop navigation and show its actual menu control. Earlier runs that loaded only globals have retained interaction evidence but explicitly invalidated visual/narrow-layout conclusions; their screenshots are not canonical layout proof.

`owner-products.mjs` copies the synthetic generators from Owner P's `tools/verify-netshop-products-ui.mjs`, with the final Owner helper `tests/netshop-products-test-fixture.ts::completeProductSectionsFixture` and mandatory unverified image status. These are test-only synthetic fields; they do not prove source collection, historical mapping or production computation. The original P tool, production source, dependency files and existing evidence are unchanged.

At M3, A is unregistered and exact promotion drill is false: the tool observes the real old whole-store promotion entry and uses actual browser Back to return, rather than pretending an A return bridge exists. Q must rerun against the final P/A registration with actual Owner-A fixtures for the M4 chain. Old five-view and 01 switches currently receive an explicit source-pending error, so successful mounting is not full legacy/01 content or metrics verification. Author execution is not independent final review.
