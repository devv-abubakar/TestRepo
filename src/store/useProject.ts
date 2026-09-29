import { create } from 'zustand';
import { CropCache, ImageLoadError, loadImageFile, type LoadedImage } from '../core/images';
import { PRESETS } from '../core/playstore';
import { makeProject, makeSlide, newId, reorder, resolveSlide } from '../core/project';
import { suggestSet, type Category } from '../core/copy';
import type {
  Background,
  DeviceStyle,
  PresetId,
  Project,
  Slide,
  TemplateId,
  Theme,
  Typography,
} from '../core/types';
import * as persist from './persist';

export type Lang = 'en' | 'ur';

interface Busy {
  label: string;
  done: number;
  total: number;
}

interface State {
  project: Project;
  images: Record<string, LoadedImage>;
  activeIndex: number;
  lang: Lang;
  category: Category;
  notices: { id: string; kind: 'error' | 'info'; message: string }[];
  busy: Busy | null;
  restored: boolean;
  crops: CropCache;
  /** Bumped whenever something render-affecting changes, to drive repaints. */
  revision: number;

  history: Project[];
  future: Project[];
}

interface Actions {
  addFiles: (files: FileList | File[]) => Promise<void>;
  removeSlide: (index: number) => void;
  addEmptySlide: () => void
  moveSlide: (from: number, to: number) => void;
  setActive: (index: number) => void;
  updateSlide: (index: number, patch: Partial<Slide>) => void;
  setPreset: (presetId: PresetId) => void;
  setTemplate: (templateId: TemplateId) => void;
  setName: (name: string) => void;
  setTheme: (patch: Partial<Theme>) => void;
  setBackground: (patch: Partial<Background>) => void;
  setDevice: (patch: Partial<DeviceStyle>) => void;
  setTypography: (patch: Partial<Typography>) => void;
  setWatermark: (on: boolean) => void;
  setLang: (lang: Lang) => void;
  setCategory: (category: Category) => void;
  applySuggestions: () => void;
  suggestForSlide: (index: number) => void;
  autoCropAll: () => void;
  setBusy: (busy: Busy | null) => void;
  notify: (kind: 'error' | 'info', message: string) => void;
  dismiss: (id: string) => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
  restore: () => Promise<void>;
  imageFor: (slide: Slide) => LoadedImage | null;
}

const HISTORY_LIMIT = 40;

function cloneProject(project: Project): Project {
  return JSON.parse(JSON.stringify(project)) as Project;
}

