"use client"

import { useEffect, useRef } from "react"

/**
 * useGifAutoplay — observes `data-gif-autoplay` on `<html>` and swaps GIF
 * images for a static canvas snapshot when autoplay is disabled. On hover the
 * original GIF src is restored; on mouseleave the static frame is shown again.
 *
 * How it works:
 * 1. When autoplay is toggled OFF, find all `<img>` whose `src` ends in `.gif`.
 * 2. Draw the current (first visible) frame onto an off-screen canvas.
 * 3. Convert the canvas to a data-URL and store it as `data-static-src`.
 * 4. Set `img.src` to the static data-URL.
 * 5. Attach mouseenter/mouseleave listeners that swap between the static
 *    frame and the original GIF.
 * 6. When autoplay is toggled back ON, restore all original srcs and remove
 *    listeners.
 */
export function useGifAutoplay(enabled: boolean): void {
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    // Clean up previous listeners on every toggle
    cleanupRef.current?.()
    cleanupRef.current = null

    if (enabled) {
      // Autoplay ON — restore any previously-paused GIFs
      restoreAllGifs()
      return
    }

    // Autoplay OFF — freeze all visible GIFs
    const controllers: AbortController[] = []

    function freezeGif(img: HTMLImageElement): void {
      // Skip if already frozen or if src isn't a gif
      if (img.dataset.originalGifSrc) return
      const src = img.src ?? ""
      if (!src.match(/\.gif(\?|$)/i)) return

      const originalSrc = src
      img.dataset.originalGifSrc = originalSrc

      // Per-image abort controller — covers both the load listener and hover
      // listeners so cleanup cancels any pending work for this image.
      const imgAc = new AbortController()
      controllers.push(imgAc)

      // Wait for the image to load so we can draw its first frame
      const doFreeze = (): void => {
        // Guard: if cleanup already ran, don't proceed
        if (imgAc.signal.aborted) {
          delete img.dataset.originalGifSrc
          return
        }

        try {
          const canvas = document.createElement("canvas")
          canvas.width = img.naturalWidth || img.width || 200
          canvas.height = img.naturalHeight || img.height || 200
          const ctx = canvas.getContext("2d")
          if (!ctx) return
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
          const staticSrc = canvas.toDataURL("image/png")
          img.dataset.staticSrc = staticSrc
          img.src = staticSrc
        } catch {
          // Canvas tainted by CORS — leave the GIF as-is
          delete img.dataset.originalGifSrc
          return
        }

        // Hover to play, leave to pause
        img.addEventListener("mouseenter", () => {
          if (img.dataset.originalGifSrc) {
            img.src = img.dataset.originalGifSrc
          }
        }, { signal: imgAc.signal })

        img.addEventListener("mouseleave", () => {
          if (img.dataset.staticSrc) {
            img.src = img.dataset.staticSrc
          }
        }, { signal: imgAc.signal })
      }

      if (img.complete && img.naturalWidth > 0) {
        doFreeze()
      } else {
        img.addEventListener("load", doFreeze, { once: true, signal: imgAc.signal })
      }
    }

    // Freeze existing GIFs
    document.querySelectorAll<HTMLImageElement>('img[src$=".gif"], img[src*=".gif?"]').forEach(freezeGif)

    // Observe DOM for newly-added GIFs
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLImageElement) {
            freezeGif(node)
          } else if (node instanceof HTMLElement) {
            node.querySelectorAll<HTMLImageElement>('img[src$=".gif"], img[src*=".gif?"]').forEach(freezeGif)
          }
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })

    cleanupRef.current = (): void => {
      observer.disconnect()
      controllers.forEach((ac) => ac.abort())
      restoreAllGifs()
    }

    return (): void => {
      cleanupRef.current?.()
      cleanupRef.current = null
    }
  }, [enabled])
}

/** Restore all frozen GIFs back to their original animated src. */
function restoreAllGifs(): void {
  document.querySelectorAll<HTMLImageElement>("img[data-original-gif-src]").forEach((img) => {
    const original = img.dataset.originalGifSrc
    if (original) {
      img.src = original
    }
    delete img.dataset.originalGifSrc
    delete img.dataset.staticSrc
  })
}
