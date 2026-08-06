/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        magenta: {
          DEFAULT: '#FF1BCD',
          50: '#FFF0FA',
          100: '#FFDCF2',
          200: '#FFB8E9',
          400: '#FF5CDD',
          500: '#FF1BCD',
          600: '#DB0EAE',
          700: '#B3078C',
        },
        ink: {
          DEFAULT: '#0A0A0A',
          soft: '#171717',
        },
        neutral: {
          DEFAULT: '#737373',
          25: '#FCFCFC',
          50: '#FAFAFA',
          100: '#F2F2F2',
          150: '#EBEBEB',
          200: '#E5E5E5',
          300: '#D4D4D4',
          400: '#A3A3A3',
          500: '#737373',
          600: '#575757',
          700: '#404040',
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        sans: ['"Inter"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      fontSize: {
        xs: ['12px', { lineHeight: '16px' }],
        sm: ['13px', { lineHeight: '18px' }],
        base: ['14px', { lineHeight: '20px' }],
        md: ['15px', { lineHeight: '22px' }],
        lg: ['17px', { lineHeight: '24px' }],
        xl: ['20px', { lineHeight: '27px' }],
        '2xl': ['24px', { lineHeight: '30px' }],
        '3xl': ['32px', { lineHeight: '38px' }],
      },
      borderRadius: {
        lg: '10px',
        xl: '14px',
        '2xl': '18px',
      },
      boxShadow: {
        xs: '0 1px 2px rgba(10,10,10,0.04)',
        sm: '0 1px 3px rgba(10,10,10,0.06), 0 1px 2px rgba(10,10,10,0.04)',
        md: '0 4px 12px rgba(10,10,10,0.06), 0 2px 4px rgba(10,10,10,0.04)',
        lg: '0 12px 32px rgba(10,10,10,0.10), 0 4px 8px rgba(10,10,10,0.04)',
        glow: '0 0 0 1px rgba(255,27,205,0.15), 0 8px 24px rgba(255,27,205,0.20)',
        'glow-sm': '0 4px 14px rgba(255,27,205,0.28)',
        'inner-ring': 'inset 0 0 0 1px rgba(10,10,10,0.06)',
      },
      backgroundImage: {
        'magenta-gradient': 'linear-gradient(180deg, #FF3AD6 0%, #FF1BCD 50%, #E80EB8 100%)',
        'magenta-radial': 'radial-gradient(circle at 50% 0%, rgba(255,27,205,0.16), transparent 60%)',
        'ink-radial': 'radial-gradient(circle at 50% 0%, rgba(10,10,10,0.06), transparent 60%)',
        'surface-gradient': 'linear-gradient(180deg, #FFFFFF 0%, #FAFAFA 100%)',
      },
      keyframes: {
        pulseNode: {
          '0%, 100%': { transform: 'scale(1)', opacity: '1' },
          '50%': { transform: 'scale(1.5)', opacity: '0.55' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        floatSlow: {
          '0%, 100%': { transform: 'translate(0, 0)' },
          '50%': { transform: 'translate(12px, -12px)' },
        },
      },
      animation: {
        'pulse-node': 'pulseNode 1.4s ease-in-out infinite',
        shimmer: 'shimmer 1.8s linear infinite',
        'fade-in': 'fadeIn 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
        blink: 'blink 1s step-start infinite',
        'float-slow': 'floatSlow 8s ease-in-out infinite',
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
};
