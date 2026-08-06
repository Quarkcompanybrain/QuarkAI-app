import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';

export function TabNav({ tabs }: { tabs: { to: string; label: string }[] }) {
  return (
    <div className="flex gap-1 border-b border-neutral-150 px-6">
      {tabs.map((tab) => (
        <NavLink key={tab.to} to={tab.to} className="relative">
          {({ isActive }) => (
            <span
              className={`relative block px-3 py-3 text-sm font-medium transition-colors duration-200 ${
                isActive ? 'text-magenta-600' : 'text-neutral-500 hover:text-ink'
              }`}
            >
              {tab.label}
              {isActive && (
                <motion.span
                  layoutId="tab-underline"
                  className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-magenta-gradient"
                  transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                />
              )}
            </span>
          )}
        </NavLink>
      ))}
    </div>
  );
}
