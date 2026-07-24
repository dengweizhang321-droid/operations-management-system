export type LocalDirectAccessContext = {
  enabled: string | undefined;
  runtimeEnvironment: string | undefined;
  viteDevelopment: boolean;
  viteProduction: boolean;
  localBuild?: boolean;
};

export type LocalDirectAccessDecision =
  | "disabled"
  | "allowed"
  | "role_denied";

/**
 * Local direct access is deliberately fail-closed. Besides an explicit opt-in,
 * it requires both the deployment binding and either Vite development mode or
 * an explicit local-only build stamp. A hosted production build therefore
 * cannot be turned into anonymous admin access by a stray runtime variable.
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
    (context.viteDevelopment === true && context.viteProduction === false) ||
    context.localBuild === true;

  if (!enabled || !declaredDevelopment || !verifiedDevelopment) {
    return "disabled";
  }

  return allowedRoles.includes(localRole) ? "allowed" : "role_denied";
}
