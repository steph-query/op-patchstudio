import { useSyncExternalStore } from 'react';

let pending = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
/**
 * **A cancel belongs here, not in the panel.** While an operation is pending the tab
 * panel is `aria-busy` and intercepts pointer events, so a stop button rendered inside
 * a workspace panel is visible, enabled, and impossible to click — the project sweep
 * shipped exactly that until an end-to-end test tried to press it. The busy banner is
 * the only surface above the blocked panel, and it renders `cancelLabel` for you.
 *
 * `cancel` is optional on purpose. It used to be required, so every caller passed
 * an empty function to satisfy it — and the busy banner, which showed its button
 * whenever options existed, offered "Cancel preview" during imports, sends and
 * stem exports, where pressing it did nothing at all. An operation that cannot be
 * stopped should not offer to stop.
 */
type OperationOptions = { message: string; cancel?: () => Promise<void>; cancelLabel?: string };
let activeOptions: OperationOptions | null = null;

/** Keep the workspace on its current device throughout transfers and dialogs. */
export async function deviceOperation<T>(work: () => Promise<T>, options?: OperationOptions): Promise<T> {
  const previousOptions = activeOptions;
  if (options) activeOptions = options;
  pending++;
  emit();
  try { return await work(); }
  finally { pending--; if (options) activeOptions = previousOptions; emit(); }
}

export function useDeviceOperationOptions(): OperationOptions | null {
  return useSyncExternalStore(callback => { listeners.add(callback); return () => { listeners.delete(callback); }; }, () => activeOptions, () => null);
}

export function useDeviceBusy(): boolean {
  return useSyncExternalStore(callback => { listeners.add(callback); return () => { listeners.delete(callback); }; }, () => pending > 0, () => false);
}
