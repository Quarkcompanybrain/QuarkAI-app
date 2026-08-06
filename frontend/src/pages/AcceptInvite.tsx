import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { orgApi } from '../features/org/api';
import { useAuthStore } from '../store/authStore';
import { Input } from '../components/Input';
import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { AuthShell } from '../components/AuthShell';
import { PulseNode } from '../components/PulseNode';
import { ApiRequestError } from '../lib/api';

export function AcceptInvite() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { setSession, setActiveOrg } = useAuthStore();

  const [invite, setInvite] = useState<{ email: string; orgName: string; requiresPassword: boolean } | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    orgApi
      .getInvite(token)
      .then(setInvite)
      .catch((err) => setError(err instanceof ApiRequestError ? err.message : 'Invite not found.'));
  }, [token]);

  const handleAccept = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await orgApi.acceptInvite(token, invite?.requiresPassword ? { name, password } : {});
      setSession({ token: res.token });
      setActiveOrg(res.activeOrg);
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      {!invite && !error && (
        <div className="flex flex-col items-center gap-3 py-4">
          <PulseNode size={10} />
          <p className="text-sm text-neutral-500">Loading your invite…</p>
        </div>
      )}

      {invite && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
          <h1 className="mb-1 text-center font-display text-xl font-semibold text-ink">
            Join <span className="gradient-text">{invite.orgName}</span>
          </h1>
          <p className="mb-6 text-center text-sm text-neutral-500">Invited as {invite.email}</p>
          <form onSubmit={handleAccept} className="flex flex-col gap-4">
            {invite.requiresPassword && (
              <>
                <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
                <Input
                  label="Password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </>
            )}
            <ErrorBanner message={error} />
            <Button type="submit" loading={loading} className="mt-1 w-full">
              Accept invite
            </Button>
          </form>
        </motion.div>
      )}

      <ErrorBanner message={!invite ? error : null} />
    </AuthShell>
  );
}
