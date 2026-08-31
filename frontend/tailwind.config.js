/** @type {import('tailwindcss').Config} */

// "Neural dark": deep-space navy ground, electric blue-to-cyan light, and
// waveform motion. Every colour below is referenced by name in the UI kit -
// avoid hard-coded hex values in components so a re-theme stays a one-file job.
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        'aria-void': '#080B14', // deepest background, page ground
        'aria-base': '#0D1117', // raised page background
        'aria-surface': '#161B27', // cards, panels
        'aria-border': '#1E2D40', // hairlines, dividers
        'aria-blue': '#2D7DD2', // primary accent, electric blue
        'aria-pulse': '#00D4FF', // glow accent, cyan
        'aria-green': '#10B981', // success, strong scores
        'aria-amber': '#F59E0B', // warning, middling scores
        'aria-red': '#EF4444', // error, filler words
        'aria-text': '#E8EDF5', // primary text
        'aria-muted': '#6B7A99', // secondary text
      },

      fontFamily: {
        // Loaded in index.html. System stacks follow so text still renders
        // in the right metrics if Google Fonts is blocked or slow.
        display: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },

      backgroundImage: {
        // The signature blue -> cyan sweep used on primary actions and headings.
        'aria-gradient': 'linear-gradient(135deg, #2D7DD2 0%, #00D4FF 100%)',
        'aria-gradient-soft':
          'linear-gradient(135deg, rgba(45,125,210,0.18) 0%, rgba(0,212,255,0.10) 100%)',
        // Faint horizon glow for page and hero backgrounds.
        'aria-radial':
          'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(45,125,210,0.22), transparent 70%)',
      },

      boxShadow: {
        glow: '0 0 20px rgba(0, 212, 255, 0.30)',
        'glow-sm': '0 0 12px rgba(0, 212, 255, 0.22)',
        'glow-lg': '0 0 40px rgba(0, 212, 255, 0.35)',
        'glow-blue': '0 0 20px rgba(45, 125, 210, 0.35)',
        surface: '0 1px 2px rgba(0,0,0,0.4), 0 8px 24px -12px rgba(0,0,0,0.6)',
      },

      keyframes: {
        // Halo that swells and fades - used on live/recording affordances.
        'pulse-glow': {
          '0%, 100%': {
            boxShadow: '0 0 0 0 rgba(0, 212, 255, 0)',
            opacity: '0.6',
          },
          '50%': {
            boxShadow: '0 0 24px 4px rgba(0, 212, 255, 0.65)',
            opacity: '1',
          },
        },
        // A single audio bar. Staggering comes from per-bar animation-delay.
        waveform: {
          '0%, 100%': { transform: 'scaleY(0.2)' },
          '50%': { transform: 'scaleY(1)' },
        },
        // Scores rising into place after an interview is graded.
        'score-count': {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(30px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        // Indeterminate loading dots.
        'pulse-dot': {
          '0%, 80%, 100%': { transform: 'scale(0.6)', opacity: '0.35' },
          '40%': { transform: 'scale(1)', opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },

      animation: {
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        waveform: 'waveform 0.8s ease-in-out infinite',
        'score-count': 'score-count 0.6s ease-out both',
        'slide-up': 'slide-up 0.4s ease-out both',
        'fade-in': 'fade-in 0.3s ease-out both',
        'pulse-dot': 'pulse-dot 1.4s ease-in-out infinite',
        shimmer: 'shimmer 2s linear infinite',
      },

      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
}
