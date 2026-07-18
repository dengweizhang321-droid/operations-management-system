export const SHOP_FILTER_SEPARATOR = "\u001f";

export type CanonicalShopIdentity = {
  platform: string;
  shopName: string;
};

type ShopAliasRule = CanonicalShopIdentity & {
  rawShopNames: readonly string[];
  rawChannels: readonly string[];
};

const selfOperatedJdShop: ShopAliasRule = {
  platform: "京东",
  shopName: "志高商用厨电自营旗舰店",
  rawShopNames: ["志高商用厨电自营旗舰店", "志高商用厨电京东自营旗舰店"],
  rawChannels: ["京东-志高商用厨电自营旗舰店", "京东志高商用自营旗舰店"],
};

const shopAliasRules = [selfOperatedJdShop] as const;

function clean(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function matchingRule(platform: string, shopName: string, channel: string) {
  return shopAliasRules.find((rule) => {
    if (platform && rule.platform !== platform) return false;
    return rule.shopName === shopName
      || rule.rawShopNames.includes(shopName)
      || rule.rawChannels.includes(channel);
  });
}

export function canonicalizeShopIdentity(platformValue: string | null | undefined, shopNameValue: string | null | undefined, channelValue: string | null | undefined): CanonicalShopIdentity {
  const platform = clean(platformValue);
  const shopName = clean(shopNameValue);
  const channel = clean(channelValue);
  const rule = matchingRule(platform, shopName, channel);
  return {
    platform: rule?.platform ?? platform,
    shopName: rule?.shopName ?? (shopName || channel || platform || "未分类"),
  };
}

export function shopFilterKey(identity: CanonicalShopIdentity) {
  return `${identity.platform}${SHOP_FILTER_SEPARATOR}${identity.shopName}`;
}

export function parseShopFilterKey(value: string) {
  const [platformValue, shopNameValue, ...rest] = value.split(SHOP_FILTER_SEPARATOR);
  if (rest.length > 0 || !platformValue || !shopNameValue) return null;
  return canonicalizeShopIdentity(platformValue, shopNameValue, "");
}

export function expandShopAliases(identity: CanonicalShopIdentity) {
  const rule = matchingRule(identity.platform, identity.shopName, "")
    ?? shopAliasRules.find((candidate) => candidate.platform === identity.platform && candidate.shopName === identity.shopName);
  return rule ? [...rule.rawShopNames] : [identity.shopName];
}
