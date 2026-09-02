// Public landing page. Self-contained: own navbar, own warm palette (scoped in
// Landing.css), no app shell. Everything animated here is either pure CSS or a
// cleaned-up effect - nothing leaks past unmount.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import './Landing.css'

// The mini interview panel "types" ARIA's feedback in a loop.
const FEEDBACK_LINES = [
  'Good start - you mentioned pandas. What specific steps would you take to handle missing values before analysis?',
  "That's correct - and citing the 30% null column shows real judgement. Now, which imputation method would you defend to a stakeholder?",
  'Strong structure. You gave the situation and the action - close it with the measurable result to complete the STAR arc.',
]

const ROLES = [
  { icon: '📊', tint: 'blue', name: 'Data Analyst', qs: '24 questions' },
  { icon: '💻', tint: 'purple', name: 'Software Eng.', qs: '24 questions' },
  { icon: '🤝', tint: 'pink', name: 'Human Resources', qs: '24 questions' },
  { icon: '🤖', tint: 'teal', name: 'AI Engineer', qs: '24 questions' },
]

const MARQUEE_WORDS = [
  'DATA ANALYST', 'SOFTWARE ENGINEER', 'HUMAN RESOURCES', 'AI ENGINEER',
  'REAL-TIME SCORING', 'ADAPTIVE QUESTIONS', 'VOICE ANALYSIS',
]

