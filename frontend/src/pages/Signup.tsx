import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { authApi } from '../features/auth/api';
import { useAuthStore } from '../store/authStore';
import { Input } from '../components/Input';
import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { AuthShell } from '../components/AuthShell';
import { ApiRequestError } from '../lib/api';

const stepVariants = {
  enter: { opacity: 0, x: 16 },
  center: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -16 },
};

export function Signup() {
  const navigate = useNavigate();
  const { setSession } = useAuthStore();
  const [step, setStep] = useState<'email' | 'verify'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleRequestOtp = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await authApi.requestSignupOtp(email);
      setStep('verify');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await authApi.verifySignupOtp({ email, code, name, password });
      setSession({ token: res.token, user: res.user });
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <div className="overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          {step === 'email' ? (
            <motion.div
              key="email"
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            >
              <h1 className="mb-1 text-center font-display text-xl font-semibold text-ink">Create your account</h1>
              <p className="mb-6 text-center text-sm text-neutral-500">We'll email you a verification code.</p>
              <form onSubmit={handleRequestOtp} className="flex flex-col gap-4">
                <Input label="Email" type="email" name="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                <ErrorBanner message={error} />
                <Button type="submit" loading={loading} className="mt-1 w-full">
                  Send code
                </Button>
              </form>
            </motion.div>
          ) : (
            <motion.div
              key="verify"
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            >
              <h1 className="mb-1 text-center font-display text-xl font-semibold text-ink">Check your email</h1>
              <p className="mb-6 text-center text-sm text-neutral-500">Enter the code sent to {email}.</p>
              <form onSubmit={handleVerify} className="flex flex-col gap-4">
                <Input
                  label="Verification code"
                  name="verificationCode"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
                <Input label="Name" name="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
                <Input
                  label="Password"
                  type="password"
                  name="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <ErrorBanner message={error} />
                <Button type="submit" loading={loading} className="mt-1 w-full">
                  Create account
                </Button>
              </form>
              <button
                type="button"
                onClick={() => setStep('email')}
                className="mt-3 w-full text-center text-xs font-medium text-neutral-400 transition-colors hover:text-neutral-600"
              >
                Use a different email
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <p className="mt-6 text-center text-sm text-neutral-500">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-magenta-500 transition-colors hover:text-magenta-600">
          Log in
        </Link>
      </p>
    </AuthShell>
  );
}
