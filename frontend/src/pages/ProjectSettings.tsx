import { useEffect, useState, type FormEvent } from 'react';
import { useOutletContext, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { projectsApi, type ProjectMember } from '../features/projects/api';
import { orgApi } from '../features/org/api';
import { Input } from '../components/Input';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ErrorBanner } from '../components/ErrorBanner';
import { PlusIcon, TrashIcon } from '../components/icons';
import { ApiRequestError } from '../lib/api';
import type { Project } from '../types';

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
