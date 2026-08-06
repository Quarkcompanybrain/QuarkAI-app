import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { authApi } from '../features/auth/api';
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

export function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'email' | 'reset'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleRequestOtp = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await authApi.requestPasswordReset(email);
      setStep('reset');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await authApi.resetPassword({ email, code, newPassword });
      navigate('/login');
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
            <motion.div key="email" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.25 }}>
              <h1 className="mb-1 text-center font-display text-xl font-semibold text-ink">Reset your password</h1>
              <p className="mb-6 text-center text-sm text-neutral-500">We'll email you a code to reset it.</p>
              <form onSubmit={handleRequestOtp} className="flex flex-col gap-4">
                <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                <ErrorBanner message={error} />
                <Button type="submit" loading={loading} className="mt-1 w-full">
                  Send reset code
                </Button>
              </form>
            </motion.div>
          ) : (
            <motion.div key="reset" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.25 }}>
              <h1 className="mb-1 text-center font-display text-xl font-semibold text-ink">Check your email</h1>
              <p className="mb-6 text-center text-sm text-neutral-500">Enter the code sent to {email} and choose a new password.</p>
              <form onSubmit={handleReset} className="flex flex-col gap-4">
                <Input label="Reset code" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} required />
                <Input
                  label="New password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
                <ErrorBanner message={error} />
                <Button type="submit" loading={loading} className="mt-1 w-full">
                  Reset password
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
        Remembered it?{' '}
        <Link to="/login" className="font-medium text-magenta-500 transition-colors hover:text-magenta-600">
          Log in
        </Link>
      </p>
    </AuthShell>
  );
}
