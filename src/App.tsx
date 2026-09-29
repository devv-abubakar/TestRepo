import { useEffect, useMemo } from 'react';
import { ensureFontsLoaded } from './core/fonts';
import { Inspector } from './components/Inspector';
import { Notices } from './components/Notices';
import { SlideRail } from './components/SlideRail';
import { Stage } from './components/Stage';
import { TopBar } from './components/TopBar';
import { Welcome } from './components/Welcome';
import { useProject } from './store/useProject';

export default function App() {
  const project = useProject((s) => s.project);
  const images = useProject((s) => s.images);
  const lang = useProject((s) => s.lang);
  const restore = useProject((s) => s.restore);
  const undo = useProject((s) => s.undo);
  const redo = useProject((s) => s.redo);

  const hasContent = useMemo(
    () => project.slides.some((slide) => slide.imageId !== null),
    [project.slides],
  );

  // Restore the previous session before the first paint that could show the
  // welcome screen, so a returning user does not see it flash.
  useEffect(() => {
    void restore();
  }, [restore]);

  // Load every family up front. Canvas silently substitutes a system font for one
  // that has not loaded, and the preview would then disagree with the export.
  useEffect(() => {
    const families = ['Plus Jakarta Sans', 'Space Grotesk', 'Manrope', 'DM Sans', 'Sora', 'Bricolage Grotesque'];
    void ensureFontsLoaded(families, [500, 700, 800]).then(() => {
      useProject.setState((s) => ({ revision: s.revision + 1 }));
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable === true;
      if (typing) return;

      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const imageCount = Object.keys(images).length;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-ink-950 text-ink-100">
      <TopBar />
      {hasContent || imageCount > 0 ? (
        <main className="flex min-h-0 flex-1">
          <SlideRail />
          <Stage />
          <Inspector />
        </main>
      ) : (
        <Welcome />
      )}
      <Notices />
    </div>
  );
}
