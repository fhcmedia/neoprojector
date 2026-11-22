import { describe, expect, it } from "vitest"
import { shareBindings, toPlain } from "./plain-bindings"

class Model {
  id = 0
  name = ""
  constructor(src: Partial<Model> = {}) {
    Object.assign(this, src)
  }
  static createFrom(src: Partial<Model>) {
    return new Model(src)
  }
}

describe("shareBindings", () => {
  it("keeps unchanged model lists identical across refetches", () => {
    const first = shareBindings(undefined, [Model.createFrom({ id: 1, name: "a" })])
    const second = shareBindings(first, [Model.createFrom({ id: 1, name: "a" })])
    expect(second).toBe(first)
  })
  it("replaces only what changed", () => {
    const first = shareBindings(undefined, [
      Model.createFrom({ id: 1, name: "a" }),
      Model.createFrom({ id: 2, name: "b" }),
    ]) as Model[]
    const second = shareBindings(first, [
      Model.createFrom({ id: 1, name: "a" }),
      Model.createFrom({ id: 2, name: "c" }),
    ]) as Model[]
    expect(second).not.toBe(first)
    expect(second[0]).toBe(first[0])
    expect(second[1].name).toBe("c")
  })
  it("leaves non-model objects alone", () => {
    const d = new Date(0)
    const m = new Map([[1, 2]])
    expect((toPlain({ d, m }) as { d: Date; m: Map<number, number> }).d).toBe(d)
    expect((toPlain([m]) as unknown[])[0]).toBe(m)
  })
})
