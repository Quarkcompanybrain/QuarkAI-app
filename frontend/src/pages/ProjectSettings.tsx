import { useEffect, useState, type FormEvent } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { projectsApi, type ProjectMember } from '../features/projects/api';
import { orgApi } from '../features/org/api';
import { integrationsApi } from '../features/integrations/api';
import { Input } from '../components/Input';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ErrorBanner } from '../components/ErrorBanner';
import { PlusIcon, TrashIcon } from '../components/icons';
import { ApiRequestError } from '../lib/api';
import type { Integration, Project, ProjectSource, WhatsAppChat } from '../types';

interface ProjectOutletContext {
  project: Project | null;
  refreshProject: () => void;
}

export function ProjectSettings() {
  const { projectId = '' } = useParams();
  const { project, refreshProject } = useOutletContext<ProjectOutletContext>();

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-6">
      <div className="mx-auto flex max-w-lg flex-col gap-6">
        <ProjectDetailsForm projectId={projectId} project={project} onRenamed={refreshProject} />
        <MembersSection projectId={projectId} />
        <WhatsAppSourcesSection projectId={projectId} />
      </div>
    </div>
  );
}

function ProjectDetailsForm({
  projectId,
  project,
  onRenamed,
}: {
  projectId: string;
  project: Project | null;
  onRenamed: () => void;
}) {
  const [name, setName] = useState(project?.name || '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (project) setName(project.name);
  }, [project]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setLoading(true);
    try {
      await projectsApi.update(projectId, name);
      onRenamed();
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <h2 className="mb-3 font-display text-lg font-semibold text-ink">Project details</h2>
      <form onSubmit={handleSave} className="flex items-end gap-2">
        <div className="flex-1">
          <Input label="Project name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <Button type="submit" loading={loading}>
          Save
        </Button>
      </form>
      <ErrorBanner message={error} />
      <AnimatePresence>
        {saved && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mt-2 text-sm text-magenta-600"
          >
            Saved.
          </motion.p>
        )}
      </AnimatePresence>
    </Card>
  );
}

