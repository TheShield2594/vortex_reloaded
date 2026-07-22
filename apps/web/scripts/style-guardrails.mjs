import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs"
import { resolve, relative, extname, join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const ROOT = resolve(WEB_ROOT, "../..")
const BASELINE_PATH = resolve(WEB_ROOT, "config/style-guardrails-baseline.json")
const WRITE_BASELINE = process.argv.includes("--write-baseline")

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"])
const EXCLUDED_DIRS = new Set(["node_modules", ".next", "dist", "coverage"])
const rules = [
  {
    id: "inline-style-color",
    description: "Inline style color tokens are not allowed on product surfaces.",
    regex: /style\s*=\s*\{\{(?:[^}]|}(?!}))*?\b(color|background|backgroundColor|borderColor)\s*:/g,
  },
  {
    id: "inline-style-radius-shadow",
    description: "Inline style borderRadius/boxShadow are not allowed on product surfaces.",
    regex: /style\s*=\s*\{\{(?:[^}]|}(?!}))*?\b(borderRadius|boxShadow)\s*:/g,
  },
  {
    id: "tailwind-arbitrary-surface-token",
    description: "Arbitrary Tailwind surface values are not allowed; use governed tokens/variants.",
    regex: /\b(bg|border)-\[[^\]]+\]|\b(rounded|shadow)-\[[^\]]+\]/g,
  },
]

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry)) walk(fullPath, files)
      continue
    }
    if (SOURCE_EXTENSIONS.has(extname(entry))) files.push(fullPath)
  }
  return files
}

function lineNumberFromIndex(content, index) {
  return content.slice(0, index).split("\n").length
}

function collectViolations() {
  const violations = []
  const files = walk(WEB_ROOT)
  for (const filePath of files) {
    const content = readFileSync(filePath, "utf8")
    const rel = relative(ROOT, filePath).replaceAll("\\", "/")
    for (const rule of rules) {
      rule.regex.lastIndex = 0
      let match
      while ((match = rule.regex.exec(content)) !== null) {
        const line = lineNumberFromIndex(content, match.index)
        violations.push({
          key: `${rule.id}:${rel}:${line}`,
          ruleId: rule.id,
          file: rel,
          line,
          excerpt: match[0].slice(0, 120),
        })
      }
    }
  }
  return violations.sort((a, b) => a.key.localeCompare(b.key))
}

const current = collectViolations()

if (WRITE_BASELINE) {
  const payload = {
    generatedAt: new Date().toISOString(),
    rules: rules.map(({ id, description }) => ({ id, description })),
    violations: current.map(({ key, ruleId, file, line }) => ({ key, ruleId, file, line })),
  }
  writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`)
  console.log(`Wrote baseline with ${current.length} violations to ${relative(ROOT, BASELINE_PATH)}`)
  process.exit(0)
}

if (!existsSync(BASELINE_PATH)) {
  console.error(`Missing baseline file: ${relative(ROOT, BASELINE_PATH)}. Run style guardrail with --write-baseline.`)
  process.exit(1)
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"))
const baselineKeys = new Set((baseline.violations ?? []).map((item) => item.key))
const regressions = current.filter((item) => !baselineKeys.has(item.key))

if (regressions.length > 0) {
  console.error("Detected new style-token guardrail regressions:\n")
  for (const regression of regressions) {
    console.error(`- [${regression.ruleId}] ${regression.file}:${regression.line}`)
  }
  console.error("\nUse governed design tokens/component variants instead of ad-hoc inline values.")
  process.exit(1)
}

console.log(`Style guardrails passed (${current.length} tracked baseline violations, 0 regressions).`)
