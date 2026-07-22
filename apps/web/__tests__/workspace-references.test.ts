import { describe, expect, it } from "vitest"
import { extractWorkspaceReference } from "@/components/chat/workspace-reference-embed"

describe("workspace references", () => {
  it("extracts task references", () => {
    expect(extractWorkspaceReference("Please handle [task:123e4567-e89b-12d3-a456-426614174000] soon")).toEqual({
      type: "task",
      id: "123e4567-e89b-12d3-a456-426614174000",
    })
  })

  it("extracts doc references", () => {
    expect(extractWorkspaceReference("See [doc:123e4567-e89b-12d3-a456-426614174000]")?.type).toBe("doc")
  })

  it("returns null when no reference exists", () => {
    expect(extractWorkspaceReference("hello world")).toBeNull()
  })
})
