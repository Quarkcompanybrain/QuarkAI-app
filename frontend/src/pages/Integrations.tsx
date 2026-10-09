import { useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { integrationsApi, streamIntegrationStatus } from '../features/integrations/api';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { ErrorBanner } from '../components/ErrorBanner';
import { ApiRequestError } from '../lib/api';
import { PulseNode } from '../components/PulseNode';
import { InfoIcon, MailIcon, PlugIcon } from '../components/icons';
import { FaWhatsapp } from 'react-icons/fa';
import type { Integration } from '../types';

function InfoTooltip({ children }: { children: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        className="flex h-5 w-5 items-center justify-center rounded-full text-neutral-400 transition-colors hover:text-magenta-500"
        aria-label="More information"
      >
        <InfoIcon className="h-4 w-4" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.12 }}
            className="absolute left-1/2 top-full z-10 mt-2 w-64 -translate-x-1/2 rounded-xl border border-neutral-150 bg-white p-3 shadow-lg"
          >
            <div className="flex items-start gap-2">
              <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400" />
              <p className="text-xs leading-relaxed text-neutral-500">{children}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Integrations() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  const refresh = () => integrationsApi.list().then((r) => setIntegrations(r.integrations));
  const whatsappIntegrations = integrations.filter((i) => i.type === 'whatsapp');
  const emailIntegrations = integrations.filter((i) => i.type === 'email');

  useEffect(() => {
    refresh();
  }, []);

  const handleConnect = async () => {
    setConnectError(null);
    setConnecting(true);
    setQrDataUrl(null);
    try {
      const res = await integrationsApi.connectWhatsapp();
      await streamIntegrationStatus(res.integration.id, {
        onQr: (dataUrl) => setQrDataUrl(dataUrl),
        onConnected: () => {
          setConnecting(false);
          setQrDataUrl(null);
          refresh();
        },
        onDisconnected: () => {
          setConnecting(false);
          setQrDataUrl(null);
        },
      });
    } catch {
      setConnectError('Could not start the connection. Try again.');
      setConnecting(false);
    }
  };

  const handleDisconnect = async (id: string) => {
    await integrationsApi.disconnect(id);
    refresh();
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-6">
      <h1 className="font-display text-2xl font-semibold text-ink">Integrations</h1>
      <p className="mt-1 text-sm text-neutral-500">Connect external sources so Quark AI can learn from them.</p>

      <div className="mt-6 grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-magenta-50 text-magenta-600">
                <FaWhatsapp className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="flex items-center gap-1.5">
                <h2 className="font-display text-base font-semibold text-ink">WhatsApp</h2>
                <InfoTooltip>
                  This connects using Baileys, an open-source WhatsApp Web library — not WhatsApp's official
                  Business API. It's widely used and generally reliable, but as with any unofficial client there's
                  a small chance of the number being rate limited. If you'd rather play it safe, connecting a
                  secondary number works just as well.
                </InfoTooltip>
              </div>
            </div>
          </div>

          <p className="mt-3 text-sm text-neutral-500">Learn from your groups and chats in real time.</p>

          {whatsappIntegrations.length === 0 && (
            <Button onClick={handleConnect} loading={connecting} className="mt-4 w-full gap-1.5">
              <PlugIcon className="h-3.5 w-3.5" />
              Connect account
            </Button>
          )}

          {connectError && <p className="mt-3 text-sm text-magenta-600">{connectError}</p>}

          <AnimatePresence>
            {connecting && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-4 flex flex-col items-center gap-3 rounded-xl border border-neutral-150 bg-neutral-25 p-6">
                  {qrDataUrl ? (
                    <>
                      <img src={qrDataUrl} alt="WhatsApp QR code" className="h-48 w-48 rounded-lg border border-neutral-150" />
                      <p className="flex items-center gap-1.5 text-xs text-neutral-500">
                        <PulseNode size={6} /> Open WhatsApp on your phone → Linked devices → scan this code
                      </p>
                    </>
                  ) : (
                    <p className="flex items-center gap-1.5 text-xs text-neutral-500">
                      <PulseNode size={6} /> Generating QR code…
                    </p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {whatsappIntegrations.length > 0 && (
            <ul className="mt-4 flex flex-col divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-150">
              {whatsappIntegrations.map((i) => (
                <li key={i.id} className="flex items-center justify-between px-4 py-3.5">
                  <div>
                    <p className="text-sm font-medium text-ink">{i.phoneNumber || 'Connecting…'}</p>
                    <p className="text-xs capitalize text-neutral-500">{i.status}</p>
                  </div>
                  <button
                    onClick={() => handleDisconnect(i.id)}
                    className="text-xs font-medium text-neutral-500 transition-colors hover:text-magenta-500"
                  >
                    Disconnect
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <EmailCard mailboxes={emailIntegrations} onChanged={refresh} onDisconnect={handleDisconnect} />
      </div>
    </div>
  );
}

const MAX_MAILBOXES = 5;

function EmailCard({
  mailboxes,
  onChanged,
  onDisconnect,
}: {
  mailboxes: Integration[];
  onChanged: () => void;
  onDisconnect: (id: string) => Promise<void>;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('993');
  const [username, setUsername] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setEmail('');
    setPassword('');
    setHost('');
    setPort('993');
    setUsername('');
    setShowAdvanced(false);
    setError(null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await integrationsApi.connectEmail({
        email: email.trim(),
        password,
        ...(host.trim() ? { host: host.trim(), port: Number(port) || 993 } : {}),
        ...(username.trim() ? { username: username.trim() } : {}),
      });
      resetForm();
      setFormOpen(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not connect this mailbox. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-magenta-50 text-magenta-600">
          <MailIcon className="h-5 w-5" />
        </div>
        <div className="flex items-center gap-1.5">
          <h2 className="font-display text-base font-semibold text-ink">Email</h2>
          <InfoTooltip>
            Connects over IMAP and only reads mail; nothing is sent or marked as read. For Gmail and Google Workspace,
            turn on 2-Step Verification and create an app password. Outlook and Microsoft 365 aren't supported yet.
          </InfoTooltip>
        </div>
      </div>

      <p className="mt-3 text-sm text-neutral-500">
        Learn from new mail in your inbox and sent folder. Connect up to {MAX_MAILBOXES} mailboxes, then choose which
        projects each one feeds in project settings.
      </p>

      {mailboxes.length > 0 && (
        <ul className="mt-4 flex flex-col divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-150">
          {mailboxes.map((mailbox) => (
            <li key={mailbox.id} className="flex items-center justify-between gap-3 px-4 py-3.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{mailbox.emailAddress}</p>
                <p className={`text-xs ${mailbox.status === 'failed' ? 'text-magenta-600' : 'text-neutral-500'}`}>
                  {mailbox.status === 'failed'
                    ? mailbox.lastError || 'Sign-in failed. Disconnect and connect again.'
                    : mailbox.lastSyncedAt
                      ? `Checked ${new Date(mailbox.lastSyncedAt).toLocaleString()}`
                      : 'Connected'}
                </p>
              </div>
              <button
                onClick={() => onDisconnect(mailbox.id)}
                className="shrink-0 text-xs font-medium text-neutral-500 transition-colors hover:text-magenta-500"
              >
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}

      {formOpen ? (
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3 rounded-xl border border-neutral-150 bg-neutral-25 p-4">
          <ErrorBanner message={error} />
          <Input label="Email address" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" required />
          <Input
            label="App password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
          <p className="-mt-1 text-xs text-neutral-500">
            Gmail:{' '}
            <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="font-medium text-magenta-600 hover:underline">
              create an app password
            </a>
            . Other providers: your mailbox password, or an app password if 2-step sign-in is on.
          </p>
          <button
            type="button"
            onClick={() => setShowAdvanced((open) => !open)}
            className="self-start text-xs font-medium text-neutral-500 hover:text-magenta-600"
          >
            {showAdvanced ? 'Hide advanced settings' : 'Advanced settings'}
          </button>
          {showAdvanced && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-neutral-500">Only needed if we can't detect your provider's IMAP server.</p>
              <div className="grid grid-cols-[1fr_88px] gap-3">
                <Input label="IMAP server" placeholder="imap.example.com" value={host} onChange={(e) => setHost(e.target.value)} autoComplete="off" />
                <Input label="Port" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} autoComplete="off" />
              </div>
              <Input label="Username (if not the email address)" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
            </div>
          )}
          <div className="flex gap-2">
            <Button type="submit" loading={submitting} className="flex-1">
              Connect mailbox
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                resetForm();
                setFormOpen(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : mailboxes.length >= MAX_MAILBOXES ? (
        <p className="mt-4 text-xs text-neutral-500">
          {MAX_MAILBOXES} of {MAX_MAILBOXES} mailboxes connected. Disconnect one to add another.
        </p>
      ) : (
        <Button onClick={() => setFormOpen(true)} className="mt-4 w-full gap-1.5">
          <PlugIcon className="h-3.5 w-3.5" />
          {mailboxes.length ? 'Connect another mailbox' : 'Connect mailbox'}
        </Button>
      )}
    </Card>
  );
}
