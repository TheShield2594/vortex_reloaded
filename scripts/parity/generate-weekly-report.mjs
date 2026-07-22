import fs from "node:fs"
import path from "node:path"

const root = process.cwd()
const matrixPath = path.join(root, "docs/parity/parity-evaluation-matrix.json")
const trendPath = path.join(root, "docs/parity/reports/parity-trend.json")
const webResultsPath = path.join(root, "apps/web/.reports/parity-critical.json")
const focusResultsPath = path.join(root, "apps/web/.reports/a11y-focus.json")
const signalResultsPath = path.join(root, "apps/signal/.reports/voice-parity.json")
const reportOut = path.join(root, "docs/parity/reports/weekly-parity-report.md")

const matrix = JSON.parse(fs.readFileSync(matrixPath, "utf8"))
const trend = JSON.parse(fs.readFileSync(trendPath, "utf8"))

function safeReadJson(file) {
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, "utf8"))
}

function isVitestPass(result) {
  if (!result) return false
  if (typeof result.success === "boolean") return result.success
  return (result.numFailedTests ?? 0) === 0 && (result.numFailedTestSuites ?? 0) === 0
}

const webResults = safeReadJson(webResultsPath)
const focusResults = safeReadJson(focusResultsPath)
const signalResults = safeReadJson(signalResultsPath)

const automatedStatus = {
  "P0-MSG-LIFECYCLE": isVitestPass(webResults),
  "P0-PERMISSIONS": isVitestPass(webResults),
  "P0-VOICE-JOIN-RECONNECT": isVitestPass(signalResults),
  "P0-MODERATION": isVitestPass(webResults),
  "P0-A11Y-FOCUS-ORDER": isVitestPass(focusResults),
}

let weightedEarned = 0
let weightedTotal = 0
const rows = []

for (const item of matrix.items) {
  weightedTotal += item.weight
  const passed = item.type === "manual" ? item.status === "pass" : !!automatedStatus[item.id]
  if (passed) weightedEarned += item.weight
  rows.push({ item, passed })
}

const parityScore = Math.round((weightedEarned / weightedTotal) * 100)
const week = new Date().toISOString().slice(0, 10)
trend.history = trend.history.filter((entry) => entry.week !== week)
trend.history.push({ week, parityScore, passed: weightedEarned, total: weightedTotal })
fs.writeFileSync(trendPath, JSON.stringify(trend, null, 2) + "\n")

const passCount = rows.filter((r) => r.passed).length
const failCount = rows.length - passCount
const body = [
  "# Weekly Parity Acceptance Report",
  "",
  `- Week: ${week}`,
  `- Parity score: **${parityScore}%** (${weightedEarned}/${weightedTotal} weighted points)`,
  `- Checks: ${passCount} pass / ${failCount} fail`,
  "",
  "## Check Results",
  "",
  "| Check | Type | Owner | Result | Weight |",
  "| --- | --- | --- | --- | ---: |",
  ...rows.map(({ item, passed }) => `| ${item.id} | ${item.type} | ${item.owner} | ${passed ? "✅ Pass" : "❌ Fail"} | ${item.weight} |`),
  "",
  "## 4-Week Trend",
  "",
  "| Week | Parity Score | Weighted Pass |",
  "| --- | ---: | ---: |",
  ...trend.history.slice(-4).map((entry) => `| ${entry.week} | ${entry.parityScore}% | ${entry.passed}/${entry.total} |`),
  "",
]

fs.writeFileSync(reportOut, body.join("\n"))
console.log(`Generated ${reportOut}`)
