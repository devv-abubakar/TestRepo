import { useState } from 'react';
import { Scissors, Wand2 } from 'lucide-react';
import { CATEGORIES } from '../core/copy';
import { FONTS, fontOption } from '../core/fonts';
import { PALETTES } from '../core/palette';
import { templatesForPreset } from '../core/templates';
import { translate } from '../i18n';
import { useProject } from '../store/useProject';
import { ExportPanel } from './ExportPanel';
import { Button, Field, Panel, Row, Segmented, Slider, TextArea, TextInput, Toggle } from './ui';
import type { BackgroundKind, FrameColor, FrameKind } from '../core/types';

type Tab = 'design' | 'caption' | 'device' | 'export';

export function Inspector() {
  const [tab, setTab] = useState<Tab>('design');
  const lang = useProject((s) => s.lang);
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'design', label: t('nav.design') },
    { id: 'caption', label: t('nav.caption') },
    { id: 'device', label: t('nav.device') },
    { id: 'export', label: t('nav.export') },
  ];

  return (
    <aside className="flex w-[336px] shrink-0 flex-col border-l border-white/[0.06] bg-ink-900/55">
      <nav className="flex shrink-0 gap-1 border-b border-white/[0.06] p-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            data-testid={`tab-${item.id}`}
            onClick={() => setTab(item.id)}
            aria-current={tab === item.id}
            className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${
              tab === item.id
                ? 'bg-white/[0.08] text-ink-50'
                : 'text-ink-400 hover:bg-white/[0.04] hover:text-ink-200'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {tab === 'design' && <DesignTab />}
        {tab === 'caption' && <CaptionTab />}
        {tab === 'device' && <DeviceTab />}
        {tab === 'export' && <ExportPanel />}
      </div>
    </aside>
  );
}

