import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { NeuralBackdrop } from './NeuralBackdrop';
import { Logo } from './Logo';

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-white px-4">
      <NeuralBackdrop />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-sm"
      >
        <div className="mb-7 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-2xl border border-neutral-150 bg-white/90 p-7 shadow-lg backdrop-blur-sm">
          {children}
        </div>
      </motion.div>
    </div>
  );
}
