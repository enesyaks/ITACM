/**
 * Integrity of the onboarding tour's hand-maintained data.
 *
 * These maps live in public/js/app.js and fail quietly: a marker aimed at a bullet that
 * doesn't exist still paints on the screenshot but never gets a number in the legend, a
 * group range that stops short silently labels a slide with the wrong section, and a
 * shot listed without its file leaves an empty frame. Nothing at runtime complains, so
 * check it here instead.
 *
 * Run with `npm test` (node --test, no dependencies).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
const src = readFileSync(join(ROOT, 'public/js/app.js'), 'utf8');

/**
 * app.js is a browser script, not a module, so lift the literals out by balancing
 * brackets from the declaration and evaluating just that slice.
 */
function grabLiteral(name, open, close) {
  const decl = src.indexOf(`const ${name} = ${open}`);
  assert.ok(decl >= 0, `${name} not found in public/js/app.js`);
  const from = src.indexOf(open, decl);
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close && --depth === 0) return runInNewContext(`(${src.slice(from, i + 1)})`, {});
  }
  throw new Error(`unbalanced ${open}${close} while reading ${name}`);
}

function grabSet(name) {
  const m = src.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`));
  assert.ok(m, `${name} not found in public/js/app.js`);
  return new Set(runInNewContext(`([${m[1]}])`, {}));
}

const OB_TOUR = grabLiteral('OB_TOUR', '[', ']');
const OB_HOTSPOTS = grabLiteral('OB_HOTSPOTS', '{', '}');
const OB_TOUR_GROUPS = grabLiteral('OB_TOUR_GROUPS', '[', ']');
const OB_TOUR_I18N = grabLiteral('OB_TOUR_I18N', '{', '}');
const OB_SHOTS = grabSet('OB_SHOTS');
const OB_SHOT_LANGS = grabSet('OB_SHOT_LANGS');

const byId = new Map(OB_TOUR.map((s) => [s.id, s]));

test('every slide has an id, title, bullets and a preview', () => {
  const ids = new Set();
  for (const s of OB_TOUR) {
    assert.ok(s.id, 'a slide is missing its id');
    assert.ok(!ids.has(s.id), `duplicate slide id "${s.id}"`);
    ids.add(s.id);
    assert.ok(s.title && s.desc, `${s.id}: missing title or desc`);
    assert.ok(Array.isArray(s.bullets) && s.bullets.length, `${s.id}: no bullets`);
    assert.ok(s.preview, `${s.id}: no preview`);
  }
});

test('tour groups tile every slide exactly once', () => {
  // obGroupOf() falls back to the first group when a slide is outside every range,
  // which would silently badge it "Getting started".
  const covered = [];
  for (const g of OB_TOUR_GROUPS) {
    assert.ok(g.from <= g.to, `${g.label}: from ${g.from} > to ${g.to}`);
    for (let i = g.from; i <= g.to; i++) {
      assert.ok(!covered.includes(i), `slide ${i} is claimed by more than one group`);
      covered.push(i);
    }
  }
  covered.sort((a, b) => a - b);
  assert.deepEqual(covered, OB_TOUR.map((_, i) => i),
    'group ranges do not cover exactly slides 0..' + (OB_TOUR.length - 1));
});

test('every slide claiming a shot ships that image in every shipped language', () => {
  for (const preview of OB_SHOTS) {
    assert.ok([...byId.values()].some((s) => s.preview === preview),
      `OB_SHOTS lists "${preview}" but no slide uses it`);
    for (const lang of OB_SHOT_LANGS) {
      const rel = `public/media/tour/${lang}/${preview}.webp`;
      assert.ok(existsSync(join(ROOT, rel)), `missing image: ${rel}`);
    }
  }
});

test('english shots always exist — they are the fallback for every other language', () => {
  assert.ok(OB_SHOT_LANGS.has('en'), 'OB_SHOT_LANGS must contain "en"');
  for (const preview of OB_SHOTS) {
    assert.ok(existsSync(join(ROOT, `public/media/tour/en/${preview}.webp`)),
      `missing English fallback for "${preview}"`);
  }
});

test('every hotspot points at a bullet that exists, once, inside the image', () => {
  for (const [id, spots] of Object.entries(OB_HOTSPOTS)) {
    const slide = byId.get(id);
    assert.ok(slide, `OB_HOTSPOTS has "${id}" but no slide with that id`);
    assert.ok(OB_SHOTS.has(slide.preview),
      `"${id}" has hotspots but its preview "${slide.preview}" ships no shot to pin them on`);
    const claimed = new Set();
    spots.forEach((h, k) => {
      assert.ok(Number.isInteger(h.b) && h.b >= 1 && h.b <= slide.bullets.length,
        `${id}: marker ${k + 1} points at bullet ${h.b}, but the slide has ${slide.bullets.length}`);
      assert.ok(!claimed.has(h.b),
        `${id}: two markers point at bullet ${h.b} — the legend can only number one`);
      claimed.add(h.b);
      assert.ok(h.x >= 0 && h.x <= 100 && h.y >= 0 && h.y <= 100,
        `${id}: marker ${k + 1} at ${h.x},${h.y} falls outside the image`);
    });
  }
});

test('localized slides keep the English bullet count', () => {
  // obItem() spreads the localized override over the English slide, so a shorter
  // bullets array there would leave a marker numbered past the end of the legend.
  for (const [lang, slides] of Object.entries(OB_TOUR_I18N)) {
    for (const [id, loc] of Object.entries(slides)) {
      if (!loc.bullets) continue;
      const slide = byId.get(id);
      assert.ok(slide, `OB_TOUR_I18N.${lang} has "${id}" but no slide with that id`);
      assert.equal(loc.bullets.length, slide.bullets.length,
        `${lang}/${id}: ${loc.bullets.length} bullets vs ${slide.bullets.length} in English — markers would mis-number`);
    }
  }
});
