import { useState, type InputHTMLAttributes } from 'react';
import { EyeIcon, EyeOffIcon } from './icons';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function Input({ label, id, type, className = '', ...rest }: InputProps) {
  const [revealed, setRevealed] = useState(false);
  const inputId = id || label.toLowerCase().replace(/\s+/g, '-');
  const isPassword = type === 'password';

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-neutral-700">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          type={isPassword ? (revealed ? 'text' : 'password') : type}
          className={`w-full rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-ink shadow-xs outline-none transition-all duration-200 ease-smooth placeholder:text-neutral-400 hover:border-neutral-300 focus:border-magenta-500 focus:shadow-[0_0_0_3px_rgba(255,27,205,0.10)] ${isPassword ? 'pr-10' : ''} ${className}`}
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? 'Hide password' : 'Show password'}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 transition-colors hover:text-neutral-600"
          >
            {revealed ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );
}
