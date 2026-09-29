/**
 * StoreShot core data model.
 *
 * Everything in `src/core` is deliberately free of React and (where possible)
 * of the DOM, so the rendering and validation rules can be unit tested and
 * later reused — including by a native port.
 */

export type PresetId =
  | 'phone-portrait'
  | 'phone-landscape'
  | 'tablet-7'
  | 'tablet-10'
  | 'feature-graphic';

export interface Preset {
  id: PresetId;
  label: string;
  /** Exact pixel width Play Store assets are exported at. */
  width: number;
  height: number;
  minCount: number;
  maxCount: number;
  /** Play rejects alpha on screenshots and the feature graphic. */
  forbidsAlpha: boolean;
  hint: string;
}

export type TemplateId =
  | 'spotlight'
  | 'tilt'
  | 'bleed'
  | 'split'
  | 'minimal'
  | 'bold-type'
  | 'frameless'
  | 'duo';

export type FrameKind = 'phone' | 'tablet' | 'none';
export type FrameColor = 'graphite' | 'silver' | 'white' | 'sand' | 'midnight';

export interface DeviceStyle {
  kind: FrameKind;
  color: FrameColor;
  /** Generic punch-hole / notch cutout. No vendor-specific shapes. */
  cutout: 'punch' | 'pill' | 'none';
  shadow: boolean;
  /** Draw the OS status bar inside the frame. */
  statusBar: boolean;
}

export type BackgroundKind = 'gradient' | 'solid' | 'mesh' | 'image-blur';

export interface Background {
  kind: BackgroundKind;
  colors: string[];
  /** Degrees, 0 = left-to-right. */
  angle: number;
  /** 0..1 vignette strength. */
  vignette: number;
  noise: number;
}

export interface Typography {
  headlineFont: string;
  bodyFont: string;
  headlineWeight: number;
  /** Multiplier applied to the template's base type size. */
  scale: number;
  align: 'left' | 'center' | 'right';
  uppercase: boolean;
  letterSpacing: number;
}

export interface Theme {
  /** 'auto' derives the palette from the uploaded screenshot. */
  source: 'auto' | 'palette';
  paletteId: string;
  background: Background;
  textColor: string;
  accent: string;
}

export interface Slide {
  id: string;
  /** Key into the image store; null while the slide is still empty. */
  imageId: string | null;
  headline: string;
  subheadline: string;
  /** null = inherit the project template. */
  templateId: TemplateId | null;
  /** Per-slide background override, for accent slides in a set. */
  background: Background | null;
  /** Crop the screenshot's own status bar away. 0..0.2 of image height. */
  cropTop: number;
}

export interface Project {
  version: 1;
  name: string;
  presetId: PresetId;
  templateId: TemplateId;
  slides: Slide[];
  theme: Theme;
  device: DeviceStyle;
  typography: Typography;
  watermark: boolean;
}

/** A slide with all inheritance resolved — what the renderer actually consumes. */
export interface ResolvedSlide {
  slide: Slide;
  templateId: TemplateId;
  background: Background;
  textColor: string;
  accent: string;
  device: DeviceStyle;
  typography: Typography;
  watermark: boolean;
}

export interface RenderSpec {
  width: number;
  height: number;
  resolved: ResolvedSlide;
  /** Already-cropped screenshot, or null to render the empty state. */
  image: CanvasImageSource | null;
  imageWidth: number;
  imageHeight: number;
  /** Scale factor for preview rendering; 1 = full export size. */
  dpr: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
