// The store's DaisySim account is connected through the SMSBus API.
// Keep the existing SMSBus ID so saved activations, controls and metrics stay linked.
export const SMSBUS_DISPLAY_NAME = "DaisySim / SMSBus";
export const isVisibleProvider = (id: string, configured: boolean) =>
  id !== "daisysim" || configured;
