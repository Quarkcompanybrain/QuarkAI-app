import { useEffect, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { orgApi, type OrgMember, type PendingInvite } from '../features/org/api';
import { Input } from '../components/Input';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ErrorBanner } from '../components/ErrorBanner';
import { PulseNode } from '../components/PulseNode';
import { useAuthStore } from '../store/authStore';
import { ApiRequestError } from '../lib/api';

export function Members() {
  const { activeOrg } = useAuthStore();
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isAdmin = activeOrg?.role === 'admin';

  const refresh = () => {
    orgApi.listMembers().then((r) => setMembers(r.members));
    if (isAdmin) orgApi.listPendingInvites().then((r) => setPendingInvites(r.invites));
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInvite = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      await orgApi.invite(email);
      setMessage(`Invite sent to ${email}.`);
      setEmail('');
      refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-6">
      <h1 className="font-display text-2xl font-semibold text-ink">Members</h1>
      <p className="mt-1 text-sm text-neutral-500">People with access to this organization.</p>

      <div className="mt-6 flex max-w-3xl flex-col gap-5">
        {isAdmin && (
          <Card>
            <h2 className="mb-4 font-display text-lg font-semibold text-ink">Invite by email</h2>
            <form onSubmit={handleInvite} className="flex items-end gap-2">
              <div className="flex-1">
                <Input label="Email address" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <Button type="submit" loading={loading}>
                Send invite
              </Button>
            </form>
            <ErrorBanner message={error} />
            {message && <p className="mt-3 text-sm text-magenta-600">{message}</p>}
          </Card>
        )}

        <Card>
          <h2 className="mb-4 font-display text-lg font-semibold text-ink">Team ({members.length})</h2>
          <ul className="flex flex-col divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-150">
            {members.map((m, i) => (
              <motion.li
                key={m.userId}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: Math.min(i * 0.03, 0.3) }}
                className="flex items-center gap-3 px-4 py-3.5"
              >
                <Avatar name={m.name || m.email} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{m.name || m.email}</p>
                  <p className="truncate text-xs text-neutral-500">{m.email}</p>
                </div>
                <span className="shrink-0 rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium capitalize text-neutral-600">
                  {m.role}
                </span>
              </motion.li>
            ))}
          </ul>
        </Card>

        {isAdmin && pendingInvites.length > 0 && (
          <Card>
            <h2 className="mb-4 font-display text-lg font-semibold text-ink">Pending invites ({pendingInvites.length})</h2>
            <ul className="flex flex-col divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-150">
              {pendingInvites.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-3.5">
                  <p className="truncate text-sm text-ink">{i.email}</p>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-neutral-500">
                    {!i.expired && <PulseNode size={6} />}
                    {i.expired ? 'Expired' : 'Awaiting response'}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name.trim().charAt(0).toUpperCase();
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">
      {initials}
    </div>
  );
}
