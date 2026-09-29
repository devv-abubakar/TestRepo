import { PALETTES, paletteById, type Palette } from './palette';
import { PRESETS } from './playstore';
import type { Background, PresetId, Project, ResolvedSlide, Slide, TemplateId } from './types';

export function newId(): string {
  // crypto.randomUUID is unavailable on some older mobile browsers.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const DEFAULT_BACKGROUND: Background = {
  kind: 'gradient',
  colors: ['#0b1020', '#1b2a5e'],
  angle: 125,
  vignette: 0.18,
  noise: 0.035,
};

export function makeSlide(partial: Partial<Slide> = {}): Slide {
  return {
    id: newId(),
    imageId: null,
    headline: '',
    subheadline: '',
    templateId: null,
    background: null,
    cropTop: 0,
    ...partial,
  };
}

export function makeProject(presetId: PresetId = 'phone-portrait'): Project {
  return {
    version: 1,
    name: 'My app',
    presetId,
    templateId: 'spotlight',
    slides: [makeSlide(), makeSlide()],
    theme: {
      source: 'auto',
      paletteId: 'midnight',
      background: { ...DEFAULT_BACKGROUND },
      textColor: '#ffffff',
      accent: '#5987ff',
    },
    device: {
      kind: 'phone',
      color: 'graphite',
      cutout: 'punch',
      shadow: true,
      statusBar: true,
    },
    typography: {
      headlineFont: 'Plus Jakarta Sans',
      bodyFont: 'Plus Jakarta Sans',
      headlineWeight: 800,
      scale: 1,
      align: 'center',
      uppercase: false,
      letterSpacing: -15,
    },
    watermark: true,
  };
}

/**
 * Collapses project defaults, per-slide overrides and the auto-extracted palette
 * into the flat object the renderer consumes.
 *
 * Precedence, strongest first: per-slide background, auto palette (when the
 * theme is set to follow the screenshot), the chosen palette, project defaults.
 */
export function resolveSlide(
  project: Project,
  slide: Slide,
  autoPalette: Palette | null = null,
): ResolvedSlide {
  const palette: Palette =
    project.theme.source === 'auto' && autoPalette
      ? autoPalette
      : paletteById(project.theme.paletteId);

  const themeBackground: Background = {
    ...project.theme.background,
    colors: [...palette.colors],
  };

  return {
    slide,
    templateId: (slide.templateId ?? project.templateId) as TemplateId,
    background: slide.background ?? themeBackground,
    textColor: palette.text,
    accent: palette.accent,
    device: project.device,
    typography: project.typography,
    watermark: project.watermark,
  };
}

export function presetOf(project: Project) {
  return PRESETS[project.presetId];
}

export function reorder<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item === undefined) return list;
  next.splice(to, 0, item);
  return next;
}

/** Guards against a corrupt or future-version autosave. */
export function isProject(value: unknown): value is Project {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Partial<Project>;
  return (
    p.version === 1 &&
    typeof p.name === 'string' &&
    typeof p.presetId === 'string' &&
    p.presetId in PRESETS &&
    Array.isArray(p.slides) &&
    typeof p.theme === 'object' &&
    p.theme !== null
  );
}

/** Strips anything not in the schema so a hand-edited import cannot inject keys. */
export function sanitizeProject(input: Project): Project {
  const presetId: PresetId = input.presetId in PRESETS ? input.presetId : 'phone-portrait';
  const base = makeProject(presetId);
  return {
    ...base,
    name: String(input.name).slice(0, 120),
    presetId,
    templateId: input.templateId,
    slides: (Array.isArray(input.slides) ? input.slides : []).slice(0, 8).map((s) =>
      makeSlide({
        id: typeof s.id === 'string' ? s.id : newId(),
        imageId: typeof s.imageId === 'string' ? s.imageId : null,
        headline: String(s.headline ?? '').slice(0, 200),
        subheadline: String(s.subheadline ?? '').slice(0, 300),
        templateId: s.templateId ?? null,
        background: s.background ?? null,
        cropTop: Number.isFinite(s.cropTop) ? Math.min(0.25, Math.max(0, s.cropTop)) : 0,
      }),
    ),
    theme: { ...base.theme, ...input.theme },
    device: { ...base.device, ...input.device },
    typography: { ...base.typography, ...input.typography },
    watermark: Boolean(input.watermark),
  };
}

export { PALETTES };
