import { describe, expect, it } from 'vitest';
import { hasBlockingError, validateProject } from '../../src/core/playstore';
import { isProject, makeProject, makeSlide, reorder, resolveSlide, sanitizeProject } from '../../src/core/project';
import { PALETTES, extractPalette, paletteById } from '../../src/core/palette';
import { beatForIndex, suggestSet, CATEGORIES } from '../../src/core/copy';
import { contrast, parseHex, readableTextOn } from '../../src/core/color';
import { TEMPLATES, templateById, templatesForPreset } from '../../src/core/templates';
import { assetFilename, buildReadme } from '../../src/core/export';

function filled(count: number) {
  const p = makeProject('phone-portrait');
  p.slides = Array.from({ length: count }, (_, i) =>
    makeSlide({ imageId: `img-${i}`, headline: `Headline ${i}` }),
  );
  return p;
}

describe('validateProject', () => {
  it('blocks a project with fewer screenshots than Play accepts', () => {
    const findings = validateProject(filled(1));
    expect(hasBlockingError(findings)).toBe(true);
    expect(findings.some((f) => f.code === 'count-min')).toBe(true);
  });

  it('blocks more than eight screenshots', () => {
    expect(validateProject(filled(9)).some((f) => f.code === 'count-max')).toBe(true);
  });

  it('passes a healthy set with no errors', () => {
    const findings = validateProject(filled(5));
    expect(hasBlockingError(findings)).toBe(false);
  });

  it('warns rather than blocks on a missing headline', () => {
    const p = filled(4);
    p.slides[2]!.headline = '';
    const findings = validateProject(p);
    expect(hasBlockingError(findings)).toBe(false);
    expect(findings.some((f) => f.code === 'no-headline' && f.slide === 2)).toBe(true);
  });

  it('warns on a caption too long to read as a thumbnail', () => {
    const p = filled(4);
    p.slides[0]!.headline = 'x'.repeat(80);
    expect(validateProject(p).some((f) => f.code === 'headline-long')).toBe(true);
  });

  it('accepts a single feature graphic', () => {
    const p = makeProject('feature-graphic');
    p.slides = [makeSlide({ imageId: 'a', headline: 'Ship it' })];
    expect(hasBlockingError(validateProject(p))).toBe(false);
  });

  it('reports readiness when nothing is wrong', () => {
    expect(validateProject(filled(6)).some((f) => f.code === 'ready')).toBe(true);
  });
});

describe('resolveSlide', () => {
  it('falls back to the project template when the slide sets none', () => {
    const p = makeProject();
    p.templateId = 'bleed';
    expect(resolveSlide(p, p.slides[0]!).templateId).toBe('bleed');
  });

  it('lets a slide override the template', () => {
    const p = makeProject();
    p.templateId = 'bleed';
    const slide = makeSlide({ templateId: 'minimal' });
    expect(resolveSlide(p, slide).templateId).toBe('minimal');
  });

  it('uses the auto palette only when the theme follows the screenshot', () => {
    const p = makeProject();
    const auto = { ...paletteById('ember'), id: 'auto' };

    p.theme.source = 'auto';
    expect(resolveSlide(p, p.slides[0]!, auto).background.colors).toEqual(auto.colors);

    p.theme.source = 'palette';
    p.theme.paletteId = 'forest';
    expect(resolveSlide(p, p.slides[0]!, auto).background.colors).toEqual(paletteById('forest').colors);
  });

  it('honours a per-slide background above everything else', () => {
    const p = makeProject();
    const bg = { kind: 'solid' as const, colors: ['#ff0000'], angle: 0, vignette: 0, noise: 0 };
    const slide = makeSlide({ background: bg });
    expect(resolveSlide(p, slide, paletteById('ember')).background).toEqual(bg);
  });
});

