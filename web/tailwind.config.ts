import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        void: '#050510',
        obsidian: '#0b0b18',
        surface: '#12122a',
        line: 'rgba(255,255,255,0.08)',
        line2: 'rgba(255,255,255,0.14)',
        ink: '#e8e8f5',
        muted: '#7a7a95',
        muted2: '#a4a4c2',
        violet: {
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed'
        },
        cyan: {
          400: '#22d3ee',
          500: '#06b6d4'
        },
        neon: '#00ffd5',
        magenta: '#ff2fd0',
        amber: '#fbbf24',
        rose: '#fb7185'
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace']
      },
      boxShadow: {
        glow: '0 0 40px -10px rgba(139,92,246,0.5)',
        glowCyan: '0 0 40px -10px rgba(34,211,238,0.5)',
        card: '0 20px 50px -20px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)'
      },
      backgroundImage: {
        aurora:
          'radial-gradient(ellipse 80% 60% at 20% 0%, rgba(139,92,246,0.35), transparent 60%), radial-gradient(ellipse 60% 50% at 80% 10%, rgba(34,211,238,0.25), transparent 60%), radial-gradient(ellipse 50% 40% at 50% 100%, rgba(255,47,208,0.18), transparent 60%)',
        grid:
          'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)'
      },
      animation: {
        'pulse-slow': 'pulse 3.5s ease-in-out infinite',
        shimmer: 'shimmer 2.4s linear infinite',
        float: 'float 6s ease-in-out infinite'
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' }
        },
        float: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' }
        }
      }
    }
  },
  plugins: []
};

export default config;
