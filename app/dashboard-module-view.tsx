"use client";

import BiCockpitView from "./bi-cockpit-view";

export default function DashboardView(props: Parameters<typeof BiCockpitView>[0]) {
  return <BiCockpitView {...props} />;
}
