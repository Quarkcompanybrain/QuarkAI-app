import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { filesApi, type FileChunk } from './api';
import type { FileItem, FileStatus } from '../../types';
import { PulseNode } from '../../components/PulseNode';
import { ErrorBanner } from '../../components/ErrorBanner';
import { EmptyState } from '../../components/EmptyState';
import { EyeIcon, FileTextIcon, UploadIcon } from '../../components/icons';

const STATUS_LABEL: Record<FileStatus, string> = {
  pending: 'Queued',
  in_progress: 'Processing',
  done: 'Ready',
  failed: 'Failed',
};

const STATUS_STYLE: Record<FileStatus, string> = {
  pending: 'bg-neutral-100 text-neutral-500',
  in_progress: 'bg-neutral-100 text-neutral-600',
  done: 'bg-neutral-100 text-neutral-600',
  failed: 'bg-magenta-50 text-magenta-600',
};

export function FilesPanel({ projectId }: { projectId?: string }) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    filesApi
      .list(projectId)
      .then((r) => setFiles(r.files))
      .catch((err) => setError(err.message));
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll while anything is still processing — no websocket needed for a simple status field.
  useEffect(() => {
    const hasActive = files.some((f) => f.status === 'pending' || f.status === 'in_progress');
    if (!hasActive) return;
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [files, refresh]);

  const handleFileSelect = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(fileList)) {
        await filesApi.upload(file, projectId);
      }
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    handleFileSelect(e.dataTransfer.files);
  };

  return (
    <div
      className="relative flex flex-col gap-4"
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragActive(false);
      }}
      onDrop={handleDrop}
    >
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-ink">Files</h2>
        <label className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-neutral-700">
          <UploadIcon className="h-3.5 w-3.5" />
          {uploading ? 'Uploading…' : 'Upload file'}
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleFileSelect(e.target.files)}
          />
        </label>
      </div>

      <ErrorBanner message={error} />

      {files.length === 0 ? (
        <EmptyState
          icon={<UploadIcon className="h-5 w-5 text-magenta-500" />}
          title="No files yet"
          description="Drag and drop a file anywhere on this page, or use Upload file, to make it searchable in chat."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-150 shadow-xs">
          <AnimatePresence initial={false}>
            {files.map((f, i) => (
              <motion.li
                key={f.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: Math.min(i * 0.03, 0.3), ease: [0.16, 1, 0.3, 1] }}
              >
                <FileRow file={f} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      <AnimatePresence>
        {dragActive && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-sm"
          >
            <div className="rounded-2xl border-2 border-dashed border-magenta-400 bg-magenta-50/60 px-12 py-10 text-center shadow-glow">
              <UploadIcon className="mx-auto mb-3 h-6 w-6 text-magenta-500" />
              <p className="font-display text-base font-semibold text-magenta-600">Drop to upload</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FileRow({ file }: { file: FileItem }) {
  const [viewing, setViewing] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [chunks, setChunks] = useState<FileChunk[] | null>(null);
  const [chunksError, setChunksError] = useState<string | null>(null);

  const handleView = async () => {
    setViewing(true);
    try {
      const { downloadUrl } = await filesApi.get(file.id);
      window.open(downloadUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setChunksError(err instanceof Error ? err.message : 'Could not open file.');
    } finally {
      setViewing(false);
    }
  };

  const handleToggleMemory = async () => {
    const next = !showMemory;
    setShowMemory(next);
    if (next && chunks === null) {
      try {
        const res = await filesApi.getChunks(file.id);
        setChunks(res.chunks);
      } catch (err) {
        setChunksError(err instanceof Error ? err.message : 'Could not load memory.');
      }
    }
  };

  return (
    <div className="group bg-white transition-colors hover:bg-neutral-25">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-neutral-150 bg-neutral-50 text-neutral-400">
            <FileTextIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{file.filename}</p>
            {file.status === 'failed' && file.failureReason && (
              <p className="truncate text-xs text-magenta-500">{file.failureReason}</p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {file.status === 'done' && (
            <span className="flex items-center gap-3 opacity-70 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
              <button
                onClick={handleToggleMemory}
                className="flex items-center gap-1 text-xs font-medium text-neutral-500 transition-colors hover:text-magenta-600"
              >
                {showMemory ? 'Hide memory' : 'View memory'}
              </button>
              <button
                onClick={handleView}
                disabled={viewing}
                aria-label="View file"
                className="flex items-center gap-1 text-xs font-medium text-neutral-500 transition-colors hover:text-magenta-600"
              >
                <EyeIcon className="h-3.5 w-3.5" />
              </button>
            </span>
          )}
          <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[file.status]}`}>
            {(file.status === 'pending' || file.status === 'in_progress') && <PulseNode size={6} />}
            {STATUS_LABEL[file.status]}
          </span>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {showMemory && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="mx-4 mb-4 rounded-lg bg-neutral-50 p-3">
              <ErrorBanner message={chunksError} />
              {chunks === null ? (
                <p className="flex items-center gap-2 text-xs text-neutral-500">
                  <PulseNode size={6} /> Loading memory…
                </p>
              ) : chunks.length === 0 ? (
                <p className="text-xs text-neutral-500">No chunks stored for this file.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {chunks.map((c) => (
                    <li
                      key={c.id}
                      className="rounded-md border border-neutral-150 bg-white p-2.5 font-mono text-xs leading-relaxed text-neutral-700"
                    >
                      <span className="mb-1 block font-sans font-medium text-neutral-400">Chunk {c.chunkIndex + 1}</span>
                      {c.text}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
