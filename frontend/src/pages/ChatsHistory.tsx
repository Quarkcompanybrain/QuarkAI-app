import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { chatApi } from '../features/chat/api';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { ChatBubbleIcon, PencilIcon, PlusIcon } from '../components/icons';
import type { ChatScope, ChatSessionSummary } from '../types';

type FilterValue = 'all' | 'personal' | string; // string = projectId

export function ChatsHistory() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [filter, setFilter] = useState<FilterValue>('all');

  const refresh = () => chatApi.listSessions().then((r) => setSessions(r.sessions));

  useEffect(() => {
    refresh();
  }, []);

  const projectOptions = useMemo(() => {
    const seen = new Map<string, string>();
    sessions.forEach((s) => {
      if (s.projectId && s.projectName) seen.set(s.projectId, s.projectName);
    });
    return Array.from(seen.entries());
  }, [sessions]);

  const filtered = sessions.filter((s) => {
    if (filter === 'all') return true;
    if (filter === 'personal') return s.scope === 'personal';
    return s.projectId === filter;
  });

  const openSession = (session: ChatSessionSummary) => {
    const path =
      session.scope === 'personal' ? '/personal/chat' : `/projects/${session.projectId}/chat`;
    navigate(`${path}?session=${session.id}`);
  };

  const handleRename = async (sessionId: string, title: string) => {
    await chatApi.renameSession(sessionId, title);
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, title } : s)));
  };

  const handleNewChat = async () => {
    if (filter === 'all') return;
    const scope: ChatScope = filter === 'personal' ? 'personal' : 'project';
    const projectId = filter === 'personal' ? undefined : filter;
    const res = await chatApi.createSession(scope, projectId);
    const path = scope === 'personal' ? '/personal/chat' : `/projects/${projectId}/chat`;
    navigate(`${path}?session=${res.session.id}`);
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-1 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Chats</h1>
          <p className="text-sm text-neutral-500">Every conversation across personal and project spaces.</p>
        </div>
        <Button
          onClick={handleNewChat}
          disabled={filter === 'all'}
          title={filter === 'all' ? 'Pick Personal or a project first' : undefined}
          className="gap-1.5"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          New chat
        </Button>
      </div>

      <div className="mb-6 mt-5 flex flex-wrap gap-2">
        <FilterChip label="All" active={filter === 'all'} onClick={() => setFilter('all')} />
        <FilterChip label="Personal" active={filter === 'personal'} onClick={() => setFilter('personal')} />
        {projectOptions.map(([id, name]) => (
          <FilterChip key={id} label={name} active={filter === id} onClick={() => setFilter(id)} />
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<ChatBubbleIcon className="h-5 w-5 text-magenta-500" />}
          title="No chats yet"
          description="Start a conversation from Personal or any project, and it'll show up here."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-150 shadow-xs">
          {filtered.map((s, i) => (
            <motion.li
              key={s.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: Math.min(i * 0.03, 0.3) }}
            >
              <SessionRow session={s} onOpen={() => openSession(s)} onRename={(title) => handleRename(s.id, title)} />
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SessionRow({
  session,
  onOpen,
  onRename,
}: {
  session: ChatSessionSummary;
  onOpen: () => void;
  onRename: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEditing = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(session.title);
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.select());
  };

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== session.title) onRename(trimmed);
  };

  return (
    <div
      role="button"
      onClick={editing ? undefined : onOpen}
      className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-neutral-25"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-neutral-150 bg-neutral-50 text-neutral-400">
        <ChatBubbleIcon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            ref={inputRef}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="w-full rounded-md border border-magenta-500 bg-white px-1.5 py-0.5 text-sm text-ink outline-none"
          />
        ) : (
          <p className="truncate text-sm font-medium text-ink">{session.title}</p>
        )}
        <p className="text-xs text-neutral-500">{new Date(session.updatedAt).toLocaleString()}</p>
      </div>
      {!editing && (
        <button
          onClick={startEditing}
          aria-label="Rename chat"
          className="shrink-0 rounded-md p-1.5 text-neutral-400 opacity-70 transition-opacity hover:bg-neutral-100 hover:text-magenta-500 focus:opacity-100 group-hover:opacity-100"
        >
          <PencilIcon className="h-3.5 w-3.5" />
        </button>
      )}
      <ScopeTag scope={session.scope} projectName={session.projectName} />
    </div>
  );
}

function ScopeTag({ scope, projectName }: { scope: ChatScope; projectName: string | null }) {
  const label = scope === 'personal' ? 'Personal' : projectName || 'Project';
  return (
    <span className="ml-1 shrink-0 rounded-full bg-magenta-50 px-2.5 py-1 text-xs font-medium text-magenta-600">
      {label}
    </span>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`relative rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-150 ${
        active ? 'text-white' : 'text-neutral-600 hover:bg-neutral-100'
      }`}
    >
      {active && (
        <motion.span
          layoutId="chat-filter-pill"
          className="absolute inset-0 rounded-full bg-ink"
          transition={{ type: 'spring', stiffness: 500, damping: 40 }}
        />
      )}
      <span className="relative">{label}</span>
    </button>
  );
}
