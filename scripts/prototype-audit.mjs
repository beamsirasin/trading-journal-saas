/**
 * Implementation-quality audit of the prototype surfaces.
 *
 * DEVELOPMENT TOOLING. It drives the `/prototype` routes at every width the
 * review calls for and reports MEASURED facts — horizontal page overflow,
 * missing landmarks and headings, undersized touch targets, unlabelled
 * controls, invalid ARIA — rather than opinions about the markup. Reasoning
 * from source alone misses exactly the class of defect this is looking for:
 * something that only appears once real type, a real font and a real viewport
 * are involved.
 *
 * 200% text zoom is emulated by doubling the root font size, which is the
 * honest emulation for a rem-based design: it scales text and every rem-derived
 * box without scaling the viewport, which is what WCAG 1.4.4 actually asks for.
 * Browser (pinch) zoom is a different thing and is already covered by the
 * narrow-viewport passes.
 *
 * Usage: node scripts/prototype-audit.mjs [--base http://localhost:3000] [--zoom]
 */

import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const BASE = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'http://localhost:3000';
const ZOOM = args.includes('--zoom');

const WIDTHS = [320, 390, 768, 1024, 1280, 1440, 1920];

const PAGES = [
  { name: 'trade-log', path: '/en/prototype/trade-log' },
  { name: 'trade-log-thai', path: '/en/prototype/trade-log?lang=th' },
  { name: 'trade-detail', path: '/en/prototype/trade-log?trade=t-01' },
  { name: 'log-trade', path: '/en/prototype/log-trade' },
  { name: 'at-entry', path: '/en/prototype/log-trade/at-entry' },
  { name: 'after-trade', path: '/en/prototype/log-trade/after-trade' },
  { name: 'still-open-filled', path: '/en/prototype/log-trade/at-entry?filled=1' },
  { name: 'partial-exits', path: '/en/prototype/log-trade/after-trade?exits=1' },
  { name: 'exit-editor', path: '/en/prototype/log-trade/after-trade?exits=1&edit=e2' },
  { name: 'close-trade', path: '/en/prototype/close-trade?trade=t-03' },
  { name: 'close-trade-partial', path: '/en/prototype/close-trade?trade=t-03&part=1' },
];

const findings = [];
function report(page, width, theme, kind, detail) {
  findings.push({ page, width, theme, kind, detail });
}

const browser = await chromium.launch();

