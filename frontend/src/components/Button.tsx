import { motion, type HTMLMotionProps } from 'framer-motion';

interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
  children?: React.ReactNode;
}

const variants = {
  primary:
    'bg-magenta-gradient text-white shadow-glow-sm hover:brightness-[1.06] disabled:bg-magenta-100 disabled:text-magenta-400 disabled:shadow-none',
  secondary:
    'bg-ink text-white shadow-sm hover:bg-neutral-700 disabled:bg-neutral-200 disabled:text-neutral-400 disabled:shadow-none',
  ghost:
    'bg-transparent text-ink hover:bg-neutral-100 disabled:text-neutral-400',
};

export function Button({ variant = 'primary', loading, disabled, children, className = '', ...rest }: ButtonProps) {
  return (
    <motion.button
      whileTap={{ scale: disabled || loading ? 1 : 0.97 }}
      transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-[background,box-shadow,filter] duration-200 ease-smooth disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 animate-pulse-node rounded-full bg-current" />
          <span className="h-1.5 w-1.5 animate-pulse-node rounded-full bg-current [animation-delay:0.15s]" />
          <span className="h-1.5 w-1.5 animate-pulse-node rounded-full bg-current [animation-delay:0.3s]" />
        </span>
      ) : (
        children
      )}
    </motion.button>
  );
}
