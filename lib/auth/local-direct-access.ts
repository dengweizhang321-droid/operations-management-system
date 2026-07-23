export type LocalDirectAccessContext = {
  enabled: string | undefined;
  runtimeEnvironment: string | undefined;
  viteDevelopment: boolean;
  viteProduction: boolean;
};

export type LocalDirectAccessDecision =
  | "disabled"
  | "allowed"
  | "role_denied";

/**
 * Local direct access is deliberately fail-closed. Besides an explicit opt-in,
 * it requires both the deployment binding and the build runtime to agree that
 * this is a development instance. A production build can therefore never be
 * turned into anonymous admin access by a stray runtime variable alone.
 */
export function decideLocalDirectAccess(
  allowedRoles: readonly string[],
  context: LocalDirectAccessContext,
  localRole = "admin",
): LocalDirectAccessDecision {
  const enabled = context.enabled?.trim().toLowerCase() === "true";
  const declaredDevelopment =
    context.runtimeEnvironment?.trim().toLowerCase() === "development";
  const verifiedDevelopment =
    context.viteDevelopment === true && context.viteProduction === false;

  if (!enabled || !declaredDevelopment || !verifiedDevelopment) {
    return "disabled";
  }

  return allowedRoles.includes(localRole) ? "allowed" : "role_denied";
}
