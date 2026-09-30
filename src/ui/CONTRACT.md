# src/ui CONTRACT (U1 foundation · T1.1a.U0 · v2, 2026-09-27)

v2 (PR2): Field `inputClassName` · Menu `before` · Toast is a named `region` (+ `label`) · PhotoSlot = the v2.0 slot
API · KeepWhole · routes · `agentRules: false` in next.config.

Stable API every UI lane (U2-U7) builds against from minute one. U1 owns `src/ui/**`, `src/app/layout.tsx`,
`src/app/admin/(app)/layout.tsx`, `next.config.*`. Any change to this file = a message to the orchestrator first.
Copy of record: `documents/requirements/timewithjon/ui-lanes/contract.md`.

## 0 · Rules in one screen

- **Class names = the pack's `assets/site.css`, verbatim** (ported to `src/ui/site.css`, loaded once by the root
  layout). Paste pack markup (`designs/final/*.html`, `gen.py def <screen>`) as JSX and keep its classes. Never add
  a global stylesheet or a CSS module in a lane; a missing style = ask U1.
- **Tokens** = `src/ui/tokens.css` (design-tokens.css v1.12 verbatim: `--c-*`, `--s1..`, `--t-*`, …). Inline
  `style={{ marginTop: 'var(--s5)' }}` exactly where the pack does it inline; no raw hex/px of your own.
- **Accent (v2.2, Jon decisions 44 + 46)** = `--c-gilt` #D4A62A: a FILL behind ink only (picked time, Sent stamp, the one
  swipe, `::selection`); ink on gilt 7.29:1. Never text, never a border; ink-3 and error text are not AA on it. The v1
  neon green (`--c-acid`) is gone.
- **Import path:** `import { Button, Sheet, … } from '@/ui'` (barrel `src/ui/index.ts`); focus helpers from
  `@/ui/focus`. Client components are marked `'use client'` inside `src/ui`; lanes don't need to wrap them.
- **Focus (decision 29):** never call `el.focus()`, `el.scrollIntoView()`, `window.scrollTo/By` yourself. Use
  `@/ui/focus` (§3). Missing capability = ask U1 through the orchestrator.
- **No lost clicks (INT-06):** stable React `key`s (ids, never indexes of filtered lists); never re-key or unmount the
  element under a pending pointer: defer such swaps with `whenFree(fn)` (§3).
- **Tests select by role / accessible name only** (no test ids, no class selectors). Every component below exposes
  a proper role + name.
- **Photo slots (decision 35):** every photo position on a GUEST screen is `<PhotoSlot>` (§2.12): an empty `.ph`
  box with its aspect ratio and future alt. No image, no photo grade, no hero art until "G1 SIGNED".
- **Copy:** from `src/content/*`. Strings the pack shows but `src/content` lacks go in your lane's own
  `src/content/ui/<lane>.ts`, marked `// PACK v1.12 <screen>` (the approved G1 copy, decision 31); wording the pack
  doesn't have is marked `// NEW COPY (needs Jon)`. Never invent copy. U1's own: `src/content/ui/foundation.ts`.

## 1 · Files

