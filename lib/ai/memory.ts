import type { AppPrincipal } from "@/lib/auth/authorization";
import { aiConsumer } from "@/lib/django/ai-service";

export const retrieveAiMemoriesForContext = (
  query: unknown,
  principal: AppPrincipal,
  singleShop = false,
) =>
  aiConsumer<Record<string, unknown>>(principal, {
    operation: "memory-recall",
    query,
    // Comes from the execution context, which only the signed Pi gateway sets,
    // and never from the tool arguments: the model writes those, so a flag
    // carried there would be its own to assert or to clear. Other surfaces
    // reach the registry with the model's arguments unfiltered, which is why
    // this value has no argument form at all.
    ...(singleShop ? { singleShopRestricted: true } : {}),
  });
