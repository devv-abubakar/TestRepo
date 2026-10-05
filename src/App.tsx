import { useEffect } from 'react';
import { CourseList } from './components/CourseList';
import { Dashboard } from './components/Dashboard';
import { FolderSelector } from './components/FolderSelector';
import { HandoutTable } from './components/HandoutTable';
import { Header } from './components/Header';
import { LogPanel } from './components/LogPanel';
import { Banner, ConfirmDialog, EnvironmentNotices, ResumeOffer } from './components/Notices';
import { PdfPreview } from './components/PdfPreview';
import { ProgressPanel } from './components/ProgressPanel';
import { ResultsPanel } from './components/ResultsPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { AI_NOTICE } from './constants';
import { useAppStore } from './store/useAppStore';

export default function App() {
  const init = useAppStore((state) => state.init);
  const running = useAppStore((state) => state.running);
  const hasFolder = useAppStore((state) => state.order.length > 0);

  useEffect(() => {
    void init();
  }, [init]);

  // Guard against losing an in-flight batch to an accidental navigation.
  useEffect(() => {
    if (!running) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [running]);

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-panel focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <Header />

      <main id="main" className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        <ResumeOffer />
        <Banner />
        <EnvironmentNotices />
        <SettingsPanel />
        <FolderSelector />

        {hasFolder ? (
          <>
            <Dashboard />
            <ProgressPanel />
            <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
              <CourseList />
              <HandoutTable />
            </div>
            <ResultsPanel />
          </>
        ) : null}

        <LogPanel />
      </main>

      <footer className="mx-auto max-w-7xl px-4 pb-10 pt-2 text-xs text-muted sm:px-6">
        {AI_NOTICE}
      </footer>

      <ConfirmDialog />
      <PdfPreview />
    </div>
  );
}
