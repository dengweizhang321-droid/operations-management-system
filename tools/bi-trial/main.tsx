import { createRoot } from "react-dom/client";
import BiCockpitView from "../../app/bi-cockpit-view";
import "../../app/styles/tokens.css";
import "./trial.css";

createRoot(document.getElementById("root")!).render(<main><header className="trialHeader"><strong>BI 真实数据快照试用</strong><span>尚未合并或上线 · ERP选期 2026-09-01 — 09-30</span></header><aside>使用 2026-10-06 本机只读核对的聚合快照。目标为ERP口径，配置功能尚未发布；ERP平台与店铺仅提供已核对的试用范围。此页不写入正式数据。</aside><BiCockpitView range="自定义" customStartDate="2026-09-01" customEndDate="2026-09-30" currentUser={{ email: "local-admin@teruisi.local", displayName: "本地管理员", role: "admin", roleLabel: "管理员", scopeRestricted: false }} /></main>);
