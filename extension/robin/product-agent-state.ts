import { readJsonObject, updateJsonObject } from "./paths.ts";

interface ProductAgentState {
  incubatorSessionId?: string;
  productSessionIds?: Record<string, string>;
  updatedAt?: string;
}

const FILE = "product-agents.json";

function readState(): ProductAgentState {
  return readJsonObject<ProductAgentState>(FILE) ?? {};
}

export function readProductAgentSessionId(productId?: string): string | null {
  const state = readState();
  return productId ? state.productSessionIds?.[productId] ?? null : state.incubatorSessionId ?? null;
}

export function writeProductAgentSessionId(sessionId: string, productId?: string): void {
  updateJsonObject<ProductAgentState, void>(FILE, (current) => {
    const state = current ?? {};
    return {
      result: undefined,
      value: productId
        ? { ...state, productSessionIds: { ...state.productSessionIds, [productId]: sessionId }, updatedAt: new Date().toISOString() }
        : { ...state, incubatorSessionId: sessionId, updatedAt: new Date().toISOString() },
      changed: true,
    };
  });
}

export function clearProductAgentSession(productId?: string): boolean {
  return updateJsonObject<ProductAgentState, boolean>(FILE, (current) => {
    const state = current ?? {};
    if (productId) {
      if (!state.productSessionIds?.[productId]) return { result: false, value: state, changed: false };
      const sessions = { ...state.productSessionIds };
      delete sessions[productId];
      return { result: true, value: { ...state, productSessionIds: sessions, updatedAt: new Date().toISOString() }, changed: true };
    }
    if (!state.incubatorSessionId) return { result: false, value: state, changed: false };
    const { incubatorSessionId: _removed, ...rest } = state;
    void _removed;
    return { result: true, value: { ...rest, updatedAt: new Date().toISOString() }, changed: true };
  });
}
