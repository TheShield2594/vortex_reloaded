# 19 — Accessibility (a11y)

> Covers: screen reader support, keyboard navigation, focus management, ARIA attributes, color contrast, reduced motion, live announcements, semantic HTML.

**Components under test:** All components — a11y is cross-cutting.

**Key references:**
- `aria-live="polite"` region for message announcements
- `role="log"` with `aria-relevant="additions"` on message container
- `use-reduced-motion.ts` hook
- `use-keyboard-shortcuts.ts` hook

---

## 19.1 Screen Reader Support

### `screen-reader.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should announce new messages via aria-live | Receive new message | `aria-live="polite"` region updated with author + preview |
| 2 | should use role="log" on message container | Inspect message list | `role="log"` present |
| 3 | should set aria-relevant="additions" | Inspect container | Attribute present |
| 4 | should label all buttons | Inspect buttons | `aria-label` or visible text on every button |
| 5 | should label all inputs | Inspect inputs | Associated `<label>` or `aria-label` |
| 6 | should label all images | Inspect images | `alt` attribute on all `<img>` |
| 7 | should use semantic headings hierarchy | Inspect headings | h1 → h2 → h3 in order |
| 8 | should label navigation landmarks | Inspect nav elements | `aria-label` on `<nav>` elements |
| 9 | should label modal dialogs | Inspect dialogs | `aria-labelledby` or `aria-label` |
| 10 | should describe form validation errors | Submit invalid form | `aria-describedby` linking to error |

---

## 19.2 Keyboard Navigation

### `keyboard-navigation.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should navigate server sidebar with keyboard | Tab/arrow keys | Focus moves through servers |
| 2 | should navigate channel sidebar with keyboard | Tab/arrow keys | Focus moves through channels |
| 3 | should navigate message list with keyboard | Arrow keys | Focus moves through messages |
| 4 | should navigate member list with keyboard | Tab/arrow keys | Focus moves through members |
| 5 | should open/close modals with keyboard | Escape to close, Enter to confirm | Modals respond to keyboard |
| 6 | should navigate emoji picker with keyboard | Arrow keys + Enter | Navigate and select emoji |
| 7 | should navigate autocomplete with keyboard | Arrow keys | Move through suggestions |
| 8 | should focus message input on channel switch | Navigate to new channel | Input auto-focused |
| 9 | should trap focus within modals | Tab within modal | Focus stays in modal |
| 10 | should return focus on modal close | Open modal → close | Focus returns to trigger |

---

## 19.3 Keyboard Shortcuts

### `keyboard-shortcuts.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should open quickswitcher with Ctrl+K | Press Ctrl+K | Quickswitcher opens |
| 2 | should open search with Ctrl+F | Press Ctrl+F | Search opens |
| 3 | should navigate with Ctrl+Shift+Arrow | Press shortcut | Navigate servers/channels |
| 4 | should show keyboard shortcuts modal | Press ? or shortcut | Shortcuts modal shown |
| 5 | should edit last message with Up arrow | Focus empty input → press Up | Last message enters edit mode |
| 6 | should support all registered keybinds | Test each keybind | All function correctly |

---

## 19.4 Focus Management

### `focus-management.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show visible focus indicators | Tab through page | Focus ring visible on every interactive element |
| 2 | should not trap focus unexpectedly | Tab through page | Can reach all areas |
| 3 | should manage focus on route change | Navigate to new page | Appropriate element focused |
| 4 | should manage focus on dynamic content | New message arrives | Focus not stolen from current input |
| 5 | should skip to main content | Tab from top | "Skip to content" link available |

---

## 19.5 Color & Contrast

### `color-contrast.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should meet WCAG AA contrast ratio (4.5:1 for text) | Run axe-core `color-contrast` rule + scripted checks on `body, p, button, a, input` selectors | All ratios >= 4.5:1 |
| 2 | should meet WCAG AA for large text (3:1) | Run axe-core `color-contrast` on `.large-text, h1, h2, h3` selectors | All ratios >= 3:1 |
| 3 | should not rely solely on color for information | Run axe-core `color-contrast` + `link-in-text-block` rules; verify status indicators use shape/icon + color | Shape/icon accompanies color |
| 4 | should work in high contrast mode | Enable high contrast | All content readable |
| 5 | should work in dark and light themes | Switch themes | Contrast maintained |

---

## 19.6 Reduced Motion

### `reduced-motion.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should respect prefers-reduced-motion | Set OS preference | Animations disabled |
| 2 | should disable shimmer on skeleton screens | Reduced motion on | No shimmer |
| 3 | should disable transition animations | Reduced motion on | Instant transitions |
| 4 | should toggle via settings | Accessibility → Reduced Motion | Setting takes effect |
| 5 | should use use-reduced-motion hook | Check hook behavior | Returns correct boolean |

---

## 19.7 Automated a11y Scans

### `axe-scans.spec.ts`

> Use `@axe-core/playwright` for automated WCAG scanning.

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should pass axe scan on login page | Navigate → scan | Zero violations |
| 2 | should pass axe scan on channel page | Navigate → scan | Zero violations |
| 3 | should pass axe scan on DM page | Navigate → scan | Zero violations |
| 4 | should pass axe scan on settings page | Navigate → scan | Zero violations |
| 5 | should pass axe scan on server settings | Navigate → scan | Zero violations |
| 6 | should pass axe scan on moderation page | Navigate → scan | Zero violations |
| 7 | should pass axe scan on discover page | Navigate → scan | Zero violations |
| 8 | should pass axe scan on profile page | Navigate → scan | Zero violations |
| 9 | should pass axe scan with modal open | Open modal → scan | Zero violations |
| 10 | should pass axe scan on mobile viewport | Set mobile viewport → scan | Zero violations |
