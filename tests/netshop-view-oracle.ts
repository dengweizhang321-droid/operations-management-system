import assert from "node:assert/strict";

/**
 * Independent oracle for the `view` parameter (key lists are written out here on purpose,
 * not imported from the plan under test). Returns what a view must carry for a response
 * small enough that no aiCompaction trimming happens.
 */
type Plain = Record<string, any>;
export type View = "overview" | "rankings" | "list";

const PRODUCT_KEEP: Record<View, string[]> = {
  overview: ["summary", "comparisons", "counts", "structure", "efficiency", "metadata", "baselineReads", "dataQuality"],
  rankings: ["growth", "efficiency", "dataQuality", "metadata"],
  list: ["items", "pagination", "dataQuality", "metadata"],
};
const PROMOTION_KEEP: Record<View, string[]> = {
  overview: ["summary", "comparisons", "changes", "attribution", "matchedRange", "shops", "trend", "diagnostic", "objectCapabilities", "sourceMatrix", "coverage", "limitations", "dataQuality", "objectKind", "listScope"],
  rankings: ["contributions", "coverage", "limitations", "dataQuality", "objectKind", "listScope"],
  list: ["items", "pagination", "listScope", "coverage", "limitations", "dataQuality", "objectKind"],
};

function project(full: Plain, view: View, keep: string[], adjust: (sections: Plain) => void): Plain {
  const clone = structuredClone(full);
  const sections: Plain = {};
  for (const key of keep) if (key in clone.sections) sections[key] = clone.sections[key];
  adjust(sections);
  const next: Plain = { ...clone, sections };
  if (view !== "overview") delete next.context.capabilities;
  return next;
}

export function expectedProductView(full: Plain, view: View): Plain {
  return project(full, view, PRODUCT_KEEP[view], sections => {
    if (view === "overview" && sections.efficiency) { delete sections.efficiency.watchlist; delete sections.efficiency.pagination; }
    if (view !== "overview" && sections.metadata) sections.metadata = { limitations: sections.metadata.limitations };
  });
}

export function expectedPromotionView(full: Plain, view: View, rankingRows = 10): Plain {
  return project(full, view, PROMOTION_KEEP[view], sections => {
    if (view === "rankings" && sections.contributions) {
      for (const key of Object.keys(sections.contributions.previous)) sections.contributions.previous[key] = sections.contributions.previous[key].slice(0, rankingRows);
    }
  });
}

/** The result equals the oracle view (plus aiView), and aiView names exactly the sections present and lists the omissions. */
export function assertView(data: Plain, expected: Plain, view: View, omittedPaths: string[]) {
  const { aiView, ...rest } = data;
  assert.equal(aiView.view, view);
  assert.deepEqual(rest, expected);
  const included = (aiView.included as string[]).filter(path => path.startsWith("sections.")).map(path => path.slice("sections.".length)).sort();
  assert.deepEqual(included, Object.keys(expected.sections).sort());
  for (const path of omittedPaths) assert.ok((aiView.omitted as Array<{ path: string }>).some(item => item.path === path), `aiView.omitted lacks ${path}`);
  for (const item of aiView.omitted as Array<{ path: string; reason: string; howToGet: string }>) {
    assert.ok(item.reason.length > 0 && item.howToGet.length > 0);
    const key = item.path.slice("sections.".length);
    if (item.path.startsWith("sections.") && /^[A-Za-z]+$/.test(key)) assert.equal(key in expected.sections, false, `${item.path} is both kept and omitted`);
  }
  return aiView;
}
