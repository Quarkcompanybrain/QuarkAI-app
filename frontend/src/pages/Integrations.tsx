import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { integrationsApi, streamIntegrationStatus } from '../features/integrations/api';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { PulseNode } from '../components/PulseNode';
import { AlertTriangleIcon, InfoIcon, MailIcon, MessageCircleIcon, PlugIcon } from '../components/icons';
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
            className="absolute left-1/2 top-full z-10 mt-2 w-64 -translate-x-1/2 rounded-xl border border-magenta-100 bg-white p-3 shadow-lg"
          >
            <div className="flex items-start gap-2">
              <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-magenta-600" />
              <p className="text-xs leading-relaxed text-magenta-700">{children}</p>
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
    <div className="mx-auto h-full max-w-2xl overflow-y-auto p-8">
      <h1 className="font-display text-2xl font-semibold text-ink">Integrations</h1>
      <p className="mt-1 text-sm text-neutral-500">Connect external sources so Quark AI can learn from them.</p>

      <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-magenta-50 text-magenta-600">
                <MessageCircleIcon className="h-5 w-5" />
              </div>
              <div className="flex items-center gap-1.5">
                <h2 className="font-display text-base font-semibold text-ink">WhatsApp</h2>
                <InfoTooltip>
                  WhatsApp integration uses an unofficial connection method (not the official WhatsApp Business API).
                  This is against WhatsApp's Terms of Service and carries a real risk of the connected number being
                  flagged, rate limited, or banned — this has happened to real accounts. We recommend connecting a
                  spare/secondary number rather than your primary line.
                </InfoTooltip>
              </div>
            </div>
          </div>

          <p className="mt-3 text-sm text-neutral-500">Learn from your groups and chats in real time.</p>

          <Button onClick={handleConnect} loading={connecting} className="mt-4 w-full gap-1.5">
            <PlugIcon className="h-3.5 w-3.5" />
            Connect account
          </Button>

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

          {integrations.length > 0 && (
            <ul className="mt-4 flex flex-col divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-150">
              {integrations.map((i) => (
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

        <Card className="opacity-60">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-100 text-neutral-500">
              <MailIcon className="h-5 w-5" />
            </div>
            <h2 className="font-display text-base font-semibold text-ink">Email</h2>
          </div>
          <p className="mt-3 text-sm text-neutral-500">Coming soon.</p>
        </Card>
      </div>
    </div>
  );
}
