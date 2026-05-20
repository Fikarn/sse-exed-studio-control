import { createContext, useContext, type ReactNode } from "react";

import type { MeterStore } from "@sse/engine-client";

const MeterStoreContext = createContext<MeterStore | null>(null);

export function MeterStoreProvider({ store, children }: { store: MeterStore; children: ReactNode }) {
  return <MeterStoreContext.Provider value={store}>{children}</MeterStoreContext.Provider>;
}

export function useMeterStore(): MeterStore {
  const store = useContext(MeterStoreContext);
  if (!store) {
    throw new Error("useMeterStore must be used inside <MeterStoreProvider>");
  }
  return store;
}
