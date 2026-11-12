/**
 * `view` for the two netshop list tools. A view only chooses which already
 * decoded sections the model receives; it is applied after the owning decoder
 * accepted the whole response, and never reaches the Django request.
 * Anything left out is listed in `aiView.omitted` with a reason and the way to get it.
 */
export const NETSHOP_AI_VIEWS = ["overview", "rankings", "list"] as const;
export type NetshopAiView = (typeof NETSHOP_AI_VIEWS)[number];
export const NETSHOP_AI_DEFAULT_VIEW: NetshopAiView = "overview";

export type AiViewOmission = { path: string; reason: string; howToGet: string };
export type AiViewMark = { view: NetshopAiView; included: string[]; omitted: AiViewOmission[] };
export type AiViewPlan = {
  /** Section keys carried by each view in addition to `always`. The pseudo key `capabilities` stands for context.capabilities. */
  keep: Record<NetshopAiView, readonly string[]>;
  always: readonly string[];
  reasons: Record<string, string>;
};

type Plain = Record<string, any>;

export const viewHint = (views: readonly NetshopAiView[]) => views.map(view => `view="${view}"`).join(" 或 ");

export function viewOf(args: Record<string, unknown>): NetshopAiView {
  return (args.view as NetshopAiView | undefined) ?? NETSHOP_AI_DEFAULT_VIEW;
}

/** Collects omissions; the hint names the other views that do carry the section. */
export class AiViewBuilder {
  readonly omitted: AiViewOmission[] = [];
  constructor(readonly view: NetshopAiView, private readonly plan: AiViewPlan) {}
  omit(path: string, key: string, reason?: string) {
    const views = NETSHOP_AI_VIEWS.filter(view => view !== this.view && this.plan.keep[view].includes(key));
    this.omitted.push({ path, reason: reason ?? this.plan.reasons[key] ?? "与本视图无关", howToGet: views.length > 0 ? `改用 ${viewHint(views)}` : "缩小范围后重读" });
  }
}

/**
 * Keep only the sections the view carries. `refine` may trim inside a kept section
 * (it receives the output sections and the omission collector).
 */
export function projectNetshopAiView(
  data: Record<string, unknown>,
  view: NetshopAiView,
  plan: AiViewPlan,
  refine?: (sections: Plain, builder: AiViewBuilder) => Plain,
): Record<string, unknown> {
  const source = data as Plain;
  const sections = source.sections as Plain;
  const builder = new AiViewBuilder(view, plan);
  let out: Plain = {};
  for (const [key, value] of Object.entries(sections)) {
    if (plan.always.includes(key) || plan.keep[view].includes(key)) out[key] = value;
    else builder.omit(`sections.${key}`, key);
  }
  if (refine) out = refine(out, builder);
  const next: Plain = { ...source, sections: out };
  const context = source.context as Plain | undefined;
  if (view !== "overview" && context && "capabilities" in context) {
    const { capabilities: _capabilities, ...rest } = context;
    next.context = rest;
    builder.omit("context.capabilities", "capabilities", "能力清单较大，与本视图的问题无关");
  }
  const included = [...Object.keys(source).filter(key => key !== "sections" && key !== "context"), "context", ...Object.keys(out).map(key => `sections.${key}`)];
  const mark: AiViewMark = { view, included, omitted: builder.omitted };
  next.aiView = mark;
  return next;
}
