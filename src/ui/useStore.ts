import { createContext, useContext, useSyncExternalStore } from "react";
import type { Store } from "../app/store";

export const StoreContext = createContext<Store | null>(null);

/** Returns the store and re-renders the caller after every change. */
export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("StoreContext missing");
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store;
}