for (const theme of ['dark', 'light']) {
  for (const spec of PAGES) {
    for (const width of WIDTHS) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        deviceScaleFactor: 1,
        reducedMotion: 'reduce',
      });
      await context.addInitScript((value) => {
        try {
          window.localStorage.setItem('trading-os-theme', value);
        } catch {
          /* ignore */
        }
      }, theme);

      const page = await context.newPage();
      await page.goto(`${BASE}${spec.path}`, { waitUntil: 'networkidle' });
      await page.addStyleTag({
        content: 'nextjs-portal,[data-nextjs-dev-tools-button]{display:none!important}',
      });
      if (ZOOM) {
        await page.addStyleTag({ content: 'html{font-size:200%!important}' });
      }
      await page.waitForTimeout(250);

      const result = await page.evaluate(() => {
        const out = {
          overflow: null,
          offenders: [],
          landmarks: {},
          headings: [],
          smallTargets: [],
          unlabelled: [],
          badAria: [],
        };

        const docWidth = document.documentElement.scrollWidth;
        const viewWidth = window.innerWidth;
        if (docWidth > viewWidth + 1) {
          out.overflow = { docWidth, viewWidth };
          // Name the widest elements crossing the right edge, so a finding
          // points at a node rather than at the page.
          for (const el of document.querySelectorAll('body *')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (r.right > viewWidth + 1) {
              out.offenders.push({
                tag: el.tagName.toLowerCase(),
                cls: (el.getAttribute('class') ?? '').slice(0, 90),
                right: Math.round(r.right),
                text: (el.textContent ?? '').trim().slice(0, 40),
              });
            }
          }
          out.offenders = out.offenders.slice(0, 6);
        }

        out.landmarks = {
          main: document.querySelectorAll('main').length,
          header: document.querySelectorAll('header').length,
          nav: document.querySelectorAll('nav').length,
          h1: document.querySelectorAll('h1').length,
          skipLink: document.querySelectorAll('a[href^="#"]').length,
        };
        out.headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
          .slice(0, 12)
          .map((h) => `${h.tagName}:${(h.textContent ?? '').trim().slice(0, 28)}`);

        /**
         * The EFFECTIVE hit area, not the border box.
         *
         * A control whose target is extended by a transparent `::after`
         * measures at its INK, so the raw box accuses a fixed control of still
         * being 16px tall. This reads the pseudo-element's own box instead.
         *
         * MEASURED GEOMETRICALLY, NOT BY HIT-TESTING. The first version probed
         * outward from the centre with `elementFromPoint`, which only reports
         * on what is inside the viewport — so every row below the fold came
         * back at its ink height and the whole report was noise. Geometry is
         * correct for any row on the page, on screen or not.
         */
        const hitHeight = (el, r) => {
          const after = getComputedStyle(el, '::after');
          if (after.content !== 'none' && after.position === 'absolute') {
            const extended = parseFloat(after.height);
            if (Number.isFinite(extended)) return Math.max(r.height, extended);
          }
          return r.height;
        };

        const isVisuallyHidden = (el) => {
          for (let node = el; node !== null; node = node.parentElement) {
            const s = getComputedStyle(node);
            if (s.clipPath === 'inset(50%)' || s.clip === 'rect(0px, 0px, 0px, 0px)') return true;
          }
          return false;
        };

        const focusables = document.querySelectorAll(
          'a[href], button:not([disabled]), input:not([type=hidden]), select, textarea, [tabindex="0"]',
        );
        for (const el of focusables) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (!isVisuallyHidden(el) && (r.width < 24 || hitHeight(el, r) < 24)) {
            out.smallTargets.push({
              tag: el.tagName.toLowerCase(),
              w: Math.round(r.width),
              h: Math.round(r.height),
              hit: hitHeight(el, r),
              text: (el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 30),
            });
          }
          const name =
            (el.getAttribute('aria-label') ?? '').trim() ||
            (el.textContent ?? '').trim() ||
            (el.getAttribute('title') ?? '').trim() ||
            (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent) ||
            (el.getAttribute('aria-labelledby') &&
              document.getElementById(el.getAttribute('aria-labelledby'))?.textContent) ||
            '';
          if (name.trim() === '') {
            out.unlabelled.push({
              tag: el.tagName.toLowerCase(),
              type: el.getAttribute('type') ?? '',
              cls: (el.getAttribute('class') ?? '').slice(0, 60),
            });
          }
        }
        out.smallTargets = out.smallTargets.slice(0, 8);
        out.unlabelled = out.unlabelled.slice(0, 8);

        // aria-selected is only valid on rows inside a grid/treegrid.
        for (const el of document.querySelectorAll('tr[aria-selected], li[aria-selected]')) {
          out.badAria.push(`${el.tagName.toLowerCase()}[aria-selected] outside a grid`);
        }
        // Thai content rendered under an English document language.
        const htmlLang = document.documentElement.lang;
        const thai = /[฀-๿]/.test(document.body.innerText);
        if (thai && !document.querySelector('[lang="th"]') && htmlLang !== 'th') {
          out.badAria.push('Thai text with no lang="th" in the subtree');
        }
        return out;
      });

      if (result.overflow !== null) {
        report(
          spec.name,
          width,
          theme,
          'OVERFLOW',
          `${result.overflow.docWidth}px > ${result.overflow.viewWidth}px :: ${result.offenders
            .map((o) => `${o.tag}.${o.cls.split(' ')[0]}@${o.right}`)
            .join(', ')}`,
        );
      }
      if (theme === 'dark' && width === 1440) {
        if (result.landmarks.main === 0) report(spec.name, width, theme, 'NO_MAIN', 'no <main>');
        if (result.landmarks.h1 === 0) report(spec.name, width, theme, 'NO_H1', 'no <h1>');
        if (result.landmarks.h1 > 1)
          report(spec.name, width, theme, 'MULTI_H1', `${result.landmarks.h1} h1 elements`);
      }
      if (theme === 'dark' && width === 390 && result.landmarks.h1 === 0) {
        report(spec.name, width, theme, 'NO_H1', 'no <h1> at mobile width');
      }
      for (const t of result.smallTargets) {
        report(
          spec.name,
          width,
          theme,
          'SMALL_TARGET',
          `${t.tag} box ${t.w}x${t.h} hit-height ${t.hit} "${t.text}"`,
        );
      }
      for (const u of result.unlabelled) {
        report(
          spec.name,
          width,
          theme,
          'UNLABELLED',
          `${u.tag}[${u.type}] .${u.cls.split(' ')[0]}`,
        );
      }
      for (const b of result.badAria) {
        report(spec.name, width, theme, 'ARIA', b);
      }

      await context.close();
    }
  }
}

await browser.close();

// Collapse identical findings that repeat across widths/themes, so the report
// names each DEFECT once with the conditions it appears under.
const grouped = new Map();
for (const f of findings) {
  const key = `${f.kind}|${f.page}|${f.detail}`;
  const entry = grouped.get(key) ?? { ...f, widths: new Set(), themes: new Set() };
  entry.widths.add(f.width);
  entry.themes.add(f.theme);
  grouped.set(key, entry);
}

console.log(
  `\n${ZOOM ? '200% TEXT ZOOM' : 'DEFAULT TEXT SIZE'} — ${grouped.size} distinct findings\n`,
);
for (const entry of [...grouped.values()].sort((a, b) => a.kind.localeCompare(b.kind))) {
  console.log(
    `[${entry.kind}] ${entry.page} @ ${[...entry.widths].sort((a, b) => a - b).join(',')} (${[...entry.themes].join('/')})\n    ${entry.detail}`,
  );
}
if (grouped.size === 0) console.log('none');
