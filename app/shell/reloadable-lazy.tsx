"use client";

import {
  createElement,
  lazy,
  type ComponentType,
  type LazyExoticComponent,
} from "react";

type LazyImporter<Props extends object> = () => Promise<{
  default: ComponentType<Props>;
}>;

export type ReloadableLazyController<Props extends object> = {
  readonly current: LazyExoticComponent<ComponentType<Props>>;
  reset: () => LazyExoticComponent<ComponentType<Props>>;
  /** Explicit code-only navigation intent; never invoked during registration. */
  preload: () => ReturnType<LazyImporter<Props>>;
};

const scopeResets = new Map<string, Set<() => void>>();

export function createReloadableLazyController<Props extends object>(
  importer: LazyImporter<Props>,
): ReloadableLazyController<Props> {
  let pending: ReturnType<LazyImporter<Props>> | undefined;
  const load = () => {
    if (!pending) {
      pending = Promise.resolve().then(importer);
      const attempt = pending;
      void attempt.catch(() => { if (pending === attempt) pending = undefined; });
    }
    return pending;
  };
  let current = lazy(load);
  return {
    get current() {
      return current;
    },
    reset() {
      pending = undefined;
      current = lazy(load);
      return current;
    },
    preload: load,
  };
}

export function createReloadableLazy<Props extends object>(
  scope: string,
  importer: LazyImporter<Props>,
) {
  const controller = createReloadableLazyController(importer);
  const reset = () => {
    controller.reset();
  };
  const resets = scopeResets.get(scope) ?? new Set<() => void>();
  resets.add(reset);
  scopeResets.set(scope, resets);

  function ReloadableLazyComponent(props: Props) {
    return createElement(controller.current, props);
  }
  ReloadableLazyComponent.displayName = `ReloadableLazy(${scope})`;

  return {
    Component: ReloadableLazyComponent,
    controller,
    reset,
  };
}

export function resetReloadableLazyScope(scope: string): number {
  const resets = scopeResets.get(scope);
  if (!resets) return 0;
  for (const reset of resets) reset();
  return resets.size;
}
