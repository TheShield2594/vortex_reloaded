// Spike runner for issue #11: builds `entry.ts` (real livekit-client +
// the actual apps/web EqTrackProcessor) into a browser bundle, serves it
// over a local static server, and drives it with a real Chromium instance
// using a fake microphone device. No `livekit-server` involved — see
// entry.ts's header comment for why that's the correct scope for this
// checklist.
import assert from "node:assert/strict"
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import esbuild from "esbuild"
import { chromium } from "playwright"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function buildBundle() {
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, "entry.ts")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2020",
    define: { "process.env.NODE_ENV": '"production"' },
  })
  return result.outputFiles[0].text
}

function startServer(bundleText) {
  const html = `<!doctype html><html><head><title>eq-track-processor spike</title></head>
<body><script>${bundleText}</script></body></html>`

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" })
    res.end(html)
  })

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server))
  })
}

async function main() {
  console.log("Bundling entry.ts with esbuild...")
  const bundleText = await buildBundle()

  console.log("Starting local static server...")
  const server = await startServer(bundleText)
  const { port } = server.address()
  const url = `http://127.0.0.1:${port}/`

  console.log("Launching Chromium with a fake audio device...")
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/opt/pw-browsers/chromium",
    args: [
      "--no-sandbox",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  })

  try {
    const context = await browser.newContext()
    await context.grantPermissions(["microphone"])
    const page = await context.newPage()
    page.on("console", (msg) => console.log(`[browser] ${msg.text()}`))
    page.on("pageerror", (err) => console.error(`[browser error] ${err}`))

    await page.goto(url)
    await page.waitForFunction(() => window.__spikeResults__ !== undefined, { timeout: 15000 })
    const { results, errors, ok } = await page.evaluate(() => window.__spikeResults__)

    console.log("\nResults:")
    for (const [name, passed] of Object.entries(results)) {
      console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}`)
    }

    assert.ok(ok, `Spike checks failed:\n${errors.join("\n")}`)
    console.log("\nAll checks passed.")
  } finally {
    await browser.close()
    server.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