describe('reorder', () => {
  it('moves an item forward and backward', () => {
    expect(reorder(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(reorder(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });

  it('returns the original array for a no-op or out-of-range move', () => {
    const list = ['a', 'b'];
    expect(reorder(list, 1, 1)).toBe(list);
    expect(reorder(list, 5, 0)).toBe(list);
    expect(reorder(list, 0, -1)).toBe(list);
  });
});

describe('sanitizeProject', () => {
  it('drops unknown keys and clamps the slide count', () => {
    const hostile = {
      ...makeProject(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      evil: 'payload',
      slides: Array.from({ length: 40 }, () => makeSlide()),
    } as never;
    const clean = sanitizeProject(hostile);
    expect('evil' in clean).toBe(false);
    expect(clean.slides).toHaveLength(8);
  });

  it('clamps an out-of-range crop', () => {
    const p = makeProject();
    p.slides = [makeSlide({ cropTop: 9 }), makeSlide({ cropTop: -3 })];
    const clean = sanitizeProject(p);
    expect(clean.slides[0]!.cropTop).toBeLessThanOrEqual(0.25);
    expect(clean.slides[1]!.cropTop).toBe(0);
  });

  it('replaces an unknown preset with the default', () => {
    const p = { ...makeProject(), presetId: 'not-a-preset' } as never;
    expect(sanitizeProject(p).presetId).toBe('phone-portrait');
  });
});

describe('isProject', () => {
  it('rejects junk and accepts a real project', () => {
    expect(isProject(null)).toBe(false);
    expect(isProject({})).toBe(false);
    expect(isProject({ version: 2, name: 'x', presetId: 'phone-portrait', slides: [], theme: {} })).toBe(false);
    expect(isProject(makeProject())).toBe(true);
  });
});

describe('palettes', () => {
  it('keeps every curated palette readable against its own background', () => {
    for (const palette of PALETTES) {
      const ratio = contrast(parseHex(palette.colors[0]!), parseHex(palette.text));
      expect(ratio, palette.id).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('picks the text colour with the better contrast', () => {
    expect(readableTextOn(parseHex('#ffffff'))).toBe('#101218');
    expect(readableTextOn(parseHex('#000000'))).toBe('#ffffff');
  });
});

describe('extractPalette', () => {
  function flat(r: number, g: number, b: number, n = 64 * 64) {
    const px = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i += 1) {
      px[i * 4] = r;
      px[i * 4 + 1] = g;
      px[i * 4 + 2] = b;
      px[i * 4 + 3] = 255;
    }
    return px;
  }

  it('falls back safely on empty input', () => {
    expect(extractPalette(new Uint8ClampedArray(0), 0, 0).id).toBe('midnight');
  });

  it('falls back when every pixel is near-white chrome', () => {
    expect(extractPalette(flat(252, 252, 253), 64, 64).id).toBe('midnight');
  });

  it('prefers a small saturated brand colour over a large grey background', () => {
    // 95% neutral grey, 5% saturated orange — a very typical app screenshot.
    const n = 64 * 64;
    const px = flat(130, 132, 138, n);
    for (let i = 0; i < n * 0.05; i += 1) {
      px[i * 4] = 240;
      px[i * 4 + 1] = 100;
      px[i * 4 + 2] = 20;
    }
    const palette = extractPalette(px, 64, 64);
    expect(palette.id).toBe('auto');
    // The derived background should be warm, not grey.
    const { r, b } = parseHex(palette.colors[0]!);
    expect(r).toBeGreaterThan(b);
  });

  it('always returns a readable text colour for its own background', () => {
    for (const [r, g, b] of [
      [240, 100, 20],
      [20, 60, 200],
      [250, 250, 200],
      [40, 200, 120],
    ]) {
      const palette = extractPalette(flat(r!, g!, b!), 64, 64);
      const ratio = contrast(parseHex(palette.colors[0]!), parseHex(palette.text));
      expect(ratio, `${r},${g},${b}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('caption suggestions', () => {
  it('opens on a hook and closes on a close', () => {
    expect(beatForIndex(0, 5)).toBe('hook');
    expect(beatForIndex(4, 5)).toBe('close');
  });

  it('never repeats a headline within a set', () => {
    for (const { id } of CATEGORIES) {
      const set = suggestSet(id, 8);
      expect(new Set(set.map((s) => s.headline)).size, id).toBe(8);
    }
  });

  it('has copy for every category and beat', () => {
    for (const { id } of CATEGORIES) {
      const set = suggestSet(id, 4);
      for (const s of set) {
        expect(s.headline.length, id).toBeGreaterThan(3);
        expect(s.headline.length, `${id}:${s.headline}`).toBeLessThanOrEqual(40);
      }
    }
  });
});

describe('templates', () => {
  it('produces an in-bounds layout for every template at every preset size', () => {
    const sizes = [
      { w: 1080, h: 1920 },
      { w: 1920, h: 1080 },
      { w: 1600, h: 2560 },
      { w: 1024, h: 500 },
    ];
    const project = makeProject();
    const resolved = resolveSlide(project, project.slides[0]!);

    for (const template of TEMPLATES) {
      for (const size of sizes) {
        const frame = { x: 0, y: 0, w: size.w, h: size.h };
        const layout = template.layout(frame, resolved);
        const label = `${template.id}@${size.w}x${size.h}`;

        expect(layout.text.box.w, label).toBeGreaterThan(0);
        expect(layout.text.box.h, label).toBeGreaterThan(0);
        // Text must stay inside the canvas, or Play's own crop will clip it.
        expect(layout.text.box.x, label).toBeGreaterThanOrEqual(0);
        expect(layout.text.box.x + layout.text.box.w, label).toBeLessThanOrEqual(size.w + 0.5);
        expect(layout.text.box.y, label).toBeGreaterThanOrEqual(0);
        expect(layout.text.box.y + layout.text.box.h, label).toBeLessThanOrEqual(size.h + 0.5);
        expect(layout.text.headlineRatio, label).toBeGreaterThan(0);

        if (layout.deviceBox) {
          expect(layout.deviceBox.w, label).toBeGreaterThan(0);
          expect(layout.deviceBox.h, label).toBeGreaterThan(0);
        }
      }
    }
  });

  it('resolves an unknown id to a working template instead of throwing', () => {
    expect(templateById('nope' as never).id).toBe(TEMPLATES[0]!.id);
  });

  it('offers at least four templates for every preset', () => {
    for (const preset of ['phone-portrait', 'tablet-10', 'feature-graphic'] as const) {
      expect(templatesForPreset(preset).length).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('export naming', () => {
  it('slugifies the app name and includes the exact dimensions', () => {
    const p = makeProject();
    p.name = 'AdTrace — Ad Blocker!';
    expect(assetFilename(p, 0, 'png')).toBe('adtrace-ad-blocker-phone-portrait-01-1080x1920.png');
  });

  it('names a feature graphic without an index', () => {
    const p = makeProject('feature-graphic');
    p.name = 'AdTrace';
    expect(assetFilename(p, 0, 'png')).toBe('adtrace-feature-graphic-1024x500.png');
  });

  it('survives a name with no usable characters', () => {
    const p = makeProject();
    p.name = '!!!';
    expect(assetFilename(p, 0, 'png')).toContain('app-phone-portrait');
  });

  it('writes a readme that names every file and where it goes', () => {
    const p = filled(3);
    p.name = 'AdTrace';
    const readme = buildReadme(
      p,
      p.slides.map((_, i) => ({
        filename: assetFilename(p, i, 'png'),
        bytes: new Uint8Array(0),
        width: 1080,
        height: 1920,
        colorType: 2,
      })),
    );
    expect(readme).toContain('Main store listing');
    expect(readme).toContain('adtrace-phone-portrait-01-1080x1920.png');
    expect(readme).toContain('no alpha channel');
  });
});