function MembersSection({ projectId }: { projectId: string }) {
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [orgMembers, setOrgMembers] = useState<{ userId: string; email: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const refreshMembers = () => projectsApi.listMembers(projectId).then((r) => setMembers(r.members));

  useEffect(() => {
    refreshMembers();
    orgApi.listMembers().then((r) => setOrgMembers(r.members));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const handleAdd = async (userId: string) => {
    setError(null);
    try {
      await projectsApi.addMember(projectId, userId);
      refreshMembers();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Failed to add member.');
    }
  };

  const handleRemove = async (userId: string) => {
    setError(null);
    try {
      await projectsApi.removeMember(projectId, userId);
      refreshMembers();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Failed to remove member.');
    }
  };

  const memberIds = new Set(members.map((m) => m.userId));
  const addable = orgMembers.filter((m) => !memberIds.has(m.userId));

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-ink">Members</h2>
        <Button variant="ghost" onClick={() => setShowAdd((s) => !s)} className="gap-1.5">
          <PlusIcon className="h-3.5 w-3.5" />
          Add member
        </Button>
      </div>

      <ErrorBanner message={error} />

      <AnimatePresence initial={false}>
        {showAdd && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="mb-4 rounded-xl border border-neutral-150 bg-neutral-25 p-4">
              {addable.length === 0 ? (
                <p className="text-sm text-neutral-500">Everyone in the org is already on this project.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {addable.map((m) => (
                    <li key={m.userId} className="flex items-center justify-between text-sm">
                      <span className="text-ink">{m.email}</span>
                      <Button variant="secondary" onClick={() => handleAdd(m.userId)}>
                        Add
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ul className="flex flex-col divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-150">
        {members.map((m, i) => (
          <motion.li
            key={m.userId}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: Math.min(i * 0.03, 0.3) }}
            className="group flex items-center gap-3 px-4 py-3"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">
              {(m.name || m.email).trim().charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{m.name || m.email}</p>
              <p className="truncate text-xs text-neutral-500">{m.email}</p>
            </div>
            <button
              onClick={() => handleRemove(m.userId)}
              aria-label={`Remove ${m.email}`}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-400 opacity-70 transition-opacity duration-150 hover:text-magenta-500 focus-within:opacity-100 group-hover:opacity-100"
            >
              <TrashIcon className="h-3.5 w-3.5" />
            </button>
          </motion.li>
        ))}
      </ul>
    </Card>
  );
}

function WhatsAppSourcesSection({ projectId }: { projectId: string }) {
  const [connectedIntegrations, setConnectedIntegrations] = useState<Integration[]>([]);
  const [chatsByIntegration, setChatsByIntegration] = useState<Record<string, WhatsAppChat[]>>({});
  const [sources, setSources] = useState<ProjectSource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshSources = () => projectsApi.listSources(projectId).then((r) => setSources(r.sources));

  useEffect(() => {
    setLoading(true);
    Promise.all([integrationsApi.list(), projectsApi.listSources(projectId)])
      .then(async ([integrationsRes, sourcesRes]) => {
        const connected = integrationsRes.integrations.filter((i) => i.status === 'connected');
        setConnectedIntegrations(connected);
        setSources(sourcesRes.sources);

        const chatLists = await Promise.all(connected.map((i) => integrationsApi.listChats(i.id)));
        const byIntegration: Record<string, WhatsAppChat[]> = {};
        connected.forEach((integration, i) => {
          byIntegration[integration.id] = chatLists[i].chats;
        });
        setChatsByIntegration(byIntegration);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const MAX_SOURCES = 10;
  const sourceKey = (integrationId: string, jid: string) => `${integrationId}:${jid}`;
  const selectedKeys = new Set(sources.map((s) => sourceKey(s.integrationId, s.chatJid)));
  const atLimit = sources.length >= MAX_SOURCES;

  const handleToggle = async (integrationId: string, chat: WhatsAppChat) => {
    setError(null);
    const key = sourceKey(integrationId, chat.jid);
    try {
      if (selectedKeys.has(key)) {
        const existing = sources.find((s) => s.integrationId === integrationId && s.chatJid === chat.jid);
        if (existing) await projectsApi.removeSource(projectId, existing.id);
      } else {
        await projectsApi.addSource(projectId, integrationId, chat.jid);
      }
      refreshSources();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Something went wrong.');
    }
  };

  return (
    <Card>
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-ink">WhatsApp sources</h2>
        <span className={`text-xs font-medium ${atLimit ? 'text-magenta-600' : 'text-neutral-400'}`}>
          {sources.length}/{MAX_SOURCES} connected
        </span>
      </div>
      <p className="mb-4 text-sm text-neutral-500">
        Pick which of your connected chats and groups should feed this project's memory. Up to {MAX_SOURCES} per
        project.
      </p>

      <ErrorBanner message={error} />

      {loading ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : connectedIntegrations.length === 0 ? (
        <p className="text-sm text-neutral-500">
          No WhatsApp account connected yet.{' '}
          <Link to="/integrations" className="font-medium text-magenta-600 hover:underline">
            Connect one
          </Link>{' '}
          to start selecting chats.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {connectedIntegrations.map((integration) => (
            <div key={integration.id}>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
                {integration.phoneNumber || 'WhatsApp'}
              </p>
              {(chatsByIntegration[integration.id] || []).length === 0 ? (
                <p className="text-sm text-neutral-500">No chats found on this account yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-150">
                  {(chatsByIntegration[integration.id] || []).map((chat) => {
                    const checked = selectedKeys.has(sourceKey(integration.id, chat.jid));
                    const disabled = !checked && atLimit;
                    return (
                      <li key={chat.jid} className="flex items-center justify-between px-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink">{chat.name || chat.jid}</p>
                          <p className="text-xs text-neutral-500">{chat.isGroup ? 'Group' : 'Individual chat'}</p>
                        </div>
                        <button
                          role="switch"
                          aria-checked={checked}
                          disabled={disabled}
                          onClick={() => handleToggle(integration.id, chat)}
                          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                            checked ? 'bg-magenta-500' : 'bg-neutral-200'
                          } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
                        >
                          <span
                            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                              checked ? 'translate-x-[18px]' : 'translate-x-0.5'
                            }`}
                          />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
