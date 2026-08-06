import type { InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function Input({ label, id, className = '', ...rest }: InputProps) {
  const inputId = id || label.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-neutral-700">
        {label}
      </label>
      <input
        id={inputId}
        className={`rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-ink shadow-xs outline-none transition-all duration-200 ease-smooth placeholder:text-neutral-400 hover:border-neutral-300 focus:border-magenta-500 focus:shadow-[0_0_0_3px_rgba(255,27,205,0.10)] ${className}`}
        {...rest}
      />
    </div>
  );
}
