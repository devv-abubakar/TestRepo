/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'system-ui', 'sans-serif'],
        urdu: ['Noto Nastaliq Urdu', 'serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        ink: {
          950: '#08090d',
          900: '#0d0f16',
          850: '#12141d',
          800: '#191c27',
          700: '#242835',
          600: '#343949',
          500: '#4b5164',
          400: '#6b7288',
          300: '#9298ac',
          200: '#c2c6d3',
          100: '#e6e8ef',
          50: '#f5f6fa',
        },
        brand: {
          50: '#eef4ff',
          100: '#d9e5ff',
          200: '#bcd1ff',
          300: '#8eb2ff',
          400: '#5987ff',
          500: '#335dff',
          600: '#1e3df5',
          700: '#182ee1',
          800: '#1a29b6',
          900: '#1c2b8f',
        },
        acid: '#c6ff4f',
      },
      boxShadow: {
        panel: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 12px 32px -12px rgba(0,0,0,0.6)',
        lift: '0 24px 60px -24px rgba(0,0,0,0.75)',
      },
      keyframes: {
        'fade-up': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        shimmer: { from: { backgroundPosition: '200% 0' }, to: { backgroundPosition: '-200% 0' } },
      },
      animation: {
        'fade-up': 'fade-up 0.25s cubic-bezier(0.22,1,0.36,1) both',
        shimmer: 'shimmer 2.4s linear infinite',
      },
    },
  },
  plugins: [],
};