| Path                             | What                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/ui/tokens.css`              | design tokens v1.12 (verbatim; `@font-face` replaced by next/font variables)                       |
| `src/ui/site.css`                | the pack's site.css port (every class kept) + base: one focus ring, reduced motion, scroll-padding |
| `src/ui/focus.ts`                | THE focus helper (§3)                                                                              |
| `src/ui/FocusRoot.tsx`           | mounts the focus listeners + the text-size probe + the live region (root layout only)              |
| `src/ui/index.ts`                | barrel for every component below                                                                   |
| `src/app/fonts.ts`               | `newsreader`, `schibsted` (next/font/local; files + OFL-1.1 licences in `public/fonts/`)           |
| `src/app/layout.tsx`             | `<html lang="en-CA">` + fonts + css + skip link + `<FocusRoot/>` + `<StagingBanner/>`              |
| `src/app/admin/(app)/layout.tsx` | AdminShell route group: every signed-in admin page lives under `src/app/admin/(app)/`              |
| `src/app/not-found.tsx`          | S15 404                                                                                            |
| `src/app/dev/axe/page.dev.tsx`   | prototype-only page rendering every primitive (axe target)                                         |

## 2 · Components (props are TypeScript; `children?: ReactNode` implied where it makes sense)

### 2.1 Stack — `<Stack as?="div"|"section"|"ul"|… className?>` → `<div class="stack">` (the `.stack > * + *` rhythm).

### 2.2 Button

```ts
type ButtonProps = {
  variant?: 'default' | 'commit'; // .btn | .btn .btn--commit (ONE commit per screen)
  size?: 'sm'; // .btn--sm
  block?: boolean; // .btn--block
  dt?: boolean; // .btn--dt (two-part label: <span>Lock in</span> <span>date</span>)
  href?: string; // renders next/link <a class="btn …"> instead of <button>
  type?: 'button' | 'submit'; // default 'button'
  disabled?: boolean; // rendered as aria-disabled="true" (stays focusable), click swallowed
  busy?: string; // when set: label replaced by it + aria-disabled (e.g. FLOW 'Sending…')
  className?: string; // extra pack classes only, e.g. 'sug', 'more more--m'
  onClick?;
  'aria-label'?;
  'aria-describedby'?;
  'aria-haspopup'?;
  'aria-expanded'?;
  'aria-controls'?;
  id?;
  form?;
};
```

`<TextButton>` → `<button class="textbtn">` (secondary actions, 44 px hit area); `<TextLink href>` → `<a class="link">`.

### 2.3 Field

```ts
type FieldProps = {
  id: string;
  label: ReactNode;
  hint?: ReactNode; // inline <span class="hint"> inside the label (pack s10)
  help?: ReactNode; // persistent <p class="help" id="{id}-h"> under the label (pack a3b "Before 60")
  error?: string | null; // .field.bad + <p class="err" id="{id}-e"> ; the control gets aria-invalid
  multiline?: boolean; // <textarea class="textarea"> instead of <input class="input">
  className?: string; // on the .field wrapper
  inputClassName?: string; // extra pack classes on the control itself (a1b: 'input code-in')
  style?: CSSProperties;
} & Omit<InputHTMLAttributes | TextareaHTMLAttributes, 'id' | 'className'>; // name, type, autoComplete, value, onChange…
```

The control always carries `aria-describedby` = help id + error id (error `<p>` is kept in the DOM, `hidden` when empty).
`<FieldGroup label hint id>` → `.field` with `<span class="label">` + role=group for steppers/radios.

### 2.4 List — `<List items={T[]} getKey={(t)=>string} render={(t)=>ReactNode} className?="rows"|"actions"|… as?="ul"|"ol">`

Stable keys only (INT-06). Empty: pass `empty={<li …/>}`.

### 2.5 Sheet (bottom sheet on phones, side panel from the pack breakpoint; native `<dialog class="sheet">`)

```ts
type SheetProps = {
  id: string;
  open: boolean;
  onClose: () => void;
  title: ReactNode; // <h2 class="h2" id="{id}-h" tabIndex=-1> — focus lands here on open
  cap?: ReactNode; // <p class="cap"> above the title (pack s05)
  closeLabel: string; // aria-label of × , e.g. 'Close The Long Lunch' (from content)
  footer?: ReactNode; // <p class="sheet-f"> (pack a3c Cancel)
  media?: ReactNode; // above .sheet-h, under the grab bar (pack s05: <PhotoSlot kind="sheet">)
};
```

`showModal()` (background inert), focus → title, Tab/Shift+Tab trapped inside, Esc / × / scrim click / any
`data-close` element close it, focus returns to the invoker (via `useReturnFocus`). The opener only sets
`open` state; use `aria-haspopup="dialog"` on it.

### 2.6 Menu (desktop ⋯, APG menu button; pack a3c)

```ts
type MenuItem = { key: string; label: ReactNode } & ({ href: string } | { onSelect: () => void });
type MenuProps = {
  id: string;
  buttonLabel: string /* 'More for Priya' */;
  items: MenuItem[];
  className?: string;
  before?: ReactNode; // rendered first inside .more-wrap (the phone ⋯ .more--m Button that opens a Sheet)
};
```

Renders `<button class="btn more more--d" aria-haspopup="menu" aria-expanded aria-controls>⋯</button>` +
`<ul class="popmenu" role="menu">`. ArrowDown/Up/Home/End move, Enter/Space activate, Esc closes → focus back to ⋯,
Tab/Shift+Tab close and move to the control after/before ⋯ (FOC-03), outside click closes. Places itself below
(or above when short; scrolls inside at 200% text). The phone ⋯ (`more--m`) is a Button with
`aria-haspopup="dialog"` opening a `Sheet`: compose both yourself (CSS shows one per width).

### 2.7 Toast (undo countdown; pack a3b)

```ts
type ToastProps = {
  message: ReactNode; // [data-toast-msg] 'Locked in: Priya, Fri May 14 · noon–2 pm.'
  sub: (secondsLeft: number) => ReactNode; // 'Invite goes out in 10 s.'
  pausedText: ReactNode; // shown while paused (hover or the user's own focus)
  undoLabel: string;
  undoVh?: string; // 'Undo' + visually hidden ' lock-in for Priya'
  seconds?: number; // default 10
  onUndo: () => void;
  onExpire: () => void;
  keepAbove?: RefObject<HTMLElement | null>; // a status line kept above the toast (a3b 'Sending…', INT-09)
  label?: string; // the region's name; default = the message line (aria-labelledby, steady while paused)
};
```

The box is `role="region"` with an accessible name (tests: `getByRole('region', { name: /Locked in/ })`). On mount: reserves room at the foot (`html.toast-on`, `--toast-clear`), keeps the toast in view, lands focus on
Undo (script focus, does not pause). Counts down ONLY while ≥50 % in view (`useInView`, FOC-01); hover or the
user's own focus inside pauses and resets to `seconds`; Undo is ignored for 600 ms after mount (double tap);
resize/text-size refit follows `resizeMayKeep`. Unmount cleans `toast-on`. Lanes own what Undo/expire DO
(server calls, the page swap, focus after: `moveFocus(capRef.current)`).

### 2.8 SiteHeader / SiteFooter (pack s01 header/`FOOT`)

`<SiteHeader />` = wordmark + nav (The Activity Menu, Send a story d-only; "No gifts" is gone, Jon decision 45). `<SiteHeader back={{ href, label }} />`
= the back-link variant. `<SiteFooter />` = the two `FOOTER` lines only (Jon's menu polish removed the `.credits` block: the one stand-in left, something-new, is under the Unsplash License, which asks for no attribution; its `credit` record stays in photo-slots.ts as provenance). `photos?` is still accepted and ignored until the callers drop it. Every public/img file is sha256-allowlisted (tests/unit/ui/public-img-allowlist.test.ts). Both server components.

### 2.9 AdminShell — `src/app/admin/(app)/layout.tsx` (server)

`requireAdmin()`: flag off → `notFound()`; not signed in / not allowed → `redirect('/admin/sign-in')` (U5 owns that
page, OUTSIDE the group). Renders `.adm > .adm-top + .adm-shell > nav.adm-side + <main id="main" class="adm-main">
{children}</main> + nav.tabbar`. Nav: Requests `/admin` (badge = Needs a reply count), Season `/admin/season`,
Links `/admin/invites`, Stories `/admin/stories`, More `/admin/settings`; `aria-current="page"` by pathname prefix.
Pages render ONLY their `<section class="adm-list">` / `<section class="adm-detail">` (+ `d-pane` classes) inside
main, and still call `requireAdmin()` themselves (AGENTS.md rule 4) BEFORE any `@/features` data call, stopping on the
Response it returns: a layout and its page render in parallel, so the layout's check can't stop a page's queries
(enforced by `tests/unit/ui/admin-pages-static.test.ts`). `/admin/:path*` answers `Cache-Control: private, no-store`
(next.config). The toast goes first in main (pack a3b).
`<AdminSolo>` = the `.solo` wrapper for sign-in pages (a1*), exported for U5.

### 2.10 NotFound (S15) — `src/app/not-found.tsx`: header, `h1.h1` NOT_FOUND.line, `Button href={ROUTES.menu}` NOT_FOUND.back.

### 2.11 StagingBanner — rendered by the root layout only when `APP_MODE=staging`; lanes do nothing.

### 2.12 PhotoSlot (the v2.0 slot API, `the design pack CONTRACT.md`)

`<PhotoSlot slot="hero" kind="hero" alt?="" className?>` → `<figure class="ph ph--hero" data-slot="hero" data-alt=""
aria-hidden="true">`. `slot` = the v2.0 slots.json key; `kind` ∈ hero · band · dish · sheet · thumb · sent · wine · close
(the ratio: site.css, `var(--ph-ratio-*, v2 fallback)`); `alt` '' = decorative. G1 SIGNED: a slot listed in `photo-slots.ts` renders `<img src srcset sizes alt>` (no aria-hidden; `priority="hero"` = eager + preload); an unlisted slot stays the empty box. Credits: SiteFooter `photos`.

### 2.13 VisuallyHidden `<Vh>` → `<span class="vh">`. `announce(msg)` (from `@/ui/focus`) speaks via the one `#live` region.

