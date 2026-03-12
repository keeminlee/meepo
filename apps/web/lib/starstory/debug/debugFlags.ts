export function isDebugPanelEnabled(): boolean {
  if (process.env.NODE_ENV === "development") {
    return true;
  }

  return process.env.NEXT_PUBLIC_STARSTORY_DEBUG_PANEL === "true";
}
