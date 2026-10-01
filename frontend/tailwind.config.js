/** @type {import('tailwindcss').Config} */

// "Golden dusk": warm cream ground, amber-gold light and deep ocean teal -
// the same palette as the public landing page, so the whole product reads as
// one brand. Every colour below is referenced by name in the UI kit -
// avoid hard-coded hex values in components so a re-theme stays a one-file job.
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        'aria-void': '#F2EDE4', // page ground, warm cream
        'aria-base': '#F8F4EF', // raised page background
        'aria-surface': '#FFFFFF', // cards, panels
        'aria-border': '#D9CFC4', // hairlines, dividers
        'aria-blue': '#D4891A', // primary accent, deep gold
        'aria-pulse': '#F5A623', // glow accent, amber gold
        'aria-green': '#178A5B', // success, strong scores
        'aria-amber': '#B07408', // warning, middling scores
        'aria-red': '#C43D3D', // error, filler words
        'aria-text': '#1A1F2E', // primary text, navy-charcoal
        'aria-muted': '#7A6E62', // secondary text
      },

      fontFamily: {
        // Loaded in index.html. System stacks follow so text still renders
        // in the right metrics if Google Fonts is blocked or slow.
        display: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },

      backgroundImage: {
        // The signature amber -> deep gold sweep used on primary actions.
        'aria-gradient': 'linear-gradient(135deg, #F5A623 0%, #D4891A 100%)',
        'aria-gradient-soft':
          'linear-gradient(135deg, rgba(245,166,35,0.20) 0%, rgba(212,137,26,0.10) 100%)',
        // Faint golden-hour horizon for page backgrounds.
        'aria-radial':
          'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(245,166,35,0.22), transparent 70%)',
      },

      boxShadow: {
        glow: '0 0 20px rgba(245, 166, 35, 0.30)',
        'glow-sm': '0 0 12px rgba(245, 166, 35, 0.22)',
        'glow-lg': '0 0 40px rgba(245, 166, 35, 0.35)',
        'glow-blue': '0 0 20px rgba(212, 137, 26, 0.35)',
        surface: '0 1px 2px rgba(27,31,46,0.06), 0 12px 32px -14px rgba(27,75,90,0.20)',
      },

      keyframes: {
        // Halo that swells and fades - used on live/recording affordances and
        // the primary CTA. Only the shadow's alpha animates: fading the
        // element itself would dim the button label to 60% and make a live
        // control read as disabled.
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(245, 166, 35, 0)' },
          '50%': { boxShadow: '0 0 24px 4px rgba(245, 166, 35, 0.55)' },
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