## 3 · `@/ui/focus` API (client-only; no-ops on the server)

```ts
export type FocusReason = 'script' | 'keyboard' | 'pointer';
moveFocus(el: HTMLElement | null, reason?: FocusReason): void
  // focus without the browser jump, then keepVisible (skipped for 'pointer'). THE way to move focus.
keepVisible(el: HTMLElement | null): void
  // bring fully into view (own scroller first, then page; instant, block nearest), then lift above any
  // fixed/sticky .tabbar/.actbar/.sbar/.toast covering it (FOC-05/06). Used for focus AND for the toast.
focusOrigin(): 'pointer' | 'key' | 'script'        // origin of the current focus (the focusin rule)
byPointer(el: Element): boolean                    // this focus came from a press on el / its label
nextTabStop(from: Element, dir: 1 | -1): HTMLElement | null   // page Tab order (FOC-03)
whenFree(fn: () => void): void                     // run now, or right after the pending pointer is released (INT-06)
holdStill(el: Element | null, fn: () => void): void  // VD11-02/VD12-02: run fn (pass () => flushSync(...)) without el moving on screen; then lift el 8 px above a covering .sbar
tabStops(root: ParentNode): HTMLElement[]           // the Tab stops inside root, in order (Sheet's Tab trap)
resizeMayKeep(el: Element | null): boolean         // THE resize rule (INT-08)
onTextSize(fn: () => void): () => void             // subscribe to text-size changes ('twj:textsize'); returns unsubscribe
announce(msg: string): void                        // polite live region
// hooks
useReturnFocus(open: boolean): void                // records the invoker when open turns true, returns focus on false
useInView<T extends Element>(ref: RefObject<T>, ratio = 0.5): boolean   // FOC-01 (IntersectionObserver)
useLandingFocus(ref: RefObject<HTMLElement>, deps: unknown[]): void     // FOC-04: move focus after a state swap/submit
```

