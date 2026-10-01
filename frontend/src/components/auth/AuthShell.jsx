// Shared frame for the login and register pages: the landing page's warm
// palette, background and brand column, with the form card on the right.
// Pages keep their own logic and pass the card contents as children.

import { Link } from 'react-router-dom'

import '../../pages/Landing.css'

const FEATURES = [
  {
    icon: '🎯',
    name: 'Adaptive questioning',
    desc: 'Questions follow your answers, tuned to the role and difficulty you pick.',
  },
  {
    icon: '🎙️',
    name: 'Live speech analysis',
    desc: 'Filler words, pace and confidence, measured while you speak.',
  },
  {
    icon: '📊',
    name: 'Scorecards that explain',
    desc: 'A breakdown per answer, plus a report you can take away.',
  },
]

export default function AuthShell({ children }) {
  return (
    <div className="landing auth-page">
      <div className="hero-bg" />
      <div className="hero-orb o1" aria-hidden="true" />
      <div className="hero-orb o2" aria-hidden="true" />

      <Link to="/" className="nav-logo auth-logo" aria-label="Back to the ARIA home page">
        <span className="nav-logo-text">ARIA</span>
        <div className="nav-logo-dot" />
      </Link>

      <div className="auth-shell">
        <div className="auth-brand">
          <div className="hero-tag">
            <span className="hero-tag-line" />
            AI INTERVIEW COACH
          </div>

          <h1 className="auth-headline">
            PRACTICE <span className="t">SMARTER.</span>
            <br />
            INTERVIEW <span className="g">BETTER.</span>
          </h1>

          <div className="auth-wave" aria-hidden="true">
            <div className="wave-bars">
              {Array.from({ length: 12 }, (_, i) => (
                <div key={i} className="wave-bar" />
              ))}
            </div>
          </div>

          <ul className="auth-features">
            {FEATURES.map((f) => (
              <li className="auth-feature" key={f.name}>
                <span className="auth-feature-icon" aria-hidden="true">{f.icon}</span>
                <div>
                  <div className="auth-feature-name">{f.name}</div>
                  <div className="auth-feature-desc">{f.desc}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="auth-card">{children}</div>
      </div>
    </div>
  )
}

/** One labelled input in the auth style. Extra props go to the <input>. */
export function AuthField({ label, id, icon, error, hint, rightElement, required, ...props }) {
  return (
    <div className="auth-field">
      <label htmlFor={id}>
        {label}
        {required ? <span className="req"> *</span> : null}
      </label>
      <div className={'auth-input' + (error ? ' has-error' : '')}>
        {icon ? <span className="auth-input-icon">{icon}</span> : null}
        <input
          id={id}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          {...props}
        />
        {rightElement ? <span className="auth-input-right">{rightElement}</span> : null}
      </div>
      {error ? (
        <p className="auth-field-error" id={`${id}-error`} role="alert">{error}</p>
      ) : hint ? (
        <p className="auth-field-hint">{hint}</p>
      ) : null}
    </div>
  )
}
