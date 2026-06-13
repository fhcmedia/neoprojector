// Pure background-resolution logic — no React, no bindings imports,
// unit-tested in resolve.test.ts.
//
// Assignment chain, nearest wins: item -> section -> service -> none.
// 0 (or null/undefined) at any level means "unset, inherit upward".
// The item/section hop happens where the schedule item is known (the
// show pane stamps it on go-live); the service-default fallback lives
// in the live provider's buildPayload — together they implement the
// full chain with no duplicated precedence logic.

import type { BackgroundDoc } from "./presets"

// Structurally identical to the displays binding's BackgroundSnapshot,
// declared locally so this module (and its tests) stay free of
// generated-bindings imports.
export type BackgroundSnapshotShape = {
  background_id: number
  engine: string
  config_json: string
}

// First configured id in the chain, or null when every level is unset.
export function resolveBackgroundId(
  ...ids: (number | null | undefined)[]
): number | null {
  for (const id of ids) {
    if (typeof id === "number" && id !== 0) return id
  }
  return null
}

// Resolve an id against the merged background list (DB rows shadowing
// seeds). A missing id — e.g. an assignment pointing at a deleted row
// — returns null so inheritance continues up the chain instead of
// rendering a ghost.
export function snapshotFor(
  id: number | null | undefined,
  all: BackgroundDoc[] | undefined
): BackgroundSnapshotShape | null {
  if (typeof id !== "number" || id === 0 || !all) return null
  const doc = all.find((b) => b.id === id)
  if (!doc) return null
  return {
    background_id: doc.id,
    engine: doc.engine,
    config_json: doc.config_json,
  }
}
