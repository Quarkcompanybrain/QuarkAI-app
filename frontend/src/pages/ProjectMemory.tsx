import { useEffect, useState } from 'react';
import { useOutletContext, useParams } from 'react-router-dom';
import { FilesPanel } from '../features/files/FilesPanel';
import { projectsApi, type WhatsAppMemoryChunk } from '../features/projects/api';
import { PulseNode } from '../components/PulseNode';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { ChatBubbleIcon, MailIcon, PencilIcon, TrashIcon, WebhookIcon } from '../components/icons';
import type { Project } from '../types';

interface ProjectOutletContext {
  project: Project | null;
}

export function ProjectMemory() {
  const { projectId = '' } = useParams();
  const { project } = useOutletContext<ProjectOutletContext>();
  const [chunks, setChunks] = useState<WhatsAppMemoryChunk[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setChunks(null);
    projectsApi.listWhatsAppMemory(projectId).then((r) => setChunks(r.chunks));
  }, [projectId]);

  const startEditing = (chunk: WhatsAppMemoryChunk) => {
    setEditingId(chunk.id);
    setDraft(chunk.text);
    setError(null);
  };

  const saveChunk = async () => {
    if (!editingId || !draft.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const result = await projectsApi.updateChunk(projectId, editingId, draft);
      setChunks((current) => current?.map((chunk) => (chunk.id === editingId ? { ...chunk, text: result.chunk.text } : chunk)) || null);
      setEditingId(null);
      setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update this knowledge entry.');
    } finally {
      setSaving(false);
    }
  };

  const deleteChunk = async (chunkId: string) => {
    if (!window.confirm('Delete this saved knowledge entry?')) return;
    setError(null);
    try {
      await projectsApi.deleteChunk(projectId, chunkId);
      setChunks((current) => current?.filter((chunk) => chunk.id !== chunkId) || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete this knowledge entry.');
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-6">
      <div className="flex flex-col gap-8">
        <FilesPanel projectId={projectId} canManageChunks={Boolean(project?.canManageMemory)} />

        <section>
          <h2 className="mb-4 font-display text-lg font-semibold text-ink">WhatsApp & email knowledge</h2>
          <ErrorBanner message={error} />

          {chunks === null ? (
            <p className="flex items-center gap-2 text-sm text-neutral-500">
              <PulseNode size={6} /> Loading…
            </p>
          ) : chunks.length === 0 ? (
            <EmptyState
              icon={<ChatBubbleIcon className="h-5 w-5 text-magenta-500" />}
              title="No WhatsApp, email or Cheerio knowledge yet"
              description="Once a linked chat, mailbox or Cheerio connection receives something worth remembering, it'll show up here."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-150 shadow-xs">
              {chunks.map((c) => (
                <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-neutral-150 bg-neutral-50 text-neutral-400">
                    {c.sourceType === 'email' ? (
                      <MailIcon className="h-4 w-4" />
                    ) : c.sourceType === 'cheerio' ? (
                      <WebhookIcon className="h-4 w-4" />
                    ) : (
                      <ChatBubbleIcon className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-xs font-medium text-neutral-500">{c.chatName || c.chatJid || (c.sourceType === 'email' ? 'Email' : c.sourceType === 'cheerio' ? 'Cheerio' : 'WhatsApp')}</p>
                      {c.messageTimestamp && (
                        <p className="shrink-0 text-xs text-neutral-400">
                          {new Date(c.messageTimestamp).toLocaleString()}
                        </p>
                      )}
                    </div>
                    {editingId === c.id ? (
                      <div className="mt-2">
                        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={4} className="w-full resize-y rounded-lg border border-neutral-200 px-3 py-2 text-sm leading-6 text-ink outline-none focus:border-magenta-500 focus:shadow-[0_0_0_3px_rgba(255,27,205,0.10)]" />
                        <div className="mt-2 flex justify-end gap-2">
                          <button onClick={() => { setEditingId(null); setDraft(''); }} disabled={saving} className="rounded-md px-2 py-1 text-xs font-medium text-neutral-500 hover:bg-neutral-100">Cancel</button>
                          <button onClick={saveChunk} disabled={saving || !draft.trim()} className="rounded-md bg-ink px-2.5 py-1 text-xs font-medium text-white hover:bg-neutral-700 disabled:bg-neutral-200">{saving ? 'Saving…' : 'Save'}</button>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-1 text-sm text-ink">{c.text}</p>
                    )}
                  </div>
                  {project?.canManageMemory && editingId !== c.id && (
                    <div className="flex shrink-0 gap-1">
                      <button onClick={() => startEditing(c)} aria-label="Edit knowledge entry" className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-magenta-600"><PencilIcon className="h-3.5 w-3.5" /></button>
                      <button onClick={() => deleteChunk(c.id)} aria-label="Delete knowledge entry" className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-magenta-600"><TrashIcon className="h-3.5 w-3.5" /></button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
