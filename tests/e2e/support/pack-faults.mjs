// One named fault per T4.3.09 case: each breaks exactly the behaviour its case guards, in the pack mock, so
// `tests/e2e/prove-red.sh` can show the case turns red (a case that can't fail proves nothing). Faults may use the
// pack's classes: they break the mock, they are not test selectors. The key prefix names the case (foc01 = FOC-01).
const ready = (body) => `document.addEventListener('DOMContentLoaded',function(){${body}});`;

export const PACK_FAULTS = {
  // FOC-01: the countdown ignores whether the toast is on screen (the in-view check always says yes).
  'foc01-ticks-offscreen': {
    js: 'window.IntersectionObserver=function(cb){this.observe=function(el){setTimeout(function(){cb([{isIntersecting:true,intersectionRatio:1,target:el}])},0)};this.unobserve=this.disconnect=function(){}};',
  },
  // FOC-02: a focusable control parked off-screen (the classic "hidden skip target" bug).
  'foc02-offscreen-stop': {
    js: ready(
      "var a=document.createElement('a');a.href='#x';a.textContent='Parked link';a.style.cssText='position:absolute;left:-9999px;top:0';(document.querySelector('main')||document.body).appendChild(a);",
    ),
  },
  // FOC-03: Tab inside the ⋯ menu no longer closes it (the handler never sees the key).
  'foc03-menu-keeps-tab': {
    js: "document.addEventListener('keydown',e=>{if(e.key==='Tab'&&e.target.closest&&e.target.closest('[role=menu]'))e.stopImmediatePropagation()},true)",
  },
  // FOC-04: every script focus lands on a control far below the fold, without scrolling to it.
  'foc04-focus-offscreen': {
    js: ready(
      "var t=document.createElement('button');t.textContent='Far away';t.style.cssText='position:absolute;left:0;top:400vh';document.body.appendChild(t);var f=HTMLElement.prototype.focus;HTMLElement.prototype.focus=function(){f.call(t,{preventScroll:true})};",
    ),
  },
  // FOC-05: a pinned band at the foot with no scroll-padding for it (covers the focused control).
  'foc05-pinned-band': {
    js: ready(
      "var d=document.createElement('div');d.style.cssText='position:fixed;left:0;right:0;bottom:0;height:35vh;background:#fff;z-index:2147483647';document.body.appendChild(d);",
    ),
  },
  // FOC-06: the A2 filter strip clips its tabs instead of scrolling them into view.
  'foc06-tabs-clipped': {
    css: '[role=tablist]{overflow:clip!important;flex-wrap:nowrap!important;max-width:100%!important}',
  },
  // INT-01: the month tabs push the picker (and the page) sideways.
  'int01-tabs-push': { css: '[role=tablist]{min-width:130vw!important}' },
  // INT-02: after a pick, the picked tile re-lays out differently from its row (stacked among one-line tiles, or
  // one-line among stacked ones).
  'int02-mixed-row': {
    css: '.tiles:not([data-stack]) .tile[aria-pressed=true]{flex-direction:column!important;align-items:flex-start!important}.tiles[data-stack] .tile[aria-pressed=true]{flex-direction:row!important;flex-wrap:nowrap!important}',
  },
  // INT-03: the page forgets its state across a reload (no session memory): an undone lock re-opens.
  'int03-no-memory': { js: 'Storage.prototype.setItem=function(){};' },
  // INT-04: headings refuse to wrap at big text (sideways scroll).
  'int04-nowrap': { css: 'h1,h2,.h1,.h2{white-space:nowrap!important}' },
  // INT-05: the tick sits on the start of the label instead of in its own corner.
  'int05-tick-on-label': { css: '.tile .ck{right:auto!important;left:var(--s3,12px)!important}' },
  // INT-06: the control under a pressed pointer is rebuilt (a re-render with a new key): the click is lost.
  'int06-rebuild-on-press': {
    js: "document.addEventListener('mousedown',function(e){var b=e.target.closest&&e.target.closest('button,[role=tab]');if(b){b.replaceWith(b.cloneNode(true))}},true);",
  },
  // INT-07: pointer focus runs the keep-visible scroll (it must be keyboard/script only).
  'int07-pointer-scrolls': {
    js: "document.addEventListener('pointerdown',function(e){var b=e.target.closest&&e.target.closest('button,a,[role=tab],input');if(b)b.scrollIntoView({block:'center',behavior:'instant'})},true);",
  },
  // INT-08: every resize scrolls the page to the focused field, whoever focused it.
  'int08-resize-yanks': {
    js: "addEventListener('resize',function(){var a=document.activeElement;if(a&&a!==document.body)a.scrollIntoView({block:'center',behavior:'instant'})});",
  },
  // INT-09: the toast reserves no room at the foot and never lifts "Sending…" above itself.
  'int09-toast-covers': {
    css: '.toast[data-undo]{position:fixed!important;min-height:45vh!important}html.toast-on{scroll-padding-bottom:0!important}html.toast-on .adm-main{padding-bottom:0!important}',
    js: 'window.scrollBy=function(){};',
  },
};
