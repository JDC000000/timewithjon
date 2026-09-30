// The T4.3.09 probes and helpers must be able to fail, or a green case proves nothing: each is checked here on a
// small fixture page (not the app) with a known answer. Real keys only, like the cases. Runs at 375 × 100 % text.
import { expect, test } from './support/fixtures';
import { elementState, focusState, isNotHidden, isSeen, tabWalk } from './support/focus-probe';
import { humanClick, press } from './support/input';
import { coveredControls, rowProblems, splitDateWords, tickGaps } from './support/layout-probes';
import { VIEWPORTS } from './support/profiles';
import { inScope, TALL_PHONES } from './support/scope';
import { fixmeUnlessLanded, screenPath, unavailable } from './support/screens';

test.skip(
  ({ viewport, textMode }) => !inScope(viewport, textMode, { viewports: ['w375'], textModes: ['t100'] }),
  'fixture pages: once per engine',
);

test('scopes pick the right projects; the route map fixmes unlanded screens with their owner', () => {
  expect(inScope(VIEWPORTS.w320, 't200', { viewports: TALL_PHONES, textModes: ['t200', 'sp125'] })).toBe(
    true,
  );
  expect(inScope(VIEWPORTS.w320, 't100', { viewports: TALL_PHONES, textModes: ['t200', 'sp125'] })).toBe(
    false,
  );
  expect(inScope(VIEWPORTS.w768, 't200', { viewports: TALL_PHONES })).toBe(false);
  expect(inScope(VIEWPORTS.short375, 't100', { viewports: ['w375'] })).toBe(false); // same width, other height
  expect(inScope(VIEWPORTS.w1440, 'sp125', {})).toBe(true);

  expect(unavailable('s06-picker-open', 'pack')).toBeNull();
  expect(screenPath('a3-request-detail', 1024, 'pack')).toBe('/final/a3-request-detail-design-desktop.html');
  expect(screenPath('a3-request-detail', 1023, 'pack')).toBe('/final/a3-request-detail-design-mobile.html');
  // On the app: a landed screen opens at its route; an unlanded one throws and fixmes, naming what is missing + owner.
  expect(unavailable('a2-requests', 'app')).toBeNull();
  expect(screenPath('a2-requests', 375, 'app')).toBe('/admin');
  expect(unavailable('s11-after-send', 'app')).toContain('owner lane U4');
  expect(() => screenPath('s11-after-send', 375, 'app')).toThrow(/U4/);
  expect(unavailable('a3-request-detail', 'app')).toMatch(/lockable guest request.*owner lane U7/);
  const calls: [boolean, string][] = [];
  fixmeUnlessLanded(
    (condition, reason) => calls.push([condition, reason]),
    ['a2-requests', 's11-after-send'],
  );
  expect(calls).toEqual([
    [unavailable('a2-requests') !== null, unavailable('a2-requests') ?? ''],
    [unavailable('s11-after-send') !== null, unavailable('s11-after-send') ?? ''],
  ]);
});

test('focus probes: off-screen, covered and seen', async ({ page }) => {
  await page.setContent(
    '<button>top</button><button style="position:absolute;left:-9999px">parked</button>' +
      '<div style="height:3000px"></div><button>far</button>' +
      '<button style="position:fixed;bottom:0">under</button><div style="position:fixed;bottom:0;height:60px;width:100%;background:#fff">band</div>' +
      '<div style="position:fixed;top:100px;width:100px;overflow-x:auto;white-space:nowrap"><span style="display:inline-block;width:300px"></span><button>clipped</button></div>',
  );
  await press(page, 'Tab');
  const top = await focusState(page);
  expect(top?.name).toBe('top');
  expect(isSeen(top)).toBe(true);
  await press(page, 'Tab');
  const parked = await focusState(page);
  expect(parked?.name).toBe('parked');
  expect(parked?.inView).toBe(0);
  expect(isNotHidden(parked)).toBe(false);
  await press(page, 'Tab', 2);
  const under = await focusState(page);
  expect(under?.name).toBe('under');
  expect(under?.coveredBy).toBe('band');
  expect(isNotHidden(under)).toBe(false);
  const clipped = await page.getByRole('button', { name: 'clipped' }).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.left < innerWidth && r.right > 0; // on screen, but outside its scroller's visible box
  });
  expect(clipped).toBe(true);
  expect((await elementState(page.getByRole('button', { name: 'clipped' }))).inView).toBe(0);
  await page.mouse.click(1, 1); // back to the document start
  const walk = await tabWalk(page, 'Tab');
  expect(walk.map((stop) => stop.name)).toEqual(['top', 'parked', 'far', 'under', 'clipped']);
  await expect(humanClick(page, page.getByRole('button', { name: 'under' }))).rejects.toThrow(/covered/);
});

test('layout probes: mixed rows, stray dots, tick gaps, split dates, covered controls', async ({ page }) => {
  await page.setContent(
    '<style>b{display:inline-block;width:90px;vertical-align:top} i{position:absolute;top:0;right:0;width:10px;height:10px}</style>' +
      '<div id="row"><b>Thu noon</b><b>Fri<br>noon</b></div>' +
      '<div id="dot"><b>Thu<br><span>·</span><br>noon</b></div>' +
      '<div id="tabs"><b>May</b><b style="padding-top:12px">June</b></div>' +
      '<div id="tiles"><b style="position:relative;padding-right:14px">noon<i aria-hidden="true"></i>' +
      '<span style="position:absolute;top:0;right:0;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">hidden words</span></b>' +
      '<b style="position:relative;white-space:nowrap">noon noon noon<i aria-hidden="true"></i></b></div>' +
      '<p style="width:30px;word-break:break-all">September</p>' +
      '<button id="c" style="position:fixed;top:300px">covered</button><div style="position:fixed;top:290px;height:60px;width:100%;background:#fff">band</div>',
  );
  expect(await page.locator('#row b').evaluateAll(rowProblems, 'lines' as const)).toEqual([
    expect.stringContaining('mixed line counts'),
  ]);
  expect(await page.locator('#row b').evaluateAll(rowProblems, 'firstLine' as const)).toEqual([]);
  expect(await page.locator('#tabs b').evaluateAll(rowProblems, 'firstLine' as const)).toEqual([
    expect.stringContaining('names off one line'),
  ]);
  expect(await page.locator('#dot b').evaluateAll(rowProblems, 'lines' as const)).toEqual([
    expect.stringContaining('separator alone'),
  ]);
  const gaps = await page.locator('#tiles b').evaluateAll(tickGaps);
  expect(gaps[0]?.gap).toBeGreaterThanOrEqual(1);
  expect(gaps[1]?.gap).toBeLessThan(1);
  expect(await page.evaluate(splitDateWords)).toEqual(['September']);
  expect(await page.locator('#c').evaluateAll(coveredControls)).toEqual(['"covered" under "band"']);
});
