import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"

describe("next-gen layered depth visual system", () => {
  const cssPath = path.join(process.cwd(), "app", "globals.css")
  const css = fs.readFileSync(cssPath, "utf8")

  function readVar(scope: string, variable: string) {
    const scopeMatch = css.match(new RegExp(`${scope}\\s*\\{([\\s\\S]*?)\\n\\}`, "m"))
    expect(scopeMatch, `Missing CSS scope: ${scope}`).toBeTruthy()
    const block = scopeMatch?.[1] ?? ""
    const tokenMatch = block.match(new RegExp(`${variable}:\\s*([^;]+);`))
    expect(tokenMatch, `Missing token ${variable} in ${scope}`).toBeTruthy()
    return tokenMatch?.[1]?.trim() ?? ""
  }

  it("defines 5 semantic elevation levels", () => {
    const tokens = {
      elevation1: readVar(":root", "--theme-surface-elevation-1"),
      elevation2: readVar(":root", "--theme-surface-elevation-2"),
      elevation3: readVar(":root", "--theme-surface-elevation-3"),
      elevation4: readVar(":root", "--theme-surface-elevation-4"),
      elevation5: readVar(":root", "--theme-surface-elevation-5"),
      shadow1: readVar(":root", "--theme-shadow-elevation-1"),
      shadow2: readVar(":root", "--theme-shadow-elevation-2"),
      shadow3: readVar(":root", "--theme-shadow-elevation-3"),
      shadow4: readVar(":root", "--theme-shadow-elevation-4"),
      shadow5: readVar(":root", "--theme-shadow-elevation-5"),
    }

    expect(tokens).toMatchSnapshot()
  })

  it("supports active/passive/focus-shift surfaces", () => {
    const selectors = [".surface-passive", ".surface-active", ".surface-focus-shift", ".dialog-overlay"]
    for (const selector of selectors) {
      expect(css).toContain(selector)
    }
  })

  it("keeps dark-mode presets contrast-safe with layered surface tokens", () => {
    const presets = ["twilight", "midnight-neon", "synthwave", "carbon", "oled-black", "frost"]
    const snapshot = presets.map((preset) => ({
      preset,
      passive: readVar(`\\[data-theme-preset=\"${preset}\"\\]`, "--theme-surface-passive"),
      active: readVar(`\\[data-theme-preset=\"${preset}\"\\]`, "--theme-surface-active"),
      focusShift: readVar(`\\[data-theme-preset=\"${preset}\"\\]`, "--theme-focus-shift"),
    }))

    expect(snapshot).toMatchSnapshot()
  })
})
