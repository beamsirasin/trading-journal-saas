function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const T = {
  DARK: {
    page: '#0f0f11',
    fg: '#ececef',
    card: '#18181c',
    popover: '#1e1e23',
    muted: '#a0a0a9',
    accent: '#26262c',
    border: '#2a2a31',
    rail: '#0b0b0e',
    railBorder: '#1e1e22',
    secondary: '#151519',
    secondaryBorder: '#242429',
    chrome: '#0b0b0e',
    chromeFg: '#ececef',
    chromeMuted: '#8f8f98',
    chromeAccent: '#1b1b20',
    chromeBorder: '#202024',
    primary: '#2563eb',
    primaryFg: '#ffffff',
    destructive: '#f2607f',
  },
  LIGHT: {
    page: '#f8fafd',
    fg: '#0b1220',
    card: '#ffffff',
    popover: '#ffffff',
    muted: '#55657f',
    accent: '#dfe6f4',
    border: '#dde4f0',
    rail: '#e9eef7',
    railBorder: '#dae2ef',
    secondary: '#f4f7fc',
    secondaryBorder: '#e2e8f3',
    chrome: '#101a2e',
    chromeFg: '#eef2fa',
    chromeMuted: '#9db0d0',
    chromeAccent: '#1c2a44',
    chromeBorder: '#1b2942',
    primary: '#1d5fd8',
    primaryFg: '#ffffff',
    destructive: '#be123c',
  },
};

const checks = (t) => [
  ['HEADER: chrome-fg on chrome', t.chromeFg, t.chrome, 4.5],
  ['HEADER: chrome-muted on chrome', t.chromeMuted, t.chrome, 4.5],
  ['HEADER: chrome-fg on chrome hover', t.chromeFg, t.chromeAccent, 4.5],
  ['HEADER: border vs chrome', t.chromeBorder, t.chrome, 1.05],
  ['RAIL: foreground on rail', t.fg, t.rail, 4.5],
  ['RAIL: muted-fg on rail (inactive icon)', t.muted, t.rail, 4.5],
  ['RAIL: primary on rail (active icon)', t.primary, t.rail, 3.0],
  ['NAV: foreground on secondary', t.fg, t.secondary, 4.5],
  ['NAV: muted-fg on secondary', t.muted, t.secondary, 4.5],
  ['NAV: muted-fg on secondary hover', t.muted, t.accent, 4.5],
  ['PAGE: foreground on page', t.fg, t.page, 4.5],
  ['PAGE: muted-fg on page', t.muted, t.page, 4.5],
  ['CARD: foreground on card', t.fg, t.card, 4.5],
  ['CARD: muted-fg on card', t.muted, t.card, 4.5],
  ['CTA: primary-fg on primary', t.primaryFg, t.primary, 4.5],
  ['MENU: destructive on popover', t.destructive, t.popover, 4.5],
  ['LAYERS: rail vs secondary', t.rail, t.secondary, 1.04],
  ['LAYERS: secondary vs page', t.secondary, t.page, 1.02],
  ['LAYERS: card vs page', t.card, t.page, 1.02],
];

let failed = 0;
for (const [name, t] of Object.entries(T)) {
  console.log(`\n=== ${name} ===`);
  for (const [label, fg, bg, min] of checks(t)) {
    const r = ratio(fg, bg);
    const ok = r >= min;
    if (!ok) failed++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'} ${r.toFixed(2).padStart(6)}:1 (min ${min})  ${label}`);
  }
}
console.log(failed === 0 ? '\nAll contrast checks passed.' : `\n${failed} FAILED.`);
process.exit(failed === 0 ? 0 : 1);
