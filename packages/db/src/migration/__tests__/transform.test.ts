import { describe, expect, it } from "vitest"
import { toPortableRow, toSqliteBindValues } from "../transform"

describe("toPortableRow", () => {
  it("converts Date values to ISO-8601 strings", () => {
    const date = new Date("2026-01-15T12:30:00.123Z")
    const row = toPortableRow({ created_at: date, id: "abc" })
    expect(row.created_at).toBe("2026-01-15T12:30:00.123Z")
    expect(row.id).toBe("abc")
  })

  it("passes through strings, numbers, booleans, null, objects, and arrays unchanged", () => {
    const row = toPortableRow({
      id: "uuid-1",
      count: 5,
      active: true,
      deleted_at: null,
      metadata: { a: 1 },
      interests: ["gaming", "music"],
    })
    expect(row).toEqual({
      id: "uuid-1",
      count: 5,
      active: true,
      deleted_at: null,
      metadata: { a: 1 },
      interests: ["gaming", "music"],
    })
  })
})

describe("toSqliteBindValues", () => {
  it("converts booleans to 0/1", () => {
    expect(toSqliteBindValues({ discoverable: true }, ["discoverable"])).toEqual([1])
    expect(toSqliteBindValues({ discoverable: false }, ["discoverable"])).toEqual([0])
  })

  it("serializes objects and arrays to JSON text", () => {
    expect(toSqliteBindValues({ metadata: { a: 1 } }, ["metadata"])).toEqual(['{"a":1}'])
    expect(toSqliteBindValues({ interests: ["gaming", "music"] }, ["interests"])).toEqual(['["gaming","music"]'])
  })

  it("passes through strings and numbers, and maps null/undefined to null", () => {
    expect(toSqliteBindValues({ name: "vortex", size: 42, missing: null }, ["name", "size", "missing"])).toEqual([
      "vortex",
      42,
      null,
    ])
  })

  it("maps a column absent from the row to null", () => {
    expect(toSqliteBindValues({}, ["bio"])).toEqual([null])
  })

  it("orders values to match the given column list, not the row's own key order", () => {
    expect(toSqliteBindValues({ b: 2, a: 1 }, ["a", "b"])).toEqual([1, 2])
  })
})
