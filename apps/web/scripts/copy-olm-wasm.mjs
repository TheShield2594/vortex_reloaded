// Copies @matrix-org/olm's WASM binary into public/ so the browser can fetch
// it directly (Olm.init({ locateFile }) — see lib/olm-protocol.ts). This
// is a plain static-asset copy, not a webpack/wasm-loader integration, since
// olm.js (the Emscripten glue) fetches the .wasm file itself at runtime
// rather than being imported as a WASM module.
import { copyFileSync, existsSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { createRequire } from "module"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)

const src = require.resolve("@matrix-org/olm/olm.wasm")
const dest = join(root, "public", "olm.wasm")

if (!existsSync(src)) {
  console.error(`✗ olm.wasm not found at ${src} — is @matrix-org/olm installed?`)
  process.exit(1)
}

copyFileSync(src, dest)
console.log(`✓ Copied olm.wasm to public/olm.wasm`)
