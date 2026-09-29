import type { Preset, PresetId, Project } from './types';

/**
 * Google Play graphic asset requirements.
 *
 * VERIFY BEFORE RELEASE: these numbers come from the Play Console help pages,
 * which Google revises without notice. `docs/PLAY_SPECS.md` records where each
 * value came from and when it was last checked.
 */
export const PRESETS: Record<PresetId, Preset> = {
  'phone-portrait': {
    id: 'phone-portrait',
    label: 'Phone · portrait',
    width: 1080,
    height: 1920,
    minCount: 2,
    maxCount: 8,
    forbidsAlpha: true,
    hint: '9:16. The set every listing needs. Play shows the first 3 without scrolling.',
  },
  'phone-landscape': {
    id: 'phone-landscape',
    label: 'Phone · landscape',
    width: 1920,
    height: 1080,
    minCount: 2,
    maxCount: 8,
    forbidsAlpha: true,
    hint: '16:9. Use for games and anything that runs sideways.',
  },
  'tablet-7': {
    id: 'tablet-7',
    label: 'Tablet · 7 inch',
    width: 1200,
    height: 1920,
    minCount: 2,
    maxCount: 8,
    forbidsAlpha: true,
    hint: 'Without tablet screenshots Play can down-rank you on tablets and Chromebooks.',
  },
  'tablet-10': {
    id: 'tablet-10',
    label: 'Tablet · 10 inch',
    width: 1600,
    height: 2560,
    minCount: 2,
    maxCount: 8,
    forbidsAlpha: true,
    hint: 'Largest tablet tier. Same art, more breathing room.',
  },
  'feature-graphic': {
    id: 'feature-graphic',
    label: 'Feature graphic',
    width: 1024,
    height: 500,
    minCount: 1,
    maxCount: 1,
    forbidsAlpha: true,
    hint: 'Required for every listing. No alpha channel, and keep text away from the edges.',
  },
};

export const PRESET_ORDER: PresetId[] = [
  'phone-portrait',
  'phone-landscape',
  'tablet-7',
  'tablet-10',
  'feature-graphic',
];

/** Play accepts any side from 320px to 3840px, at an aspect ratio of 1:2 to 2:1. */
export const MIN_SIDE = 320;
export const MAX_SIDE = 3840;
export const MIN_RATIO = 0.5;
export const MAX_RATIO = 2;

export type Severity = 'error' | 'warning' | 'ok';

export interface Finding {
  severity: Severity;
  code: string;
  message: string;
  /** Slide index the finding belongs to, when it is slide-specific. */
  slide?: number;
}

/**
 * Checks a project against the Play Store rules that actually cause rejections
 * or a weak listing. Errors block export; warnings do not.
 */
export function validateProject(project: Project): Finding[] {
  const preset = PRESETS[project.presetId];
  const findings: Finding[] = [];
  const filled = project.slides.filter((s) => s.imageId !== null);

  if (filled.length < preset.minCount) {
    findings.push({
      severity: 'error',
      code: 'count-min',
      message: `Play needs at least ${preset.minCount} ${preset.label.toLowerCase()} asset${
        preset.minCount === 1 ? '' : 's'
      }. You have ${filled.length}.`,
    });
  }

  if (project.slides.length > preset.maxCount) {
    findings.push({
      severity: 'error',
      code: 'count-max',
      message: `Play accepts at most ${preset.maxCount}. Remove ${
        project.slides.length - preset.maxCount
      }.`,
    });
  }

  // The aspect-ratio and side limits are screenshot rules. The feature graphic
  // is a fixed 1024x500 (2.048:1), which is outside that range by design, so
  // applying the screenshot rules to it rejects a perfectly valid asset.
  const isScreenshot = preset.id !== 'feature-graphic';

  const ratio = preset.width / preset.height;
  if (isScreenshot && (ratio < MIN_RATIO || ratio > MAX_RATIO)) {
    findings.push({
      severity: 'error',
      code: 'ratio',
      message: `${preset.width}x${preset.height} is outside Play's 1:2 to 2:1 aspect ratio range.`,
    });
  }

  const shortest = Math.min(preset.width, preset.height);
  const longest = Math.max(preset.width, preset.height);
  if (isScreenshot && shortest < MIN_SIDE) {
    findings.push({
      severity: 'error',
      code: 'too-small',
      message: `Every side must be at least ${MIN_SIDE}px.`,
    });
  }
  if (isScreenshot && longest > MAX_SIDE) {
    findings.push({
      severity: 'error',
      code: 'too-large',
      message: `No side may exceed ${MAX_SIDE}px.`,
    });
  }

  project.slides.forEach((slide, i) => {
    if (slide.imageId === null) {
      findings.push({
        severity: 'warning',
        code: 'empty-slide',
        message: 'No screenshot yet — this slide exports as background only.',
        slide: i,
      });
    }
    if (slide.headline.trim().length === 0 && slide.imageId !== null) {
      findings.push({
        severity: 'warning',
        code: 'no-headline',
        message: 'No headline. A screenshot without a caption converts noticeably worse.',
        slide: i,
      });
    }
    if (slide.headline.length > 60) {
      findings.push({
        severity: 'warning',
        code: 'headline-long',
        message: `${slide.headline.length} characters is too long to read at thumbnail size. Aim for under 40.`,
        slide: i,
      });
    }
  });

  if (project.presetId === 'phone-portrait' && filled.length > 0 && filled.length < 4) {
    findings.push({
      severity: 'warning',
      code: 'count-weak',
      message: 'Listings with 5-8 screenshots consistently outperform ones with 2-3.',
    });
  }

  if (findings.length === 0) {
    findings.push({
      severity: 'ok',
      code: 'ready',
      message: `${filled.length} asset${filled.length === 1 ? '' : 's'} ready for Play Console.`,
    });
  }

  return findings;
}

export function hasBlockingError(findings: Finding[]): boolean {
  return findings.some((f) => f.severity === 'error');
}
