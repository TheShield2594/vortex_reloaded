// Workbox injectManifest — runs after `next build`.
// Reads sw.src.js, replaces self.__WB_MANIFEST with the list of
// content-hashed /_next/static/ assets, and writes public/sw.js.
import { injectManifest } from "workbox-build"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const { count, size, warnings } = await injectManifest({
  swSrc: join(root, "sw.src.js"),
  swDest: join(root, "public", "sw.js"),
  globDirectory: join(root, ".next"),
  // Only cache immutable, content-hashed Next.js static assets.
  // Public-dir assets (icons, manifest) are handled by APP_SHELL_ASSETS in the SW.
  globPatterns: ["static/**/*.{js,css,woff2}"],
  modifyURLPrefix: { "static/": "/_next/static/" },
  // Next.js already embeds content hashes in filenames — no extra revision needed.
  dontCacheBustURLsMatching: /\/_next\/static\//,
  maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
})

if (warnings.length > 0) {
  console.warn("Workbox warnings:", warnings)
}
console.log(
  `✓ SW built: ${count} precache entries (${(size / 1024).toFixed(0)} KB total)`
)
