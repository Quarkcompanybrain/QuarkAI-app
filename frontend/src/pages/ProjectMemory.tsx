import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FilesPanel } from '../features/files/FilesPanel';
import { projectsApi, type WhatsAppMemoryChunk } from '../features/projects/api';
import { PulseNode } from '../components/PulseNode';
import { EmptyState } from '../components/EmptyState';
import { ChatBubbleIcon } from '../components/icons';

export function ProjectMemory() {
  const { projectId = '' } = useParams();
  const [chunks, setChunks] = useState<WhatsAppMemoryChunk[] | null>(null);

  useEffect(() => {
    setChunks(null);
    projectsApi.listWhatsAppMemory(projectId).then((r) => setChunks(r.chunks));
  }, [projectId]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-6">
      <div className="flex flex-col gap-8">
        <FilesPanel projectId={projectId} />

        <section>
          <h2 className="mb-4 font-display text-lg font-semibold text-ink">WhatsApp knowledge</h2>

          {chunks === null ? (
            <p className="flex items-center gap-2 text-sm text-neutral-500">
              <PulseNode size={6} /> Loading…
            </p>
          ) : chunks.length === 0 ? (
            <EmptyState
              icon={<ChatBubbleIcon className="h-5 w-5 text-magenta-500" />}
              title="No WhatsApp knowledge yet"
              description="Once a connected chat sends something worth remembering, it'll show up here."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-150 shadow-xs">
              {chunks.map((c) => (
                <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-neutral-150 bg-neutral-50 text-neutral-400">
                    <ChatBubbleIcon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-xs font-medium text-neutral-500">{c.chatName || c.chatJid || 'WhatsApp'}</p>
                      {c.messageTimestamp && (
                        <p className="shrink-0 text-xs text-neutral-400">
                          {new Date(c.messageTimestamp).toLocaleString()}
                        </p>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-ink">{c.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
