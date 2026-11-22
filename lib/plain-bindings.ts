import { replaceEqualDeep } from "@tanstack/react-query"

// Wails bindings return their models as class instances (data fields
// plus a static createFrom, no methods). TanStack Query only shares
// structure between plain objects, so every refetch of unchanged data
// produced brand-new objects and every consumer redrew; template
// previews re-measured their text, which showed as flicker. Turning
// model instances into plain objects lets unchanged data keep its
// identity. Anything else that isn't plain (Map, Date, Blob…) is kept
// as is.

function isBindingModel(v: object): boolean {
  const ctor = Object.getPrototypeOf(v)?.constructor as { createFrom?: unknown } | undefined
  return typeof ctor?.createFrom === "function"
}

export function toPlain(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(toPlain)
  if (v === null || typeof v !== "object") return v
  const proto = Object.getPrototypeOf(v)
  if (proto !== Object.prototype && proto !== null && !isBindingModel(v)) return v
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) out[k] = toPlain(x)
  return out
}

// structuralSharing for the QueryClient: keep unchanged data (models
// included) referentially equal across refetches.
export function shareBindings(oldData: unknown, newData: unknown): unknown {
  return replaceEqualDeep(oldData, toPlain(newData))
}
