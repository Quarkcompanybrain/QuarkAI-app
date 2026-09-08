import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '../features/auth/api';
import { useAuthStore } from '../store/authStore';
import { Input } from '../components/Input';
import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { AuthShell } from '../components/AuthShell';
import { ApiRequestError } from '../lib/api';

export function Login() {
  const navigate = useNavigate();
  const { setSession, setActiveOrg } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await authApi.login({ email, password });
      setSession({ token: res.token, user: res.user });
      if (res.activeOrg) setActiveOrg(res.activeOrg);
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <h1 className="mb-1 text-center font-display text-xl font-semibold text-ink">Welcome back</h1>
      <p className="mb-6 text-center text-sm text-neutral-500">Log in to your company brain.</p>

      <form onSubmit={handleSubmit} autoComplete="on" className="flex flex-col gap-4">
        <Input label="Email" type="email" name="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Input
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <ErrorBanner message={error} />
        <div className="-mt-1 flex justify-end">
          <Link to="/forgot-password" className="text-xs font-medium text-neutral-500 transition-colors hover:text-magenta-500">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" loading={loading} className="w-full">
          Log in
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-neutral-500">
        New here?{' '}
        <Link to="/signup" className="font-medium text-magenta-500 transition-colors hover:text-magenta-600">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}
