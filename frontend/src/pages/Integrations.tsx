import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { integrationsApi, streamIntegrationStatus } from '../features/integrations/api';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { PulseNode } from '../components/PulseNode';
import { AlertTriangleIcon, PlugIcon } from '../components/icons';
import type { Integration } from '../types';

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

      <div className="mt-6 flex items-start gap-3 rounded-xl border border-magenta-100 bg-magenta-50 px-4 py-3.5">
        <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-magenta-600" />
        <p className="text-xs leading-relaxed text-magenta-700">
          WhatsApp integration uses an unofficial connection method (not the official WhatsApp Business API). This is
          against WhatsApp's Terms of Service and carries a real risk of the connected number being flagged, rate
          limited, or banned — this has happened to real accounts. We recommend connecting a spare/secondary number
          rather than your primary line.
        </p>
      </div>

      <div className="mt-8 flex flex-col gap-6">
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold text-ink">WhatsApp</h2>
            <Button onClick={handleConnect} loading={connecting} className="gap-1.5">
              <PlugIcon className="h-3.5 w-3.5" />
              Connect account
            </Button>
          </div>

          {connectError && <p className="mb-3 text-sm text-magenta-600">{connectError}</p>}

          <AnimatePresence>
            {connecting && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-4 overflow-hidden"
              >
                <div className="flex flex-col items-center gap-3 rounded-xl border border-neutral-150 bg-neutral-25 p-6">
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

          {integrations.length === 0 ? (
            <p className="text-sm text-neutral-500">No WhatsApp accounts connected yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-150">
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
          <h2 className="font-display text-lg font-semibold text-ink">Email</h2>
          <p className="mt-1 text-sm text-neutral-500">Coming soon.</p>
        </Card>
      </div>
    </div>
  );
}