function DesignTab() {
  const project = useProject((s) => s.project);
  const lang = useProject((s) => s.lang);
  const setTemplate = useProject((s) => s.setTemplate);
  const setTheme = useProject((s) => s.setTheme);
  const setBackground = useProject((s) => s.setBackground);
  const setTypography = useProject((s) => s.setTypography);
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);

  const templates = templatesForPreset(project.presetId);
  const bg = project.theme.background;
  const typo = project.typography;

  return (
    <>
      <Panel title={t('field.template')}>
        <div className="grid grid-cols-2 gap-2">
          {templates.map((template) => {
            const active = project.templateId === template.id;
            return (
              <button
                key={template.id}
                type="button"
                data-testid={`template-${template.id}`}
                onClick={() => setTemplate(template.id)}
                title={template.blurb}
                aria-current={active}
                className={`rounded-xl border px-2.5 py-2 text-left transition ${
                  active
                    ? 'border-brand-400/70 bg-brand-500/12'
                    : 'border-white/[0.07] hover:border-white/20 hover:bg-white/[0.04]'
                }`}
              >
                <span className="block text-[11px] font-bold text-ink-50">{template.label}</span>
                <span className="mt-0.5 block text-[9px] leading-tight text-ink-400">
                  {template.blurb.split('.')[0]}
                </span>
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel title={t('field.palette')}>
        <Segmented
          label={t('field.palette')}
          value={project.theme.source}
          onChange={(source) => setTheme({ source })}
          options={[
            { value: 'auto', label: t('field.paletteAuto') },
            { value: 'palette', label: 'Preset' },
          ]}
        />

        {project.theme.source === 'palette' && (
          <div className="grid grid-cols-5 gap-2">
            {PALETTES.map((palette) => {
              const active = project.theme.paletteId === palette.id;
              return (
                <button
                  key={palette.id}
                  type="button"
                  title={palette.label}
                  aria-label={palette.label}
                  aria-current={active}
                  onClick={() => setTheme({ paletteId: palette.id })}
                  className={`h-9 rounded-lg ring-offset-2 ring-offset-ink-850 transition ${
                    active ? 'ring-2 ring-brand-400' : 'ring-1 ring-white/10 hover:ring-white/35'
                  }`}
                  style={{
                    background: `linear-gradient(135deg, ${palette.colors.join(', ')})`,
                  }}
                />
              );
            })}
          </div>
        )}

        <Field label={t('field.background')}>
          <Segmented
            label={t('field.background')}
            value={bg.kind}
            onChange={(kind) => setBackground({ kind: kind as BackgroundKind })}
            options={[
              { value: 'gradient', label: 'Gradient' },
              { value: 'mesh', label: 'Mesh' },
              { value: 'solid', label: 'Solid' },
              { value: 'image-blur', label: 'Blur', title: 'The screenshot itself, blurred' },
            ]}
          />
        </Field>

        {bg.kind === 'gradient' && (
          <Field label={t('field.angle')} hint={`${bg.angle}°`}>
            <Slider
              ariaLabel={t('field.angle')}
              value={bg.angle}
              min={0}
              max={360}
              step={5}
              onChange={(angle) => setBackground({ angle })}
            />
          </Field>
        )}

        <Field label={t('field.vignette')} hint={bg.vignette.toFixed(2)}>
          <Slider
            ariaLabel={t('field.vignette')}
            value={bg.vignette}
            min={0}
            max={0.7}
            step={0.02}
            onChange={(vignette) => setBackground({ vignette })}
          />
        </Field>

        <Field
          label={t('field.grain')}
          hint={bg.noise === 0 ? 'off' : bg.noise.toFixed(3)}
        >
          <Slider
            ariaLabel={t('field.grain')}
            value={bg.noise}
            min={0}
            max={0.16}
            step={0.005}
            onChange={(noise) => setBackground({ noise })}
          />
        </Field>
      </Panel>

      <Panel title="Type">
        <Field label={t('field.font')} hint={fontOption(typo.headlineFont).note}>
          <select
            value={typo.headlineFont}
            onChange={(e) => {
              const family = e.target.value;
              const option = fontOption(family);
              // Keep the weight valid for the new family, otherwise canvas
              // silently renders the nearest available face.
              const weight = option.weights.includes(typo.headlineWeight)
                ? typo.headlineWeight
                : option.weights[option.weights.length - 1]!;
              setTypography({ headlineFont: family, bodyFont: family, headlineWeight: weight });
            }}
            className="w-full rounded-xl border border-white/[0.07] bg-ink-900/80 px-3 py-2 text-sm text-ink-50 outline-none focus:border-brand-400/60"
          >
            {FONTS.map((font) => (
              <option key={font.family} value={font.family}>
                {font.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('field.weight')}>
          <Segmented
            label={t('field.weight')}
            value={String(typo.headlineWeight)}
            onChange={(value) => setTypography({ headlineWeight: Number(value) })}
            options={fontOption(typo.headlineFont).weights.map((w) => ({
              value: String(w),
              label: String(w),
            }))}
          />
        </Field>

        <Field label={t('field.size')} hint={`${Math.round(typo.scale * 100)}%`}>
          <Slider
            ariaLabel={t('field.size')}
            value={typo.scale}
            min={0.6}
            max={1.5}
            step={0.02}
            onChange={(scale) => setTypography({ scale })}
          />
        </Field>

        <Field label={t('field.tracking')} hint={`${typo.letterSpacing}`}>
          <Slider
            ariaLabel={t('field.tracking')}
            value={typo.letterSpacing}
            min={-30}
            max={40}
            step={2}
            onChange={(letterSpacing) => setTypography({ letterSpacing })}
          />
        </Field>

        <Row label={t('field.uppercase')}>
          <Toggle
            label={t('field.uppercase')}
            checked={typo.uppercase}
            onChange={(uppercase) => setTypography({ uppercase })}
          />
        </Row>
      </Panel>
    </>
  );
}

function CaptionTab() {
  const project = useProject((s) => s.project);
  const activeIndex = useProject((s) => s.activeIndex);
  const lang = useProject((s) => s.lang);
  const category = useProject((s) => s.category);
  const updateSlide = useProject((s) => s.updateSlide);
  const setCategory = useProject((s) => s.setCategory);
  const applySuggestions = useProject((s) => s.applySuggestions);
  const suggestForSlide = useProject((s) => s.suggestForSlide);
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);

  const slide = project.slides[activeIndex];
  if (!slide) return null;

  const length = slide.headline.trim().length;
  const tone = length === 0 ? 'text-ink-500' : length > 40 ? 'text-amber-400' : 'text-emerald-400';

  return (
    <>
      <Panel title={`${t('field.headline')} · ${activeIndex + 1}`}>
        <Field label={t('field.headline')} hint={`${length}`}>
          <TextInput
            value={slide.headline}
            onChange={(headline) => updateSlide(activeIndex, { headline })}
            placeholder="Know where your money went"
            maxLength={120}
          />
        </Field>
        <p className={`text-[10px] ${tone}`}>
          {length === 0
            ? 'A screenshot with no caption converts noticeably worse.'
            : length > 40
              ? 'Long for a thumbnail. Under 40 characters reads better.'
              : 'Good length for the store listing.'}
        </p>

        <Field label={t('field.subheadline')}>
          <TextArea
            value={slide.subheadline}
            onChange={(subheadline) => updateSlide(activeIndex, { subheadline })}
            placeholder="Every rupee accounted for, automatically"
            maxLength={160}
            rows={2}
          />
        </Field>

        <Button variant="secondary" full onClick={() => suggestForSlide(activeIndex)}>
          <Wand2 size={13} /> {t('action.suggestOne')}
        </Button>
      </Panel>

      <Panel title={t('field.category')}>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as typeof category)}
          className="w-full rounded-xl border border-white/[0.07] bg-ink-900/80 px-3 py-2 text-sm text-ink-50 outline-none focus:border-brand-400/60"
        >
          {CATEGORIES.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>

        <p className="text-[10px] leading-relaxed text-ink-400">
          Captions follow the sequence that converts: a hook first, then what the
          app does, then proof, then a close. Play shows the first three
          screenshots without scrolling.
        </p>

        <Button variant="primary" full onClick={applySuggestions}>
          <Wand2 size={13} /> {t('action.suggest')}
        </Button>
      </Panel>
    </>
  );
}

function DeviceTab() {
  const project = useProject((s) => s.project);
  const activeIndex = useProject((s) => s.activeIndex);
  const lang = useProject((s) => s.lang);
  const images = useProject((s) => s.images);
  const setDevice = useProject((s) => s.setDevice);
  const setWatermark = useProject((s) => s.setWatermark);
  const updateSlide = useProject((s) => s.updateSlide);
  const autoCropAll = useProject((s) => s.autoCropAll);
  const crops = useProject((s) => s.crops);
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);

  const device = project.device;
  const slide = project.slides[activeIndex];
  const image = slide?.imageId ? images[slide.imageId] ?? null : null;

  return (
    <>
      <Panel title={t('field.frame')}>
        <Segmented
          label={t('field.frame')}
          value={device.kind}
          onChange={(kind) => setDevice({ kind: kind as FrameKind })}
          options={[
            { value: 'phone', label: 'Phone' },
            { value: 'tablet', label: 'Tablet' },
            { value: 'none', label: 'None' },
          ]}
        />

        <p className="text-[10px] leading-relaxed text-ink-400">
          Frames are drawn, not photographed, so they scale to any export size —
          and they are deliberately generic rather than modelled on a real
          handset.
        </p>

        {device.kind !== 'none' && (
          <>
            <Field label={t('field.finish')}>
              <div className="grid grid-cols-5 gap-2">
                {(['graphite', 'silver', 'white', 'sand', 'midnight'] as FrameColor[]).map((color) => (
                  <button
                    key={color}
                    type="button"
                    title={color}
                    aria-label={color}
                    aria-current={device.color === color}
                    onClick={() => setDevice({ color })}
                    className={`h-8 rounded-lg ring-offset-2 ring-offset-ink-850 transition ${
                      device.color === color
                        ? 'ring-2 ring-brand-400'
                        : 'ring-1 ring-white/10 hover:ring-white/35'
                    }`}
                    style={{
                      background:
                        color === 'graphite'
                          ? 'linear-gradient(135deg,#3a3d45,#1b1d22)'
                          : color === 'silver'
                            ? 'linear-gradient(135deg,#e8eaee,#b9bdc6)'
                            : color === 'white'
                              ? 'linear-gradient(135deg,#fbfbfc,#dfe1e6)'
                              : color === 'sand'
                                ? 'linear-gradient(135deg,#e7d7c4,#c2ab92)'
                                : 'linear-gradient(135deg,#1e2230,#0a0c13)',
                    }}
                  />
                ))}
              </div>
            </Field>

            <Field label={t('field.cutout')}>
              <Segmented
                label={t('field.cutout')}
                value={device.cutout}
                onChange={(cutout) => setDevice({ cutout: cutout as typeof device.cutout })}
                options={[
                  { value: 'punch', label: 'Hole' },
                  { value: 'pill', label: 'Pill' },
                  { value: 'none', label: 'None' },
                ]}
              />
            </Field>

            <Row label={t('field.statusBar')}>
              <Toggle
                label={t('field.statusBar')}
                checked={device.statusBar}
                onChange={(statusBar) => setDevice({ statusBar })}
              />
            </Row>
          </>
        )}

        <Row label={t('field.shadow')}>
          <Toggle
            label={t('field.shadow')}
            checked={device.shadow}
            onChange={(shadow) => setDevice({ shadow })}
          />
        </Row>
      </Panel>

      <Panel title={t('field.crop')}>
        {slide && (
          <Field
            label={t('field.crop')}
            hint={`${Math.round(slide.cropTop * 1000) / 10}%`}
          >
            <Slider
              ariaLabel={t('field.crop')}
              value={slide.cropTop}
              min={0}
              max={0.2}
              step={0.002}
              onChange={(cropTop) => {
                if (slide.imageId) crops.invalidate(slide.imageId);
                updateSlide(activeIndex, { cropTop });
              }}
            />
          </Field>
        )}

        <p className="text-[10px] leading-relaxed text-ink-400">
          Removes the status bar your phone captured — your battery level, your
          notifications, your carrier — so the frame can draw a neutral one
          instead.
          {image && image.suggestedCrop > 0 && (
            <span className="mt-1 block text-emerald-400">
              Detected a status bar {Math.round(image.suggestedCrop * 1000) / 10}% from the top.
            </span>
          )}
        </p>

        <Button variant="secondary" full onClick={autoCropAll}>
          <Scissors size={13} /> {t('action.autoCrop')}
        </Button>
      </Panel>

      <Panel title={t('field.watermark')}>
        <Row label={t('field.watermark')}>
          <Toggle
            label={t('field.watermark')}
            checked={project.watermark}
            onChange={setWatermark}
          />
        </Row>
      </Panel>
    </>
  );
}
