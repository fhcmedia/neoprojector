import type { Overlay } from "@/bindings/neoprojector/database"
import type { ActiveOverlay } from "@/features/live/live-context"

export function overlayActivationPayload(
  scheduleItemId: number,
  overlay: Overlay
): Omit<ActiveOverlay, "activatedAt"> {
  return {
    scheduleItemId,
    overlayKind: overlay.kind,
    name: overlay.name,
    configJSON: overlay.config_json,
    layoutsJSON: overlay.layouts_json,
    rulesJSON: overlay.rules_json,
  }
}
