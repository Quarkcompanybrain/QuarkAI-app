import { useCallback, useState } from 'react';
import { useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { FilesPanel } from '../features/files/FilesPanel';
import type { FileCounts } from '../features/files/api';
import { projectsApi, type MemoryCounts, type MemorySource, type WhatsAppMemoryChunk } from '../features/projects/api';
import { PulseNode } from '../components/PulseNode';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { ListFooter } from '../components/ListFooter';
import { ListToolbar, type FilterChip } from '../components/ListToolbar';
import { BrainIcon, ChatBubbleIcon, FileTextIcon, MailIcon, PencilIcon, TrashIcon, WebhookIcon } from '../components/icons';
import { usePagedList, useDebounced } from '../hooks/usePagedList';
import { dayLabel, groupByDay, timeLabel } from '../lib/listQuery';
import type { Project } from '../types';

interface ProjectOutletContext {
  project: Project | null;
}

type MemoryTab = 'knowledge' | 'files';

const SOURCE_LABEL: Record<MemorySource, string> = { whatsapp: 'WhatsApp', email: 'Email', cheerio: 'Cheerio' };

function SourceIcon({ source, className }: { source: MemorySource; className: string }) {
  if (source === 'email') return <MailIcon className={className} />;
  if (source === 'cheerio') return <WebhookIcon className={className} />;
  return <ChatBubbleIcon className={className} />;
}

export function ProjectMemory() {
  const { projectId = '' } = useParams();
  const { project } = useOutletContext<ProjectOutletContext>();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: MemoryTab = searchParams.get('tab') === 'files' ? 'files' : 'knowledge';
  const [knowledgeTotal, setKnowledgeTotal] = useState<number | null>(null);
  const [fileTotal, setFileTotal] = useState<number | null>(null);

  const setTab = (next: MemoryTab) => setSearchParams(next === 'files' ? { tab: 'files' } : {}, { replace: true });
  const onFileCounts = useCallback((counts: FileCounts) => setFileTotal(counts.upload + counts.whatsapp + counts.email), []);
  const onKnowledgeCounts = useCallback((counts: MemoryCounts) => setKnowledgeTotal(counts.whatsapp + counts.email + counts.cheerio), []);

  const tabs: { id: MemoryTab; label: string; count: number | null; icon: typeof BrainIcon }[] = [
    { id: 'knowledge', label: 'Knowledge', count: knowledgeTotal, icon: BrainIcon },
    { id: 'files', label: 'Files', count: fileTotal, icon: FileTextIcon },
  ];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">Memory</h2>
            <p className="mt-0.5 text-sm text-neutral-500">What Quark has learned for this project, and the files it learned from.</p>
          </div>
          <div className="flex rounded-lg border border-neutral-200 bg-neutral-50 p-0.5" role="tablist" aria-label="Memory sections">
            {tabs.map((item) => (
              <button
                key={item.id}
                role="tab"
                aria-selected={tab === item.id}
                onClick={() => setTab(item.id)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  tab === item.id ? 'bg-white text-ink shadow-xs' : 'text-neutral-500 hover:text-ink'
                }`}
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
                {item.count !== null && <span className="text-xs text-neutral-400">{item.count}</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Both stay mounted so switching tabs keeps search, filters and loaded pages. */}
        <div hidden={tab !== 'knowledge'}>
          <KnowledgeList projectId={projectId} canManage={Boolean(project?.canManageMemory)} onCounts={onKnowledgeCounts} />
        </div>
        <div hidden={tab !== 'files'}>
          <FilesPanel projectId={projectId} canManageChunks={Boolean(project?.canManageMemory)} showHeading={false} onCounts={onFileCounts} />
        </div>
      </div>
    </div>
  );
}

function KnowledgeList({ projectId, canManage, onCounts }: { projectId: string; canManage: boolean; onCounts: (counts: MemoryCounts) => void }) {
  const [search, setSearch] = useState('');
  const [source, setSource] = useState<MemorySource | null>(null);
  const query = useDebounced(search.trim());
  const [actionError, setActionError] = useState<string | null>(null);

  const { items: chunks, setItems: setChunks, hasMore, counts, setCounts, loadMore, loadingMore, error } = usePagedList<WhatsAppMemoryChunk, MemoryCounts>(
    async (before, limit) => {
      const res = await projectsApi.listWhatsAppMemory(projectId, { source, q: query, before, limit });
      if (res.counts) onCounts(res.counts);
      return { items: res.chunks, hasMore: res.hasMore, counts: res.counts };
    },
    `${projectId}|${source}|${query}`
  );

  const total = counts ? counts.whatsapp + counts.email + counts.cheerio : null;
  const filtering = Boolean(query || source);
  const chips: FilterChip<MemorySource>[] = counts
    ? [
        { value: null, label: 'All', count: total ?? undefined },
        ...(['whatsapp', 'email', 'cheerio'] as const)
          .filter((value) => counts[value] > 0)
          .map((value) => ({ value, label: SOURCE_LABEL[value], count: counts[value], icon: <SourceIcon source={value} className="h-3 w-3" /> })),
      ]
    : [];

  const removeLocally = (chunk: WhatsAppMemoryChunk) => {
    setChunks((current) => current?.filter((item) => item.id !== chunk.id) || null);
    if (counts) {
      const next = { ...counts, [chunk.sourceType]: Math.max(0, counts[chunk.sourceType] - 1) };
      setCounts(next);
      onCounts(next);
    }
  };

  if (total === 0 && !filtering) {
    return (
      <EmptyState
        icon={<ChatBubbleIcon className="h-5 w-5 text-magenta-500" />}
        title="No knowledge yet"
        description="Once a linked WhatsApp chat, mailbox or Cheerio connection receives something worth remembering, it'll show up here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ListToolbar search={search} onSearch={setSearch} placeholder="Search knowledge, chats, senders" chips={chips} active={source} onSelect={setSource} />
      <ErrorBanner message={actionError || error} />

      {chunks === null ? (
        <p className="flex items-center gap-2 text-sm text-neutral-500">
          <PulseNode size={6} /> Loading…
        </p>
      ) : chunks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-200 px-4 py-8 text-center text-sm text-neutral-500">
          Nothing matches{query ? ` “${query}”` : ' this filter'}.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-5">
            {groupByDay(chunks, (chunk) => new Date(chunk.createdAt)).map((group) => (
              <section key={group.label}>
                <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">{group.label}</h3>
                <ul className="flex flex-col divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-150 bg-white shadow-xs">
                  {group.items.map((chunk) => (
                    <KnowledgeRow
                      key={chunk.id}
                      chunk={chunk}
                      projectId={projectId}
                      canManage={canManage}
                      onUpdated={(text) => setChunks((current) => current?.map((item) => (item.id === chunk.id ? { ...item, text } : item)) || null)}
                      onDeleted={() => removeLocally(chunk)}
                      onError={setActionError}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <ListFooter shown={chunks.length} total={filtering ? null : total} hasMore={hasMore} loading={loadingMore} onMore={loadMore} noun="entries" />
        </>
      )}
    </div>
  );
}

const CLAMP_CHARS = 240;

function KnowledgeRow({
  chunk,
  projectId,
  canManage,
  onUpdated,
  onDeleted,
  onError,
}: {
  chunk: WhatsAppMemoryChunk;
  projectId: string;
  canManage: boolean;
  onUpdated: (text: string) => void;
  onDeleted: () => void;
  onError: (message: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const long = chunk.text.length > CLAMP_CHARS;
  // Grouped by the day Quark learned it (the list order); the message's own time is shown when known.
  const when = new Date(chunk.messageTimestamp || chunk.createdAt);
  const sameDay = new Date(chunk.createdAt).toDateString() === when.toDateString();
  const title = chunk.chatName || chunk.chatJid || SOURCE_LABEL[chunk.sourceType];

  const save = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    onError(null);
    try {
      const result = await projectsApi.updateChunk(projectId, chunk.id, draft);
      onUpdated(result.chunk.text);
      setEditing(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not update this knowledge entry.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('Delete this saved knowledge entry?')) return;
    onError(null);
    try {
      await projectsApi.deleteChunk(projectId, chunk.id);
      onDeleted();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not delete this knowledge entry.');
    }
  };

  return (
    <li className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-neutral-25">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-neutral-150 bg-neutral-50 text-neutral-400">
        <SourceIcon source={chunk.sourceType} className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-1.5 text-xs">
          <span className="truncate font-medium text-neutral-600" title={title}>{title}</span>
          {chunk.sender && <span className="hidden truncate text-neutral-400 sm:inline">· {chunk.sender}</span>}
          <span className="ml-auto shrink-0 text-neutral-400" title={when.toLocaleString()}>
            {sameDay ? timeLabel(when) : `${dayLabel(when)}, ${timeLabel(when)}`}
          </span>
        </div>
        {editing ? (
          <div className="mt-2">
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={4} className="w-full resize-y rounded-lg border border-neutral-200 px-3 py-2 text-sm leading-6 text-ink outline-none focus:border-magenta-500 focus:shadow-[0_0_0_3px_rgba(255,27,205,0.10)]" />
            <div className="mt-2 flex justify-end gap-2">
              <button onClick={() => setEditing(false)} disabled={saving} className="rounded-md px-2 py-1 text-xs font-medium text-neutral-500 hover:bg-neutral-100">Cancel</button>
              <button onClick={save} disabled={saving || !draft.trim()} className="rounded-md bg-ink px-2.5 py-1 text-xs font-medium text-white hover:bg-neutral-700 disabled:bg-neutral-200">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        ) : (
          <p className="mt-1 whitespace-pre-line break-words text-sm leading-6 text-ink">
            {long && !expanded ? `${chunk.text.slice(0, CLAMP_CHARS).trimEnd()}…` : chunk.text}
            {long && (
              <button onClick={() => setExpanded(!expanded)} className="ml-1.5 text-xs font-medium text-magenta-600 hover:underline">
                {expanded ? 'Show less' : 'Show more'}
              </button>
            )}
          </p>
        )}
      </div>
      {canManage && !editing && (
        <div className="flex shrink-0 gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <button onClick={() => { setDraft(chunk.text); setEditing(true); onError(null); }} aria-label="Edit knowledge entry" className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-magenta-600"><PencilIcon className="h-3.5 w-3.5" /></button>
          <button onClick={remove} aria-label="Delete knowledge entry" className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-magenta-600"><TrashIcon className="h-3.5 w-3.5" /></button>
        </div>
      )}
    </li>
  );
}
