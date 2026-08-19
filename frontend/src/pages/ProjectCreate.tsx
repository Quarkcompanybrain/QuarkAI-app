import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { FileTextIcon, UploadIcon, XIcon } from '../components/icons';
import { filesApi } from '../features/files/api';
import { projectsApi } from '../features/projects/api';
import { ApiRequestError } from '../lib/api';

const MAX_CONTEXT_FILES = 10;
const ACCEPTED_CONTEXT_FILES = '.pdf,.docx,.pptx,.xlsx,.xls,.csv,.txt,.md,.png,.jpg,.jpeg,.gif,.webp';

export function ProjectCreate() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [uploadFailures, setUploadFailures] = useState<string[]>([]);

  const addFiles = (incoming: File[]) => {
    setError(null);
    const next = [...files, ...incoming];
    if (next.length > MAX_CONTEXT_FILES) {
      setError(`You can add up to ${MAX_CONTEXT_FILES} context files when creating a project.`);
      setFiles(next.slice(0, MAX_CONTEXT_FILES));
      return;
    }
    setFiles(next);
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files || []));
    event.target.value = '';
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);
    setError(null);
    setUploadFailures([]);
    try {
      const result = await projectsApi.create({ name: name.trim(), description: description.trim(), websiteUrl: websiteUrl.trim() });
      const projectId = result.project.id;
      setCreatedProjectId(projectId);

      const uploads = await Promise.allSettled(files.map((file) => filesApi.upload(file, projectId)));
      const failed = uploads.flatMap((upload, index) => (upload.status === 'rejected' ? [files[index].name] : []));
      if (failed.length > 0) {
        setUploadFailures(failed);
        return;
      }
      navigate(`/projects/${projectId}/chat`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not create this project.');
    } finally {
      setSubmitting(false);
    }
  };

  if (createdProjectId && uploadFailures.length > 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-10">
        <div className="mx-auto max-w-xl rounded-2xl border border-magenta-100 bg-white p-7 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-magenta-600">Project created</p>
          <h1 className="mt-2 font-display text-2xl font-semibold text-ink">Some context files could not be uploaded</h1>
          <p className="mt-2 text-sm leading-6 text-neutral-600">You can upload these again from the project’s Memory tab.</p>
          <ul className="mt-4 rounded-xl bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
            {uploadFailures.map((filename) => <li key={filename}>{filename}</li>)}
          </ul>
          <div className="mt-6 flex justify-end">
            <Button onClick={() => navigate(`/projects/${createdProjectId}/chat`, { replace: true })}>Open project</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-10">
      <motion.main
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        className="mx-auto max-w-2xl"
      >
        <div className="border-l-2 border-magenta-500 pl-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-magenta-600">New project</p>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-ink">Give Quark a clear brief.</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-neutral-600">This context lets Quark distinguish your project’s knowledge from unrelated conversation.</p>
        </div>

        <form onSubmit={submit} className="mt-8 space-y-6">
          <section className="rounded-2xl border border-neutral-150 bg-white p-6 shadow-sm">
            <h2 className="font-display text-lg font-semibold text-ink">Project brief</h2>
            <div className="mt-5 grid gap-4">
              <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
                Project name
                <input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Quark product launch" className="rounded-lg border border-neutral-200 px-3.5 py-2.5 text-sm font-normal outline-none transition focus:border-magenta-500 focus:shadow-[0_0_0_3px_rgba(255,27,205,0.10)]" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
                Website URL <span className="font-normal text-neutral-400">(optional)</span>
                <input value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} placeholder="https://example.com" inputMode="url" className="rounded-lg border border-neutral-200 px-3.5 py-2.5 text-sm font-normal outline-none transition focus:border-magenta-500 focus:shadow-[0_0_0_3px_rgba(255,27,205,0.10)]" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
                What belongs in this project?
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={4} placeholder="Describe the product, workstream, people, goals, and the information Quark should keep." className="resize-y rounded-lg border border-neutral-200 px-3.5 py-2.5 text-sm font-normal leading-6 outline-none transition focus:border-magenta-500 focus:shadow-[0_0_0_3px_rgba(255,27,205,0.10)]" />
                <span className="text-xs font-normal text-neutral-400">Quark uses this brief to skip unrelated WhatsApp messages and file content.</span>
              </label>
            </div>
          </section>

          <section className="rounded-2xl border border-neutral-150 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-lg font-semibold text-ink">Context files</h2>
                <p className="mt-1 text-sm leading-5 text-neutral-500">Add supporting material now. PDFs, documents, spreadsheets, slides, text files, and images are supported.</p>
              </div>
              <span className="shrink-0 rounded-full bg-magenta-50 px-2.5 py-1 text-xs font-medium text-magenta-700">{files.length}/{MAX_CONTEXT_FILES}</span>
            </div>

            <input ref={fileInputRef} type="file" multiple accept={ACCEPTED_CONTEXT_FILES} onChange={onFileChange} className="hidden" />
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={files.length >= MAX_CONTEXT_FILES} className="mt-5 flex w-full flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 px-4 py-7 text-center transition hover:border-magenta-400 hover:bg-magenta-50/30 disabled:cursor-not-allowed disabled:opacity-50">
              <UploadIcon className="h-5 w-5 text-magenta-500" />
              <span className="mt-2 text-sm font-medium text-ink">Choose context files</span>
              <span className="mt-1 text-xs text-neutral-400">Up to {MAX_CONTEXT_FILES} files</span>
            </button>

            {files.length > 0 && (
              <ul className="mt-4 divide-y divide-neutral-100 rounded-xl border border-neutral-150">
                {files.map((file, index) => (
                  <li key={`${file.name}-${file.lastModified}-${index}`} className="flex items-center gap-3 px-3.5 py-2.5">
                    <FileTextIcon className="h-4 w-4 shrink-0 text-magenta-500" />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{file.name}</span>
                    <span className="text-xs text-neutral-400">{Math.max(1, Math.round(file.size / 1024))} KB</span>
                    <button type="button" onClick={() => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))} aria-label={`Remove ${file.name}`} className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-ink"><XIcon className="h-3.5 w-3.5" /></button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <ErrorBanner message={error} />
          <div className="flex items-center justify-end gap-3 pb-8">
            <Button type="button" variant="ghost" onClick={() => navigate(-1)} disabled={submitting}>Cancel</Button>
            <Button type="submit" loading={submitting}>{files.length ? 'Create and upload' : 'Create project'}</Button>
          </div>
        </form>
      </motion.main>
    </div>
  );
}
