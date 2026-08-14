import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FilesPanel } from '../features/files/FilesPanel';
import { projectsApi } from '../features/projects/api';
import { ChatBubbleIcon } from '../components/icons';
import type { ProjectSource } from '../types';

export function ProjectMemory() {
  const { projectId = '' } = useParams();
  const [sources, setSources] = useState<ProjectSource[]>([]);

  useEffect(() => {
    projectsApi.listSources(projectId).then((r) => setSources(r.sources));
  }, [projectId]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-6">
      <div className="flex flex-col gap-8">
        <FilesPanel projectId={projectId} />

        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold text-ink">WhatsApp sources</h2>
            <Link
              to={`/projects/${projectId}/settings`}
              className="text-xs font-medium text-magenta-600 hover:text-magenta-700"
            >
              Manage in Settings
            </Link>
          </div>

          {sources.length === 0 ? (
            <p className="text-sm text-neutral-500">
              No chats connected yet. Add some from{' '}
              <Link to={`/projects/${projectId}/settings`} className="font-medium text-magenta-600 hover:underline">
                Settings
              </Link>{' '}
              to start pulling relevant messages into this project's memory.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-150 shadow-xs">
              {sources.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-neutral-150 bg-neutral-50 text-neutral-400">
                    <ChatBubbleIcon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{s.chatName || s.chatJid}</p>
                    <p className="text-xs text-neutral-500">{s.isGroup ? 'Group' : 'Individual chat'}</p>
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