Global (installed by `<FocusRoot/>`): keep-visible on every keyboard/script `focusin`, never on pointer (INT-07);
re-keep on text-size change; resize only per `resizeMayKeep` (INT-08); `html[data-bigtext]`/`[data-hugetext]`
flags (<17em / <13em wide) exactly as the pack's probe; `scroll-padding` for sticky bars in site.css (FOC-05).

## 4 · More shared pieces (v2)

- **KeepWhole** — `<KeepWhole text="Fri May 14 · noon–2 pm" />`: dates/times in `span.nw` (+ `wbr`); a weekday may part
  from its date, a date never splits (gen.py keep_whole / site.js whole()). Pure splitter: `splitWhole` (`@/ui`).
- **Routes** — `ROUTES` (`@/ui`): the paths the shared chrome links to (home, menu `/menu` (S04), story `/#story`, the
  printable tag `/tag` (S12b; the no-gifts P.S. links there), the admin sections, sign-in). A lane that moves one of these pages asks U1.
- **AdminSolo** (`@/ui`) — the `.solo` frame of the sign-in pages (a1*), outside the AdminShell group.
- **next.config** — `agentRules: false`: `next dev` no longer writes into the repo's AGENTS.md.
- **Tick** (`@/ui`, T1.1b.U4) — the pack's ✓ (`svg.ck`). Put it inside every pickable tile/day/choice/segment: site.css
  shows it only in the selected state, next to the ink edge and the fill (colour is never the only cue; tested in
  `tests/unit/tokens-contrast.test.ts`).
- **StagingBanner** — rendered by the root layout on `APP_MODE=staging` only (a `.notice` strip, `role="note"`).
