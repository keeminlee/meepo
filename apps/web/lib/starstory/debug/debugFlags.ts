function readDebugFlag(): string | undefined {
  return process.env.STARSTORY_DEBUG_PANEL ?? process.env.NEXT_PUBLIC_STARSTORY_DEBUG_PANEL;
}

export function isDebugPanelEnabled(): boolean {
  if (process.env.NODE_ENV === "development") {
    return true;
  }

  return readDebugFlag() === "true";
}