/** Animates a number from 0 to `target` the first time it renders. */
function useCountUp(target, durationMs = 1400, startDelayMs = 700) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(target)
      return undefined
    }
    let raf
    const timer = window.setTimeout(() => {
      const t0 = performance.now()
      const tick = (now) => {
        const p = Math.min((now - t0) / durationMs, 1)
        // ease-out-cubic: fast start, gentle landing on the final digit
        setValue(Math.round(target * (1 - Math.pow(1 - p, 3))))
        if (p < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }, startDelayMs)
    return () => {
      window.clearTimeout(timer)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [target, durationMs, startDelayMs])
  return value
}

export default function Landing() {
  const navigate = useNavigate()
  const [activeRole, setActiveRole] = useState(0)
  const [typed, setTyped] = useState('')
  const [waveSeconds, setWaveSeconds] = useState(34)

  const rootRef = useRef(null)
  const heroRef = useRef(null)
  const glowRef = useRef(null)
  const tiltRefs = useRef([])

  const statRoles = useCountUp(4)
  const statQuestions = useCountUp(96)
  const statMetrics = useCountUp(5)

  const goRegister = () => navigate('/register')
  const goLogin = () => navigate('/login')
  const goDemo = () =>
    navigate('/login', { state: { username: 'demo', password: 'demo123' } })

  // ---- Scroll reveal ---------------------------------------------------- //
  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('visible')
            obs.unobserve(e.target)
          }
        })
      },
      { threshold: 0.1 },
    )
    root.querySelectorAll('.reveal').forEach((el) => obs.observe(el))
    return () => obs.disconnect()
  }, [])

  // ---- Score bars animate from zero when scrolled into view ------------- //
  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined
    const fills = Array.from(root.querySelectorAll('.sc-fill'))
    const targets = fills.map((f) => f.style.width)
    fills.forEach((f) => {
      f.style.width = '0%'
    })
    const timers = []
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return
          const i = fills.indexOf(e.target)
          timers.push(
            window.setTimeout(() => {
              e.target.style.transition = 'width 1.2s ease-out'
              e.target.style.width = targets[i]
            }, 100 + i * 90),
          )
          obs.unobserve(e.target)
        })
      },
      { threshold: 0.5 },
    )
    fills.forEach((f) => obs.observe(f))
    return () => {
      obs.disconnect()
      timers.forEach(window.clearTimeout)
    }
  }, [])

  // ---- Typing loop in the live panel ------------------------------------ //
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setTyped(FEEDBACK_LINES[0])
      return undefined
    }
    let line = 0
    let pos = 0
    let timer
    const step = () => {
      const text = FEEDBACK_LINES[line]
      if (pos <= text.length) {
        setTyped(text.slice(0, pos))
        pos += 1
        timer = window.setTimeout(step, 26)
      } else {
        // Hold the finished line, then wipe and move to the next one.
        timer = window.setTimeout(() => {
          line = (line + 1) % FEEDBACK_LINES.length
          pos = 0
          step()
        }, 3200)
      }
    }
    timer = window.setTimeout(step, 1200)
    return () => window.clearTimeout(timer)
  }, [])

  // ---- Recording clock ticks like a real session ------------------------ //
  useEffect(() => {
    const t = window.setInterval(() => setWaveSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(t)
  }, [])

  // ---- Cursor glow + 3D tilt on the hero panels ------------------------- //
  const handleHeroMove = useCallback((event) => {
    const hero = heroRef.current
    const glow = glowRef.current
    if (!hero) return
    const rect = hero.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    if (glow) {
      glow.style.left = `${x}px`
      glow.style.top = `${y}px`
      glow.style.opacity = '1'
    }
    // Panels lean toward the cursor - subtle, capped at ~4 degrees.
    tiltRefs.current.forEach((el) => {
      if (!el) return
      const r = el.getBoundingClientRect()
      const dx = (event.clientX - (r.left + r.width / 2)) / r.width
      const dy = (event.clientY - (r.top + r.height / 2)) / r.height
      el.style.transform = `rotateY(${dx * 4}deg) rotateX(${dy * -4}deg)`
    })
  }, [])

  const handleHeroLeave = useCallback(() => {
    if (glowRef.current) glowRef.current.style.opacity = '0'
    tiltRefs.current.forEach((el) => {
      if (el) el.style.transform = 'rotateY(0deg) rotateX(0deg)'
    })
  }, [])

  const clock = `${Math.floor(waveSeconds / 60)}:${String(waveSeconds % 60).padStart(2, '0')}`

  return (
    <div className="landing" ref={rootRef}>
      {/* NAVBAR */}
      <nav>
        <a href="#top" className="nav-logo" aria-label="ARIA home">
          <span className="nav-logo-text">ARIA</span>
          <div className="nav-logo-dot" />
        </a>
        <ul className="nav-links">
          <li><a href="#how">How it works</a></li>
          <li><a href="#roles">Roles</a></li>
          <li><a href="#scores">Scoring</a></li>
        </ul>
        <div className="nav-right">
          <button type="button" className="btn-outline" onClick={goLogin}>
            Sign in
          </button>
          <button type="button" className="btn-gold" onClick={goRegister}>
            Start free
            <div className="btn-gold-arrow" aria-hidden="true">↗</div>
          </button>
        </div>
      </nav>

      {/* HERO */}
      <section
        className="hero"
        id="top"
        ref={heroRef}
        onMouseMove={handleHeroMove}
        onMouseLeave={handleHeroLeave}
      >
        <div className="hero-bg" />
        <div className="hero-orb o1" aria-hidden="true" />
        <div className="hero-orb o2" aria-hidden="true" />
        <div className="hero-glow" ref={glowRef} aria-hidden="true" />
        <div className="hero-divider" />

        {/* LEFT */}
        <div className="hero-left">
          <div className="hero-tag hero-enter d1">
            <span className="hero-tag-line" />
            AI INTERVIEW COACH
          </div>

          <h1 className="hero-headline">
            <span className="hw"><span>PRACTICE</span></span>
            <span className="hw"><span className="word-teal">SMARTER.</span></span>
            <span className="hw"><span>INTERVIEW</span></span>
            <span className="hw"><span className="word-gold">BETTER.</span></span>
          </h1>

          <p className="hero-sub hero-enter d2">
            ARIA listens to you answer, scores your speech and content in real
            time, then adapts the next question to your level — no booking, no
            judgment, no charge.
          </p>

          <div className="hero-actions hero-enter d3">
            <button type="button" className="btn-hero-main" onClick={goRegister}>
              Start practicing
              <div className="arrow-circle" aria-hidden="true">↗</div>
            </button>
            <a href="#scores" className="btn-hero-ghost">
              <div className="ghost-play" aria-hidden="true">▶</div>
              See it live
            </a>
          </div>

          <div className="hero-stat-strip hero-enter d4">
            <div className="stat-block">
              <div className="stat-big">{statRoles}<span>+</span></div>
              <div className="stat-small">Job roles covered in depth</div>
            </div>
            <div className="stat-block">
              <div className="stat-big">{statQuestions}<span>+</span></div>
              <div className="stat-small">Interview questions in the bank</div>
            </div>
            <div className="stat-block">
              <div className="stat-big">{statMetrics}</div>
              <div className="stat-small">Metrics scored per answer</div>
            </div>
          </div>
        </div>

        {/* RIGHT */}
        <div className="hero-right">
          <div
            className="role-map reveal tilt"
            ref={(el) => { tiltRefs.current[0] = el }}
          >
            <div className="role-map-header">
              <div>
                <div className="role-map-title">CHOOSE YOUR ROLE</div>
                <div className="role-map-sub">Pick a track · Set your difficulty · Start</div>
              </div>
              <div className="role-map-badge">ADAPTIVE</div>
            </div>
            <div className="role-nodes">
              {ROLES.map((role, i) => (
                <div
                  key={role.name}
                  role="button"
                  tabIndex={0}
                  className={`role-node${activeRole === i ? ' active' : ''}`}
                  onClick={() => setActiveRole(i)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setActiveRole(i)
                    }
                  }}
                >
                  <div className={`role-node-icon ${role.tint}`}>{role.icon}</div>
                  <div className="role-node-info">
                    <div className="role-node-name">{role.name}</div>
                    <div className="role-node-qs">{role.qs}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div
            className="live-panel reveal tilt"
            style={{ transitionDelay: '0.12s' }}
            ref={(el) => { tiltRefs.current[1] = el }}
          >
            <div className="live-bar">
              <div className="live-indicator">
                <div className="live-dot" />
                LIVE SESSION
              </div>
              <div className="live-role">
                {ROLES[activeRole].name.toUpperCase()} · INTERMEDIATE · Q2/5
              </div>
            </div>

            <div className="live-question">
              Walk me through what you&apos;d do with a CSV of sales data
              you&apos;ve never seen before.
            </div>

            <div className="live-wave-row">
              <div className="live-wave-label">REC</div>
              <div className="wave-bars" aria-hidden="true">
                {Array.from({ length: 12 }, (_, i) => (
                  <div key={i} className="wave-bar" />
                ))}
              </div>
              <div className="wave-time">{clock}</div>
            </div>

            <div className="live-metrics-row">
              <div className="live-metric">
                <div className="lm-label">CONFIDENCE</div>
                <div className="lm-value g">83<span style={{ fontSize: 14 }}>%</span></div>
                <div className="lm-sub">Good</div>
              </div>
              <div className="live-metric">
                <div className="lm-label">WPM</div>
                <div className="lm-value b">132</div>
                <div className="lm-sub">Ideal</div>
              </div>
              <div className="live-metric">
                <div className="lm-label">FILLERS</div>
                <div className="lm-value a">2</div>
                <div className="lm-sub">&quot;like&quot; ×2</div>
              </div>
            </div>

            <div className="live-feedback">
              <div className="lf-label"><div className="lf-dot" />ARIA FEEDBACK</div>
              <div className="lf-text">
                {typed}
                <span className="lf-cursor" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ROLE TICKER */}
      <div className="marquee" aria-hidden="true">
        <div className="marquee-track">
          {[0, 1].map((copy) => (
            <div className="marquee-seq" key={copy}>
              {MARQUEE_WORDS.map((word) => (
                <span key={word} style={{ display: 'inline-flex', alignItems: 'center', gap: 44 }}>
                  <span className="marquee-word">{word}</span>
                  <span className="marquee-star">✦</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* HOW IT WORKS */}
      <section className="section-how" id="how">
        <div className="sec-label">THE PROCESS</div>
        <div className="sec-title reveal">THREE STEPS.<br />ONE BETTER INTERVIEW.</div>

        <div className="how-grid">
          <div className="how-step reveal">
            <div className="step-num">01</div>
            <div className="step-icon">🎯</div>
            <div className="step-title">PICK YOUR ROLE</div>
            <div className="step-desc">
              Choose from Data Analyst, Software Engineer, HR, or AI Engineer.
              Set your difficulty — Beginner to Advanced. ARIA calibrates the
              question bank and the pressure accordingly.
            </div>
          </div>
          <div className="how-step reveal" style={{ transitionDelay: '0.1s' }}>
            <div className="step-num">02</div>
            <div className="step-icon">🎙️</div>
            <div className="step-title">SPEAK YOUR ANSWERS</div>
            <div className="step-desc">
              Answer by voice or text. Your speech is transcribed live using
              Groq Whisper. Filler words, speaking pace, and confidence are
              tracked as you talk — not after you finish.
            </div>
          </div>
          <div className="how-step reveal" style={{ transitionDelay: '0.2s' }}>
            <div className="step-num">03</div>
            <div className="step-icon">📊</div>
            <div className="step-title">GET REAL FEEDBACK</div>
            <div className="step-desc">
              ARIA reads your specific answer — not a template. It tells you
              exactly what you missed, what a stronger answer looks like, and
              adapts the next question to what you just showed.
            </div>
          </div>
        </div>
      </section>

      {/* SCORES */}
      <div className="section-sep" />
      <section className="section-scores" id="scores">
        <div className="score-card-wrap reveal">
          <div className="float-tag tl">
            <div className="ft-dot" />
            Session improving +12%
          </div>
          <div className="score-card">
            <div className="sc-header">
              <div className="sc-title">INTERVIEW REPORT</div>
              <div className="sc-overall">74%</div>
            </div>
            <div className="sc-rows">
              {[
                ['Answer Quality', 78, 'g'],
                ['Confidence Score', 65, 'a'],
                ['Communication', 82, 'g'],
                ['Filler Words', 71, 'b'],
                ['Speaking Pace', 86, 'g'],
              ].map(([name, val, toneClass]) => (
                <div className="sc-row" key={name}>
                  <div className="sc-row-top">
                    <span className="sc-row-name">{name}</span>
                    <span className={`sc-row-val ${toneClass}`}>{val}/100</span>
                  </div>
                  <div className="sc-track">
                    <div className={`sc-fill ${toneClass}`} style={{ width: `${val}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="float-tag br">3 sessions · avg 68 → 74</div>
        </div>

        <div className="scores-right reveal" style={{ transitionDelay: '0.15s' }}>
          <div className="sec-label">WHAT GETS SCORED</div>
          <div className="sec-title" style={{ color: 'var(--white)' }}>
            FIVE METRICS.<br />ONE HONEST PICTURE.
          </div>
          <div className="features">
            <div className="feat">
              <div className="feat-icon">🧠</div>
              <div>
                <div className="feat-name">Answer Quality</div>
                <div className="feat-desc">
                  Did you actually answer the question? ARIA checks relevance,
                  depth, structure, and whether you gave real examples — not
                  just that you talked long enough.
                </div>
              </div>
            </div>
            <div className="feat">
              <div className="feat-icon">🎙️</div>
              <div>
                <div className="feat-name">Confidence &amp; Filler Words</div>
                <div className="feat-desc">
                  Every &quot;um&quot;, &quot;like&quot;, and &quot;basically&quot; is counted and
                  penalised. Your composite confidence score reflects how you
                  came across — not just what you said.
                </div>
              </div>
            </div>
            <div className="feat">
              <div className="feat-icon">📈</div>
              <div>
                <div className="feat-name">Progress across sessions</div>
                <div className="feat-desc">
                  Every interview is saved. Your dashboard shows whether
                  you&apos;re actually improving or just getting comfortable
                  with the same mistakes.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ROLES */}
      <div
        className="section-sep"
        style={{
          background:
            'linear-gradient(90deg,transparent,rgba(255,255,255,0.07) 20%,rgba(255,255,255,0.07) 80%,transparent)',
        }}
      />
      <section className="section-roles" id="roles">
        <div className="sec-label">INTERVIEW TRACKS</div>
        <div className="sec-title reveal">BUILT FOR THE<br />ROLES THAT MATTER.</div>
        <div className="roles-grid">
          <div className="role-card c1 reveal" onClick={goRegister}>
            <div className="rc-emoji">📊</div>
            <div className="rc-name">DATA ANALYST</div>
            <div className="rc-desc">
              SQL, Python, EDA, visualisation, storytelling with data — the full
              analyst toolkit at every difficulty.
            </div>
            <div className="rc-tags">
              <span className="rc-tag">Python</span><span className="rc-tag">SQL</span>
              <span className="rc-tag">Pandas</span><span className="rc-tag">Statistics</span>
            </div>
          </div>
          <div
            className="role-card c2 reveal"
            style={{ transitionDelay: '0.08s' }}
            onClick={goRegister}
          >
            <div className="rc-emoji">💻</div>
            <div className="rc-name">SOFTWARE ENGINEER</div>
            <div className="rc-desc">
              DSA, system design, OOP, APIs — from LeetCode-style questions to
              full architecture rounds.
            </div>
            <div className="rc-tags">
              <span className="rc-tag">Algorithms</span>
              <span className="rc-tag">System Design</span>
              <span className="rc-tag">OOP</span>
            </div>
          </div>
          <div
            className="role-card c3 reveal"
            style={{ transitionDelay: '0.16s' }}
            onClick={goRegister}
          >
            <div className="rc-emoji">🤝</div>
            <div className="rc-name">HUMAN RESOURCES</div>
            <div className="rc-desc">
              Behavioural, situational, and culture-fit questions with STAR
              method coaching built in.
            </div>
            <div className="rc-tags">
              <span className="rc-tag">Behavioural</span>
              <span className="rc-tag">STAR Method</span>
              <span className="rc-tag">Culture</span>
            </div>
          </div>
          <div
            className="role-card c4 reveal"
            style={{ transitionDelay: '0.24s' }}
            onClick={goRegister}
          >
            <div className="rc-emoji">🤖</div>
            <div className="rc-name">AI ENGINEER</div>
            <div className="rc-desc">
              LLMs, RAG, fine-tuning, MLOps — for candidates targeting AI-native
              and research companies.
            </div>
            <div className="rc-tags">
              <span className="rc-tag">PyTorch</span>
              <span className="rc-tag">Transformers</span>
              <span className="rc-tag">MLOps</span>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="section-cta">
        <div className="cta-glow" />
        <div className="cta-inner">
          <div
            className="sec-label"
            style={{ justifyContent: 'center', marginBottom: 20, color: 'var(--gold)' }}
          >
            <span
              style={{
                display: 'block',
                width: 24,
                height: 1.5,
                background: 'var(--gold)',
                marginRight: 10,
              }}
            />
            GET STARTED
          </div>
          <div className="cta-h reveal">
            YOUR NEXT<br />INTERVIEW STARTS <span>HERE.</span>
          </div>
          <p className="cta-sub reveal" style={{ transitionDelay: '0.1s' }}>
            No sign-up required to try. Log in as{' '}
            <strong style={{ color: 'rgba(255,255,255,0.8)' }}>demo / demo123</strong>{' '}
            and see a full interview with real scores and AI feedback.
          </p>
          <div className="cta-btns reveal" style={{ transitionDelay: '0.2s' }}>
            <button type="button" className="btn-cta-main" onClick={goRegister}>
              Start practicing free
              <div className="cta-arrow" aria-hidden="true">↗</div>
            </button>
            <button type="button" className="btn-cta-ghost" onClick={goDemo}>
              Try demo account
            </button>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer>
        <div className="footer-logo">
          ARIA
          <div className="nav-logo-dot" />
        </div>
        <div className="footer-center">
          A. P. Shah Institute of Technology · Mumbai University · 2026
        </div>
        <div className="footer-right">v1.0.0</div>
      </footer>
    </div>
  )
}
