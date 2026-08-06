import { AnimatePresence, motion } from 'framer-motion';

export function ErrorBanner({ message }: { message: string | null }) {
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ opacity: 0, height: 0, marginTop: 0 }}
          animate={{ opacity: 1, height: 'auto', marginTop: 0 }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="overflow-hidden"
        >
          <div className="rounded-lg border border-magenta-100 bg-magenta-50 px-3.5 py-2.5 text-sm text-magenta-600">
            {message}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
