import { useSyncExternalStore } from 'react';
import { getEconomySnapshot, subscribeEconomy } from '../lib/economyStore.js';

/** React binding for the economy store. Snapshot identity changes on publish. */
export default function useEconomy() {
  return useSyncExternalStore(subscribeEconomy, getEconomySnapshot, getEconomySnapshot);
}
