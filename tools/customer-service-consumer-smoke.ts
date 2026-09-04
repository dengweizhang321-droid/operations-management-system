import { getCustomerServiceConversationsForAi } from "../lib/customer-service/database";
import { readDjangoCustomerServiceConsumer } from "../lib/django/customer-service-consumer-reader";
import type { AppPrincipal } from "../lib/auth/authorization";

const principal: AppPrincipal = {
  email: "local-admin@teruisi.local",
  displayName: "本地管理员",
  role: "admin",
  scope: null,
};

const search = await readDjangoCustomerServiceConsumer(principal, {
  operation: "search",
  query: "客服",
  offset: 0,
  limit: 1,
  includeMessages: false,
});
const ai = await getCustomerServiceConversationsForAi(
  { limit: 1 },
  principal,
);

if (!search.revision || search.data.items.length > 1 || ai.returned > 1) {
  throw new Error("customer-service consumer smoke returned an invalid bounded result");
}

process.stdout.write(JSON.stringify({
  status: "passed",
  consumerRevision: search.revision,
  consumerReturned: search.data.items.length,
  aiReturned: ai.returned,
  aiTotalMatched: ai.totalMatched,
}));
