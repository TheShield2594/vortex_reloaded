import fs from "node:fs"
import path from "node:path"

const root = path.resolve("apps/web")
const exts = [".ts", ".tsx"]

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (exts.includes(path.extname(entry.name))) out.push(full)
  }
  return out
}

const files = walk(root)
const graph = new Map(files.map((f) => [f, []]))

function resolveImport(from, spec) {
  if (!spec.startsWith(".") && !spec.startsWith("@/")) return null
  const base = spec.startsWith("@/") ? path.join(root, spec.slice(2)) : path.resolve(path.dirname(from), spec)
  const candidates = [
    ...exts.map((ext) => `${base}${ext}`),
    ...exts.map((ext) => path.join(base, `index${ext}`)),
  ]
  for (const c of candidates) if (fs.existsSync(c)) return c
  return null
}

const importRe = /import\s+(?:[^"']+from\s+)?["']([^"']+)["']/g
for (const file of files) {
  const src = fs.readFileSync(file, "utf8")
  let m
  while ((m = importRe.exec(src)) !== null) {
    const resolved = resolveImport(file, m[1])
    if (resolved && graph.has(resolved)) graph.get(file).push(resolved)
  }
}

const visiting = new Set()
const visited = new Set()
const stack = []
const cycles = new Set()

function dfs(node) {
  visiting.add(node)
  stack.push(node)
  for (const next of graph.get(node) ?? []) {
    if (!visited.has(next) && !visiting.has(next)) dfs(next)
    else if (visiting.has(next)) {
      const idx = stack.indexOf(next)
      if (idx >= 0) {
        const cycle = [...stack.slice(idx), next].map((p) => path.relative(root, p)).join(" -> ")
        cycles.add(cycle)
      }
    }
  }
  stack.pop()
  visiting.delete(node)
  visited.add(node)
}

for (const file of files) if (!visited.has(file)) dfs(file)

if (cycles.size) {
  console.error("Found circular dependencies in apps/web:")
  for (const cycle of [...cycles].sort()) console.error(`- ${cycle}`)
  process.exit(1)
}

console.log(`No circular dependencies found across ${files.length} files in apps/web`)
