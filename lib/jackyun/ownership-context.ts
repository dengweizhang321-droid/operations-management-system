import { AsyncLocalStorage } from "node:async_hooks";

export type PublicationFence = { version: number; ownerToken: string; pid: number; processIdentity?: string;
  runId: string; purpose: string; lockDirectory: string };
export const jackyunPublicationFence = new AsyncLocalStorage<PublicationFence>();