export const useProject = create<State & Actions>((set, get) => {
  /**
   * Applies a change to the project, recording the previous state for undo and
   * scheduling an autosave. Every mutation goes through here so that undo can
   * never miss one.
   */
  const commit = (
    mutate: (draft: Project) => void,
    options: { history?: boolean } = {},
  ): void => {
    const state = get();
    const previous = state.project;
    const next = cloneProject(previous);
    mutate(next);

    set({
      project: next,
      revision: state.revision + 1,
      history:
        options.history === false
          ? state.history
          : [...state.history, previous].slice(-HISTORY_LIMIT),
      future: options.history === false ? state.future : [],
    });

    persist.saveProject(next);
  };

  return {
    project: makeProject(),
    images: {},
    activeIndex: 0,
    lang: 'en',
    category: 'utility',
    notices: [],
    busy: null,
    restored: false,
    crops: new CropCache(),
    revision: 0,
    history: [],
    future: [],

    notify: (kind, message) =>
      set((s) => ({ notices: [...s.notices, { id: newId(), kind, message }].slice(-4) })),

    dismiss: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),

    setBusy: (busy) => set({ busy }),

    imageFor: (slide) => (slide.imageId ? get().images[slide.imageId] ?? null : null),

    addFiles: async (input) => {
      const files = Array.from(input);
      if (files.length === 0) return;

      const preset = PRESETS[get().project.presetId];
      const loaded: LoadedImage[] = [];

      set({ busy: { label: 'Reading screenshots', done: 0, total: files.length } });

      for (let i = 0; i < files.length; i += 1) {
        const file = files[i]!;
        try {
          const image = await loadImageFile(file, newId());
          loaded.push(image);
          void persist.putImage({ id: image.id, name: image.name, blob: image.blob });
        } catch (error) {
          get().notify(
            'error',
            error instanceof ImageLoadError ? error.message : `${file.name} could not be read.`,
          );
        }
        set({ busy: { label: 'Reading screenshots', done: i + 1, total: files.length } });
      }

      set((s) => ({
        images: { ...s.images, ...Object.fromEntries(loaded.map((l) => [l.id, l])) },
        busy: null,
      }));

      if (loaded.length === 0) return;

      commit((draft) => {
        // Fill empty slides first, then append, never exceeding what Play accepts.
        let queue = [...loaded];
        for (const slide of draft.slides) {
          if (queue.length === 0) break;
          if (slide.imageId === null) {
            const next = queue.shift()!;
            slide.imageId = next.id;
            slide.cropTop = next.suggestedCrop;
          }
        }
        for (const image of queue) {
          if (draft.slides.length >= preset.maxCount) break;
          draft.slides.push(makeSlide({ imageId: image.id, cropTop: image.suggestedCrop }));
        }
        queue = [];
      });

      const over = files.length - loaded.length;
      const room = preset.maxCount - get().project.slides.length;
      if (room < 0) {
        get().notify('info', `Play accepts at most ${preset.maxCount}; the extra files were skipped.`);
      }
      if (over > 0) get().notify('info', `${over} file${over === 1 ? '' : 's'} skipped.`);
    },

    removeSlide: (index) => {
      const slide = get().project.slides[index];
      if (slide?.imageId) {
        get().crops.invalidate(slide.imageId);
        void persist.deleteImage(slide.imageId);
      }
      commit((draft) => {
        draft.slides.splice(index, 1);
        if (draft.slides.length === 0) draft.slides.push(makeSlide());
      });
      set((s) => ({ activeIndex: Math.max(0, Math.min(s.activeIndex, s.project.slides.length - 1)) }));
    },

    addEmptySlide: () => {
      const preset = PRESETS[get().project.presetId];
      if (get().project.slides.length >= preset.maxCount) {
        get().notify('info', `Play accepts at most ${preset.maxCount} of these.`);
        return;
      }
      commit((draft) => {
        draft.slides.push(makeSlide());
      });
      set({ activeIndex: get().project.slides.length - 1 });
    },

    moveSlide: (from, to) =>
      commit((draft) => {
        draft.slides = reorder(draft.slides, from, to);
      }),

    setActive: (index) =>
      set((s) => ({ activeIndex: Math.max(0, Math.min(index, s.project.slides.length - 1)) })),

    updateSlide: (index, patch) =>
      commit((draft) => {
        const slide = draft.slides[index];
        if (slide) Object.assign(slide, patch);
      }),

    setPreset: (presetId) =>
      commit((draft) => {
        draft.presetId = presetId;
        const max = PRESETS[presetId].maxCount;
        if (draft.slides.length > max) draft.slides = draft.slides.slice(0, max);
        while (draft.slides.length < PRESETS[presetId].minCount) draft.slides.push(makeSlide());
      }),

    setTemplate: (templateId) =>
      commit((draft) => {
        draft.templateId = templateId;
        // Choosing a project-wide template clears per-slide overrides, otherwise
        // the click appears to do nothing on the slides that have one.
        for (const slide of draft.slides) slide.templateId = null;
      }),

    setName: (name) => commit((draft) => { draft.name = name; }, { history: false }),

    setTheme: (patch) => commit((draft) => { Object.assign(draft.theme, patch); }),

    setBackground: (patch) =>
      commit((draft) => {
        Object.assign(draft.theme.background, patch);
      }),

    setDevice: (patch) => commit((draft) => { Object.assign(draft.device, patch); }),

    setTypography: (patch) => commit((draft) => { Object.assign(draft.typography, patch); }),

    setWatermark: (on) => commit((draft) => { draft.watermark = on; }),

    setLang: (lang) => set({ lang }),

    setCategory: (category) => set({ category }),

    applySuggestions: () => {
      const { category, project } = get();
      const set8 = suggestSet(category, project.slides.length);
      commit((draft) => {
        draft.slides.forEach((slide, i) => {
          const suggestion = set8[i];
          if (!suggestion) return;
          slide.headline = suggestion.headline;
          slide.subheadline = suggestion.subheadline;
        });
      });
    },

    suggestForSlide: (index) => {
      const { category, project } = get();
      const used = project.slides.map((s) => s.headline);
      const set8 = suggestSet(category, Math.max(project.slides.length, index + 1));
      const pick = set8.find((s) => !used.includes(s.headline)) ?? set8[index];
      if (!pick) return;
      commit((draft) => {
        const slide = draft.slides[index];
        if (slide) {
          slide.headline = pick.headline;
          slide.subheadline = pick.subheadline;
        }
      });
    },

    autoCropAll: () => {
      const { images } = get();
      commit((draft) => {
        for (const slide of draft.slides) {
          if (!slide.imageId) continue;
          const image = images[slide.imageId];
          if (image) slide.cropTop = image.suggestedCrop;
        }
      });
      for (const id of Object.keys(images)) get().crops.invalidate(id);
    },

    undo: () => {
      const { history, project, future, revision } = get();
      const previous = history[history.length - 1];
      if (!previous) return;
      set({
        project: previous,
        history: history.slice(0, -1),
        future: [project, ...future].slice(0, HISTORY_LIMIT),
        revision: revision + 1,
      });
      persist.saveProject(previous);
    },

    redo: () => {
      const { history, project, future, revision } = get();
      const next = future[0];
      if (!next) return;
      set({
        project: next,
        history: [...history, project].slice(-HISTORY_LIMIT),
        future: future.slice(1),
        revision: revision + 1,
      });
      persist.saveProject(next);
    },

    reset: () => {
      get().crops.clear();
      void persist.clearImages();
      persist.clearProject();
      set({
        project: makeProject(),
        images: {},
        activeIndex: 0,
        history: [],
        future: [],
        revision: get().revision + 1,
        notices: [],
      });
    },

    /** Rehydrates the last session. Silent when there is nothing to restore. */
    restore: async () => {
      if (get().restored) return;
      set({ restored: true });

      const saved = persist.loadProject();
      if (!saved) return;

      const stored = await persist.getAllImages();
      const referenced = new Set(saved.slides.map((s) => s.imageId).filter(Boolean));
      const images: Record<string, LoadedImage> = {};

      for (const record of stored) {
        if (!referenced.has(record.id)) {
          // Orphaned by an undo or a removal in the previous session.
          void persist.deleteImage(record.id);
          continue;
        }
        try {
          const file = new File([record.blob], record.name, { type: record.blob.type });
          images[record.id] = await loadImageFile(file, record.id);
        } catch {
          // A blob that no longer decodes; drop the reference rather than fail.
        }
      }

      // Any slide whose screenshot could not be recovered goes back to empty.
      for (const slide of saved.slides) {
        if (slide.imageId && !images[slide.imageId]) slide.imageId = null;
      }

      set({ project: saved, images, revision: get().revision + 1 });
    },
  };
});

/** Convenience selector used by the preview and the export path. */
export function useResolvedSlide(index: number) {
  return useProject((s) => {
    const slide = s.project.slides[index];
    if (!slide) return null;
    const image = slide.imageId ? s.images[slide.imageId] ?? null : null;
    return resolveSlide(s.project, slide, image?.palette ?? null);
  });
}
