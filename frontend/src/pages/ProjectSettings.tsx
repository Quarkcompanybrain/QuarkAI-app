import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
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
import { useAuthStore } from '../store/authStore';

interface ProjectOutletContext {
  project: Project | null;
  refreshProject: () => void;
}

export function ProjectSettings() {
  const { projectId = '' } = useParams();
  const { project, refreshProject } = useOutletContext<ProjectOutletContext>();
  const navigate = useNavigate();

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-6">
      <div className="flex max-w-3xl flex-col gap-5">
        <ProjectDetailsForm projectId={projectId} project={project} onRenamed={refreshProject} />
        <MembersSection projectId={projectId} />
        <WhatsAppSourcesSection projectId={projectId} />
        <EmailSourcesSection projectId={projectId} />
        <ProjectDeleteSection projectId={projectId} project={project} onDeleted={() => navigate('/personal/chat', { replace: true })} />
      </div>
    </div>
  );
}

function ProjectDeleteSection({ projectId, project, onDeleted }: { projectId: string; project: Project | null; onDeleted: () => void }) {
  const user = useAuthStore((state) => state.user);
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!project || user?.id !== project.createdBy) return null;

  const handleDelete = async () => {
    setError(null);
    setLoading(true);
    try {
      await projectsApi.delete(projectId);
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not delete this project.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-magenta-100">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">Delete project</h2>
          <p className="mt-1 text-sm text-neutral-500">Remove this project and hide its files, memory, chats, and sources.</p>
        </div>
        {step === 0 && <Button variant="ghost" onClick={() => setStep(1)} className="shrink-0 text-magenta-600 hover:bg-magenta-50">Delete project</Button>}
      </div>

      <AnimatePresence initial={false}>
        {step > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: 'auto', marginTop: 16 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            className="overflow-hidden"
          >
            {step === 1 ? (
              <div className="rounded-xl border border-magenta-100 bg-magenta-50 p-4">
                <p className="text-sm font-medium text-ink">You’re about to delete “{project.name}”.</p>
                <p className="mt-1 text-sm text-neutral-600">It will no longer appear for you or your team. Its chats, files, and saved knowledge will be hidden.</p>
                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setStep(0)}>Cancel</Button>
                  <Button variant="secondary" onClick={() => setStep(2)}>I understand</Button>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-magenta-200 bg-white p-4">
                <p className="text-sm font-medium text-ink">Delete “{project.name}”?</p>
                <label className="mt-3 flex flex-col gap-1.5 text-sm font-medium text-ink">
                  To make sure, type <span className="font-mono text-magenta-600">{project.name}</span> below
                  <input
                    autoFocus
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    className="rounded-lg border border-neutral-200 px-3 py-2 text-sm font-normal text-ink outline-none focus:border-magenta-500 focus:shadow-[0_0_0_3px_rgba(255,27,205,0.10)]"
                  />
                </label>
                <ErrorBanner message={error} />
                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => { setStep(0); setConfirmation(''); }}>Cancel</Button>
                  <Button variant="secondary" loading={loading} disabled={confirmation !== project.name} onClick={handleDelete}>Delete project</Button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
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
  const [description, setDescription] = useState(project?.description || '');
  const [websiteUrl, setWebsiteUrl] = useState(project?.websiteUrl || '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (project) {
      setName(project.name);
      setDescription(project.description || '');
      setWebsiteUrl(project.websiteUrl || '');
    }
  }, [project]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setLoading(true);
    try {
      await projectsApi.update(projectId, { name, description, websiteUrl });
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
      <form onSubmit={handleSave} className="flex flex-col gap-3">
        <div>
          <Input label="Project name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="What this project is for, its goals, and the information that belongs here…"
            className="w-full resize-y rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-ink shadow-xs outline-none transition-all placeholder:text-neutral-400 hover:border-neutral-300 focus:border-magenta-500 focus:shadow-[0_0_0_3px_rgba(255,27,205,0.10)]"
          />
          <span className="text-xs text-neutral-400">This helps Quark decide whether incoming files and WhatsApp messages belong in this project's memory.</span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">Website URL</span>
          <input
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="https://example.com"
            inputMode="url"
            className="w-full rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-ink shadow-xs outline-none transition-all placeholder:text-neutral-400 hover:border-neutral-300 focus:border-magenta-500 focus:shadow-[0_0_0_3px_rgba(255,27,205,0.10)]"
          />
          <span className="text-xs text-neutral-400">This is context for relevance decisions; Quark does not automatically crawl the URL.</span>
        </label>
        <div className="flex justify-end"><Button type="submit" loading={loading}>Save</Button></div>
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
  const [search, setSearch] = useState('');

  const refreshSources = () => projectsApi.listSources(projectId).then((r) => setSources(r.sources));

  useEffect(() => {
    setLoading(true);
    Promise.all([integrationsApi.list(), projectsApi.listSources(projectId)])
      .then(async ([integrationsRes, sourcesRes]) => {
        const connected = integrationsRes.integrations.filter((i) => i.type === 'whatsapp' && i.status === 'connected');
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
  const MAX_BROWSE_CHATS = 10;
  const sourceKey = (integrationId: string, jid: string) => `${integrationId}:${jid}`;
  const selectedKeys = new Set(sources.filter((s) => s.sourceType === 'whatsapp' && s.chatJid).map((s) => sourceKey(s.integrationId, s.chatJid as string)));
  const atLimit = sources.length >= MAX_SOURCES;

  const visibleChats = (integrationId: string, chats: WhatsAppChat[]) => {
    const query = search.trim().toLowerCase();
    const matches = query ? chats.filter((c) => (c.name || c.jid).toLowerCase().includes(query)) : chats;
    const active = matches.filter((chat) => selectedKeys.has(sourceKey(integrationId, chat.jid)));
    const available = matches.filter((chat) => !selectedKeys.has(sourceKey(integrationId, chat.jid)));

    // Active sources are always visible. Browsing is intentionally compact;
    // once the user searches, every matching unselected chat is shown.
    return { active, available: query ? available : available.slice(0, MAX_BROWSE_CHATS) };
  };

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
          {sources.length}/{MAX_SOURCES} sources used
        </span>
      </div>
      <p className="mb-4 text-sm text-neutral-500">
        Pick which of your connected chats and groups should feed this project's memory. A project can have up to{' '}
        {MAX_SOURCES} sources across WhatsApp and email.
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
          <input
            type="text"
            placeholder="Search chats and groups…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-neutral-200 bg-white px-3.5 py-2 text-sm text-ink shadow-xs outline-none transition-all duration-200 ease-smooth placeholder:text-neutral-400 hover:border-neutral-300 focus:border-magenta-500 focus:shadow-[0_0_0_3px_rgba(255,27,205,0.10)]"
          />
          {connectedIntegrations.map((integration) => {
            const allChats = chatsByIntegration[integration.id] || [];
            const { active, available } = visibleChats(integration.id, allChats);
            const visibleCount = active.length + available.length;
            return (
            <div key={integration.id}>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
                {integration.phoneNumber || 'WhatsApp'}
              </p>
              {allChats.length === 0 ? (
                <p className="text-sm text-neutral-500">No chats found on this account yet.</p>
              ) : visibleCount === 0 ? (
                <p className="text-sm text-neutral-500">No chats match "{search}".</p>
              ) : (
                <ul className="flex flex-col divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-150">
                  {active.map((chat) => (
                    <WhatsAppChatRow
                      key={chat.jid}
                      chat={chat}
                      checked
                      disabled={false}
                      onToggle={() => handleToggle(integration.id, chat)}
                    />
                  ))}
                  {active.length > 0 && available.length > 0 && (
                    <li className="bg-neutral-25 px-4 py-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
                      Other chats and groups
                    </li>
                  )}
                  {available.map((chat) => (
                    <WhatsAppChatRow
                      key={chat.jid}
                      chat={chat}
                      checked={false}
                      disabled={atLimit}
                      onToggle={() => handleToggle(integration.id, chat)}
                    />
                  ))}
                </ul>
              )}
            </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// A mailbox is linked whole: every new email in its inbox and sent folder is
// evaluated for this project. Members link their own mailboxes; a teammate's
// linked mailbox is shown but only its owner can link or unlink it here.
function EmailSourcesSection({ projectId }: { projectId: string }) {
  const user = useAuthStore((state) => state.user);
  const [mailboxes, setMailboxes] = useState<Integration[]>([]);
  const [sources, setSources] = useState<ProjectSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshSources = () => projectsApi.listSources(projectId).then((r) => setSources(r.sources));

  useEffect(() => {
    setLoading(true);
    Promise.all([integrationsApi.list(), projectsApi.listSources(projectId)])
      .then(([integrationsRes, sourcesRes]) => {
        setMailboxes(integrationsRes.integrations.filter((i) => i.type === 'email'));
        setSources(sourcesRes.sources);
      })
      .finally(() => setLoading(false));
  }, [projectId]);

  const MAX_SOURCES = 10;
  const emailSources = sources.filter((s) => s.sourceType === 'email');
  const myMailboxIds = new Set(mailboxes.map((m) => m.id));
  const teammateSources = emailSources.filter((s) => !myMailboxIds.has(s.integrationId) && s.addedBy !== user?.id);
  const atLimit = sources.length >= MAX_SOURCES;

  const handleToggle = async (mailbox: Integration) => {
    setError(null);
    setBusyId(mailbox.id);
    try {
      const existing = emailSources.find((s) => s.integrationId === mailbox.id);
      if (existing) await projectsApi.removeSource(projectId, existing.id);
      else await projectsApi.addSource(projectId, mailbox.id);
      await refreshSources();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Something went wrong.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <h2 className="mb-1 font-display text-lg font-semibold text-ink">Email sources</h2>
      <p className="mb-4 text-sm text-neutral-500">
        Link a mailbox to have new emails it sends and receives evaluated for this project's memory. If one mailbox
        covers several projects, link it to each — every project keeps only what's relevant to it.
      </p>

      <ErrorBanner message={error} />

      {loading ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : (
        <div className="flex flex-col gap-4">
          {mailboxes.length === 0 ? (
            <p className="text-sm text-neutral-500">
              You haven't connected a mailbox yet.{' '}
              <Link to="/integrations" className="font-medium text-magenta-600 hover:underline">
                Connect one
              </Link>{' '}
              to link it here.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-150">
              {mailboxes.map((mailbox) => {
                const linked = emailSources.some((s) => s.integrationId === mailbox.id);
                const failed = mailbox.status !== 'connected';
                return (
                  <li key={mailbox.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{mailbox.emailAddress}</p>
                      <p className={`text-xs ${failed ? 'text-magenta-600' : 'text-neutral-500'}`}>
                        {failed ? 'Sign-in failed — reconnect it on the Integrations page' : 'Inbox and sent mail'}
                      </p>
                    </div>
                    <ToggleSwitch
                      checked={linked}
                      disabled={busyId === mailbox.id || (!linked && (atLimit || failed))}
                      onToggle={() => handleToggle(mailbox)}
                    />
                  </li>
                );
              })}
            </ul>
          )}

          {teammateSources.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">Linked by teammates</p>
              <ul className="flex flex-col divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-150">
                {teammateSources.map((source) => (
                  <li key={source.id} className="px-4 py-3 text-sm text-ink">
                    {source.chatName}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function ToggleSwitch({ checked, disabled, onToggle }: { checked: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onToggle}
      className={`relative h-6 w-10 shrink-0 rounded-full p-0.5 transition-colors focus-visible:ring-1 focus-visible:ring-magenta-300 focus-visible:ring-offset-1 ${
        checked ? 'bg-magenta-500' : 'bg-neutral-200'
      } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
    >
      <span
        className={`block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`}
      />
    </button>
  );
}

function WhatsAppChatRow({
  chat,
  checked,
  disabled,
  onToggle,
}: {
  chat: WhatsAppChat;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="flex items-center justify-between px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink">{chat.name || chat.jid}</p>
        <p className="text-xs text-neutral-500">{chat.isGroup ? 'Group' : 'Individual chat'}</p>
      </div>
      <ToggleSwitch checked={checked} disabled={disabled} onToggle={onToggle} />
    </li>
  );
}
