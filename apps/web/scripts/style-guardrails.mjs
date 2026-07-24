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
        violations.push({
          ruleId: rule.id,
          file: rel,
          line: lineNumberFromIndex(content, match.index),
          excerpt: match[0].slice(0, 120),
        })
      }
    }
  }
  return violations
}

// Aggregate raw matches into an occurrence count per (rule, file). The
// baseline used to be keyed by exact line number (`ruleId:file:line`), which
// meant any unrelated edit that shifted lines in a governed file turned every
// tolerated violation in it into a false "regression" — and made the check
// drift between CI and dev file sets (see .github/workflows/ci.yml, which
// disables it in CI for exactly this reason). Counting per file is robust to
// code moving around while still catching a *net-new* inline-style /
// arbitrary-token usage on a product surface.
function countByRuleFile(violations) {
  const counts = new Map()
  for (const v of violations) {
    const key = `${v.ruleId}:${v.file}`
    const entry = counts.get(key)
    if (entry) entry.count += 1
    else counts.set(key, { ruleId: v.ruleId, file: v.file, count: 1 })
  }
  return counts
}

const current = collectViolations()
const currentCounts = countByRuleFile(current)

if (WRITE_BASELINE) {
  const counts = [...currentCounts.values()].sort(
    (a, b) => a.ruleId.localeCompare(b.ruleId) || a.file.localeCompare(b.file)
  )
  const payload = {
    generatedAt: new Date().toISOString(),
    rules: rules.map(({ id, description }) => ({ id, description })),
    counts,
  }
  writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`)
  console.log(`Wrote baseline with ${counts.length} file/rule entries (${current.length} total violations) to ${relative(ROOT, BASELINE_PATH)}`)
  process.exit(0)
}

if (!existsSync(BASELINE_PATH)) {
  console.error(`Missing baseline file: ${relative(ROOT, BASELINE_PATH)}. Run style guardrail with --write-baseline.`)
  process.exit(1)
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"))
const baselineCounts = new Map((baseline.counts ?? []).map((item) => [`${item.ruleId}:${item.file}`, item.count]))

const regressions = []
for (const [key, entry] of currentCounts) {
  const allowed = baselineCounts.get(key) ?? 0
  if (entry.count > allowed) {
    const lines = current
      .filter((v) => v.ruleId === entry.ruleId && v.file === entry.file)
      .map((v) => v.line)
    regressions.push({ ...entry, allowed, lines })
  }
}
regressions.sort((a, b) => a.ruleId.localeCompare(b.ruleId) || a.file.localeCompare(b.file))

if (regressions.length > 0) {
  console.error("Detected new style-token guardrail regressions:\n")
  for (const r of regressions) {
    console.error(`- [${r.ruleId}] ${r.file}: ${r.count} occurrences, baseline allows ${r.allowed} (lines ${r.lines.join(", ")})`)
  }
  console.error("\nUse governed design tokens/component variants instead of ad-hoc inline values.")
  console.error("If these occurrences are intentional and reviewed, refresh the baseline with:")
  console.error("  npm run lint:style-guardrails -- --write-baseline")
  process.exit(1)
}

const totalTracked = [...currentCounts.values()].reduce((sum, e) => sum + e.count, 0)
console.log(`Style guardrails passed (${totalTracked} tracked baseline violations across ${currentCounts.size} file/rule entries, 0 regressions).`)
