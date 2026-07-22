# 12 — Media & Attachments

> Covers: file upload, image preview, lightbox, video player, audio player, attachment download, attachment decay/expiry, purged file handling, oEmbed.

**Components under test:**
- `image-lightbox.tsx` (in chat)
- `message-input.tsx` (file attachment)
- `message-item.tsx` (attachment display)
- API: `/api/messages` (with attachments), `/api/attachments/[attachmentId]/download`
- API: `/api/dm/attachments/[attachmentId]/download`
- API: `/api/oembed`
- API (cron): `/api/cron/attachment-decay`
- `packages/shared/src/attachment-decay.ts` — `computeDecay()`

---

## 12.1 File Upload

### `file-upload.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should upload a file via attach button | Click attach → select file → send | File uploaded; attachment shown in message |
| 2 | should upload via drag-and-drop | Drag file onto message area | Upload starts; file sent |
| 3 | should upload via paste | Copy image → Ctrl+V in message input | Image uploaded |
| 4 | should show upload progress | Upload large file | Progress indicator |
| 5 | should handle multiple file upload | Select 3 files | All 3 uploaded |
| 6 | should reject files exceeding 10 MB | Upload 11 MB file | 413 error; user notification |
| 7 | should reject disallowed file types (if configured) | Upload blocked type | Error message |
| 8 | should show file name and size | Upload file | Name + size displayed in message |
| 9 | should require ATTACH_FILES permission | Login without permission → try upload | Upload blocked |
| 10 | should add text message alongside attachment | Type message + attach file → send | Both text and attachment |

---

## 12.2 Image Preview & Lightbox

### `image-lightbox.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show image thumbnail in message | Send image | Thumbnail rendered inline |
| 2 | should open lightbox on image click | Click image | Full-size lightbox opens |
| 3 | should close lightbox on background click | Click outside image | Lightbox closes |
| 4 | should close lightbox on Escape | Press Escape | Lightbox closes |
| 5 | should zoom image in lightbox | Click zoom or scroll | Image zooms |
| 6 | should navigate between images | Arrow keys or buttons | Next/prev image |
| 7 | should show image filename in lightbox | View lightbox | Filename displayed |
| 8 | should download from lightbox | Click download | File downloads |

---

## 12.3 Video Player

### `video-player.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should render inline video player for video/* | Upload video file | `<video controls>` element |
| 2 | should play video | Click play | Video plays |
| 3 | should show video controls | View player | Play, pause, seek, volume, fullscreen |
| 4 | should handle unsupported format | Upload rare format | Fallback download link |

---

## 12.4 Audio Player

### `audio-player.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should render inline audio player for audio/* | Upload audio file | `<audio controls>` element |
| 2 | should play audio | Click play | Audio plays |
| 3 | should show audio controls | View player | Play, pause, seek, volume |
| 4 | should show audio duration | View player | Duration displayed |

---

## 12.5 Attachment Download

### `attachment-download.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should download channel attachment | Click download button | File downloads |
| 2 | should download DM attachment | Click download in DM | File downloads |
| 3 | should set correct filename | Download | Original filename preserved |
| 4 | should renew expiry on download near expiry | Download file close to `expires_at` | `expires_at` extended |
| 5 | should return 410 for purged files | Access purged attachment | "This file is no longer available" |
| 6 | should handle missing attachment ID | Request bogus ID | 404 |

---

## 12.6 Attachment Decay System

### `attachment-decay.spec.ts`

> Includes API-level tests and unit tests for `computeDecay()`.

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should compute ≤5 MB → 3 years expiry | Call `computeDecay(5 * 1024 * 1024)` | ~1095 days |
| 2 | should compute ≥500 MB → 14 days expiry | Call `computeDecay(500 * 1024 * 1024)` | 14 days |
| 3 | should compute log-linear blend for mid-range | Call `computeDecay(50 * 1024 * 1024)` | Between 14 and 1095 days |
| 4 | should set `expires_at` on channel upload | Upload file → check DB | `expires_at` computed and set |
| 5 | should set `expires_at` on DM upload | Upload file in DM → check DB | `expires_at` set |
| 6 | should extend expiry via `maybeRenewExpiry` | Download near expiry | `expires_at` pushed forward |
| 7 | should not extend expiry if far from expiration | Download fresh file | `expires_at` unchanged |
| 8 | should purge expired files via cron | Trigger `/api/cron/attachment-decay` | Expired files removed from storage |
| 9 | should mark purged files with `purged_at` | After cron run | `purged_at` timestamp set |
| 10 | should batch purge (max 200 per run) | 300 expired files | 200 purged; 100 remain for next run |

---

## 12.7 Web Share API

### `web-share.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show share option in message context menu | Right-click message | "Share" option visible |
| 2 | should invoke navigator.share() | Click share | Share sheet opens (or mock) |
| 3 | should handle share API not available | Non-supporting browser | Share option hidden |
