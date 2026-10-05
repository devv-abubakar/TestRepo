import { useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { isFileSystemAccessSupported } from '../services/filesystem';
import { Card, Icon } from './ui';

export function FolderSelector() {
  const selectFolder = useAppStore((state) => state.selectFolder);
  const selectFiles = useAppStore((state) => state.selectFiles);
  const scanning = useAppStore((state) => state.scanning);
  const running = useAppStore((state) => state.running);
  const rootName = useAppStore((state) => state.rootName);
  const source = useAppStore((state) => state.source);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Card
      id="folder"
      title="Folder Selection"
      description="Pick the root folder that contains your course folders. Nothing is read until you grant permission."
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-primary"
          onClick={() => void selectFolder()}
          disabled={scanning || running || !isFileSystemAccessSupported()}
        >
          <Icon name="folder" />
          Select Handouts Folder
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => inputRef.current?.click()}
          disabled={scanning || running}
        >
          Select folder (fallback)
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          // Non-standard attributes are how browsers expose directory input.
          {...{ webkitdirectory: '', directory: '' }}
          className="sr-only"
          aria-label="Select handouts folder (fallback)"
          onChange={(event) => {
            const { files } = event.target;
            if (files && files.length > 0) void selectFiles(files);
            event.target.value = '';
          }}
        />
      </div>

      {scanning ? <p className="mt-3 text-sm text-muted">Scanning folders…</p> : null}

      {rootName ? (
        <p className="mt-3 text-sm text-ink">
          <strong>{rootName}</strong>
          <span className="text-muted">
            {' '}
            — {source?.canWrite
              ? 'outputs will be written next to each original handout.'
              : 'outputs will be offered as downloads and a ZIP.'}
          </span>
        </p>
      ) : null}
    </Card>
  );
}
