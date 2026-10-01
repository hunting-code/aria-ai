// Resume upload + analysis. One upload runs extraction, parsing, scoring and
// role matching on the server; this page renders the full result across four
// tabs and lets the user practice the AI's resume-specific questions.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  FileText,
  Send,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react'

import { Button, Card, LoadingSpinner, ScoreRing, cn, useToast } from '../components/ui'
import { extractErrorMessage, resumeApi } from '../services/api'

const ROLE_LABELS = {
  data_analyst: 'Data Analyst',
  software_engineer: 'Software Engineer',
  hr: 'Human Resources',
  ai_engineer: 'AI Engineer',
}

const DIMENSIONS = [
  { key: 'impact', label: 'Impact', max: 25 },
  { key: 'clarity', label: 'Clarity', max: 20 },
  { key: 'relevance', label: 'Relevance', max: 20 },
  { key: 'completeness', label: 'Completeness', max: 20 },
  { key: 'keywords', label: 'Keywords', max: 15 },
]

const CATEGORY_TONES = {
  Impact: 'border-aria-red/40 bg-aria-red/10 text-aria-red',
  Clarity: 'border-aria-amber/40 bg-aria-amber/10 text-aria-amber',
  Relevance: 'border-aria-blue/40 bg-aria-blue/10 text-aria-blue',
  Completeness: 'border-aria-green/40 bg-aria-green/10 text-aria-green',
  Keywords: 'border-purple-500/40 bg-purple-500/10 text-purple-600',
}

const READINESS = {
  ready: { label: 'Ready', className: 'border-aria-green/40 bg-aria-green/10 text-aria-green' },
  almost_ready: {
    label: 'Almost Ready',
    className: 'border-aria-amber/40 bg-aria-amber/10 text-aria-amber',
  },
  needs_work: { label: 'Needs Work', className: 'border-aria-red/40 bg-aria-red/10 text-aria-red' },
}

const QUESTION_TYPES = {
  technical: 'bg-aria-blue/10 text-aria-blue border-aria-blue/40',
  behavioral: 'bg-aria-green/10 text-aria-green border-aria-green/40',
  clarification: 'bg-aria-amber/10 text-aria-amber border-aria-amber/40',
  depth_check: 'bg-purple-500/10 text-purple-600 border-purple-500/40',
}

const TABS = ['Overview', 'Issues', 'Role Fit', 'Suggested Questions']

const letterGrade = (score) =>
  score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F'

const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''

/* ---- Score dimension bar (animates from zero on mount) ------------------- */
function DimensionBar({ label, value, max }) {
  const fillRef = useRef(null)
  useEffect(() => {
    const el = fillRef.current
    if (!el) return
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.width = `${Math.max(0, Math.min(100, ((value ?? 0) / max) * 100))}%`
      })
    })
  }, [value, max])
  const pct = ((value ?? 0) / max) * 100
  const tone = pct >= 75 ? 'bg-aria-green' : pct >= 50 ? 'bg-aria-amber' : 'bg-aria-red'
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-aria-muted">{label}</span>
        <span className="font-mono tabular-nums text-aria-text">
          {value ?? 0}/{max}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-aria-border">
        <div
          ref={fillRef}
          className={cn('h-full rounded-full transition-[width] duration-1000 ease-out-expo', tone)}
          style={{ width: '0%' }}
        />
      </div>
    </div>
  )
}

/* ---- Collapsible parsed-section card ------------------------------------- */
function SectionCard({ title, status, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const icon =
    status === 'ok' ? (
      <CheckCircle2 className="h-4 w-4 text-aria-green" aria-hidden="true" />
    ) : status === 'weak' ? (
      <AlertTriangle className="h-4 w-4 text-aria-amber" aria-hidden="true" />
    ) : (
      <X className="h-4 w-4 text-aria-red" aria-hidden="true" />
    )
  return (
    <div className="rounded-xl border border-aria-border bg-aria-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          {icon}
          {title}
        </span>
        <ChevronDown
          className={cn('h-4 w-4 text-aria-muted transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>
      {open ? <div className="border-t border-aria-border px-4 py-3">{children}</div> : null}
    </div>
  )
}

function TechBadges({ items, tone = 'muted' }) {
  // The model occasionally lists a skill twice; dedupe so keys stay unique.
  items = items?.length ? [...new Set(items)] : items
  if (!items?.length) return null
  const cls =
    tone === 'green'
      ? 'border-aria-green/40 bg-aria-green/10 text-aria-green'
      : tone === 'red'
        ? 'border-aria-red/40 bg-aria-red/10 text-aria-red'
        : 'border-aria-border bg-aria-base text-aria-muted'
  return (
    <ul className="mt-1.5 flex flex-wrap gap-1.5">
      {items.map((t) => (
        <li key={t} className={cn('rounded-full border px-2 py-0.5 text-[11px]', cls)}>
          {tone === 'red' ? <X className="mr-0.5 inline h-3 w-3" aria-hidden="true" /> : null}
          {t}
        </li>
      ))}
    </ul>
  )
}

/* ---- Quick single-question practice modal --------------------------------- */
function PracticeModal({ question, jobRole, onClose }) {
  const [answer, setAnswer] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async () => {
    if (answer.trim().length < 10) {
      setError('Write at least a couple of sentences.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      setResult(await resumeApi.practice({ question: question.question, answer, job_role: jobRole }))
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not score your answer.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Practice this question"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <Card padding="lg" className="max-h-[85vh] w-full max-w-xl overflow-y-auto">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="font-display text-lg font-semibold">Quick practice</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-aria-muted hover:bg-black/5 hover:text-aria-text"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <p className="text-sm leading-relaxed">{question.question}</p>

        {result ? (
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  'rounded-full border px-2.5 py-0.5 text-xs font-semibold',
                  result.verdict === 'correct'
                    ? 'border-aria-green/40 bg-aria-green/10 text-aria-green'
                    : result.verdict === 'partially_correct'
                      ? 'border-aria-amber/40 bg-aria-amber/10 text-aria-amber'
                      : 'border-aria-red/40 bg-aria-red/10 text-aria-red',
                )}
              >
                {String(result.verdict).replace('_', ' ')}
              </span>
              <span className="font-mono text-sm tabular-nums text-aria-muted">
                Answer {Math.round(result.answer_score ?? 0)}/100
              </span>
            </div>
            {result.correctness_note ? (
              <p className="text-sm text-aria-text">{result.correctness_note}</p>
            ) : null}
            <p className="text-sm leading-relaxed text-aria-muted">{result.feedback_text}</p>
            <Button variant="outline" size="sm" onClick={() => setResult(null)}>
              Try again
            </Button>
          </div>
        ) : (
          <>
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={6}
              placeholder="Answer as you would out loud in the interview…"
              className="mt-4 w-full resize-none rounded-lg border border-aria-border bg-aria-base p-3 text-sm focus:border-aria-blue focus:outline-none focus:ring-2 focus:ring-aria-blue/40"
            />
            {error ? <p className="mt-2 text-sm text-aria-red">{error}</p> : null}
            <Button
              className="mt-3 w-full"
              onClick={submit}
              isLoading={busy}
              leftIcon={<Send className="h-4 w-4" />}
            >
              Score my answer
            </Button>
          </>
        )}
      </Card>
    </div>
  )
}

/* ========================================================================== */
export default function ResumeUpload() {
  const navigate = useNavigate()
  const toast = useToast((s) => s.success)
  const toastError = useToast((s) => s.error)

  const [resume, setResume] = useState(undefined) // undefined loading | null none | object
  const [pendingFile, setPendingFile] = useState(null)
  const [dragState, setDragState] = useState(null) // null | 'over' | 'valid'
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const [tab, setTab] = useState('Overview')

  const [questionRole, setQuestionRole] = useState(null)
  const [questions, setQuestions] = useState(null)
  const [questionsLoading, setQuestionsLoading] = useState(false)
  const [expandedQ, setExpandedQ] = useState(null)
  const [practice, setPractice] = useState(null)

  const inputRef = useRef(null)

  useEffect(() => {
    let live = true
    resumeApi
      .myResume()
      .then((data) => {
        if (!live) return
        setResume(data)
        if (data?.role_fit?.primary_role) setQuestionRole(data.role_fit.primary_role)
      })
      .catch(() => live && setResume(null))
    return () => {
      live = false
    }
  }, [])

  // Load questions for the questions tab, per selected role.
  useEffect(() => {
    if (tab !== 'Suggested Questions' || !questionRole || !resume) return
    let live = true
    setQuestionsLoading(true)
    setQuestions(null)
    resumeApi
      .questions(questionRole)
      .then((data) => live && setQuestions(data))
      .catch((err) => live && toastError('Could not load questions', extractErrorMessage(err)))
      .finally(() => live && setQuestionsLoading(false))
    return () => {
      live = false
    }
  }, [tab, questionRole, resume, toastError])

  const isValidFile = (file) =>
    file && /\.(pdf|docx)$/i.test(file.name) && file.size <= 5 * 1024 * 1024

  const chooseFile = (file) => {
    setUploadError(null)
    if (!file) return
    if (!/\.(pdf|docx)$/i.test(file.name)) {
      setUploadError('Only PDF and DOCX files are supported.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError(`That file is ${(file.size / 1_048_576).toFixed(1)} MB - the limit is 5 MB.`)
      return
    }
    setPendingFile(file)
  }

  const analyse = async () => {
    if (!pendingFile) return
    setUploading(true)
    setUploadError(null)
    try {
      const data = await resumeApi.upload(pendingFile)
      setResume(data)
      setPendingFile(null)
      setTab('Overview')
      if (data?.role_fit?.primary_role) setQuestionRole(data.role_fit.primary_role)
      toast('Resume analysed', `Scored ${Math.round(data.resume_score)}/100 - see what to fix below.`)
    } catch (err) {
      setUploadError(extractErrorMessage(err, 'Upload failed.'))
    } finally {
      setUploading(false)
    }
  }

  const deleteResume = async () => {
    if (!window.confirm('Delete your resume and its analysis? This cannot be undone.')) return
    try {
      await resumeApi.remove()
      setResume(null)
      setQuestions(null)
      setPendingFile(null)
    } catch (err) {
      toastError('Could not delete', extractErrorMessage(err))
    }
  }

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragState(null)
    chooseFile(e.dataTransfer.files?.[0])
  }, [])

  if (resume === undefined) {
    return (
      <div className="grid min-h-[50vh] place-items-center">
        <LoadingSpinner size="md" showLabel label="Loading your resume" />
      </div>
    )
  }

  const breakdown = resume?.score_breakdown?.breakdown ?? {}
  const atsWarnings = resume?.score_breakdown?.ats_warnings ?? []
  const parsed = resume?.parsed_data ?? {}
  const contactFields = [
    ['Name', parsed.name],
    ['Email', parsed.email],
    ['Phone', parsed.phone],
    ['LinkedIn', parsed.linkedin],
    ['GitHub', parsed.github],
  ]
  const presentContacts = contactFields.filter(([, v]) => v).length

  /* ---- upload zone ------------------------------------------------------- */
  const uploadZone = (
    <Card padding="lg">
      {resume ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <FileText className="h-8 w-8 shrink-0 text-aria-blue" aria-hidden="true" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{resume.original_filename}</p>
              <p className="text-xs text-aria-muted">
                Uploaded {formatDate(resume.uploaded_at)} · {resume.file_size_kb} KB
              </p>
            </div>
          </div>
          {pendingFile ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-aria-blue/40 bg-aria-blue/5 px-3 py-2 text-sm">
              <span className="truncate">{pendingFile.name}</span>
              <Button size="sm" onClick={analyse} isLoading={uploading}>
                Analyse Resume
              </Button>
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => inputRef.current?.click()}>
              Re-upload
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={deleteResume}
              leftIcon={<Trash2 className="h-3.5 w-3.5" />}
            >
              Delete Resume
            </Button>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragState(isValidFile(e.dataTransfer.items?.[0]?.getAsFile?.()) ? 'valid' : 'over')
          }}
          onDragLeave={() => setDragState(null)}
          onDrop={onDrop}
          className={cn(
            'flex min-h-[300px] flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors',
            dragState === 'valid'
              ? 'border-aria-green bg-aria-green/5'
              : dragState === 'over'
                ? 'border-aria-blue bg-aria-blue/5'
                : 'border-aria-border',
          )}
        >
          <UploadCloud className="h-16 w-16 text-aria-muted" aria-hidden="true" />
          <div>
            <p className="font-medium">Drop your resume here</p>
            <p className="mt-1 text-xs text-aria-muted">PDF or DOCX · Max 5MB</p>
          </div>
          {pendingFile ? (
            <div className="w-full space-y-2">
              <p className="truncate text-sm">
                {pendingFile.name}{' '}
                <span className="text-aria-muted">({(pendingFile.size / 1024).toFixed(0)} KB)</span>
              </p>
              <Button className="w-full" onClick={analyse} isLoading={uploading} loadingLabel="Analysing your resume">
                Analyse Resume
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
              Browse file
            </Button>
          )}
        </div>
      )}
      {uploadError ? (
        <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-aria-red">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {uploadError}
        </p>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx"
        className="hidden"
        onChange={(e) => {
          chooseFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </Card>
  )

  /* ---- first visit: single centered column ------------------------------- */
  if (!resume) {
    return (
      <div className="mx-auto max-w-xl animate-slide-up">
        <h1 className="font-display text-2xl font-semibold">Resume Analysis</h1>
        <p className="mt-1 mb-6 text-sm text-aria-muted">
          Upload your resume and ARIA will score it, flag what to fix, and generate interview
          questions from your actual projects and experience.
        </p>
        {uploading ? (
          <Card padding="lg" className="mb-4">
            <LoadingSpinner size="md" showLabel label="Analysing your resume - parsing, scoring and matching roles" />
          </Card>
        ) : null}
        {uploadZone}
      </div>
    )
  }

  /* ---- resume exists: two columns ---------------------------------------- */
  const score = resume.resume_score ?? 0
  return (
    <div className="animate-slide-up">
      <h1 className="font-display text-2xl font-semibold">Resume Analysis</h1>
      <p className="mt-1 mb-6 text-sm text-aria-muted">
        Last analysed {formatDate(resume.last_analysed_at)}
      </p>

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        {/* LEFT: upload + score */}
        <div className="space-y-6">
          {uploadZone}
          <Card padding="lg" className="flex flex-col items-center">
            <p className="mb-4 text-xs font-medium uppercase tracking-wider text-aria-muted">
              Resume Score
            </p>
            <ScoreRing value={score} size="md" />
            <p className="mt-2 font-display text-3xl font-bold">{letterGrade(score)}</p>
            <div className="mt-6 w-full space-y-3">
              {DIMENSIONS.map((d) => (
                <DimensionBar key={d.key} label={d.label} value={breakdown[d.key]} max={d.max} />
              ))}
            </div>
          </Card>
        </div>

        {/* RIGHT: tabs */}
        <div>
          <div role="tablist" aria-label="Resume analysis" className="mb-5 flex flex-wrap gap-1 rounded-xl border border-aria-border bg-aria-surface p-1">
            {TABS.map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  'rounded-lg px-3.5 py-2 text-sm font-medium transition-colors',
                  tab === t
                    ? 'bg-aria-blue/15 text-aria-text'
                    : 'text-aria-muted hover:bg-black/5 hover:text-aria-text',
                )}
              >
                {t}
              </button>
            ))}
          </div>

          {/* TAB 1 - Overview */}
          {tab === 'Overview' ? (
            <div className="space-y-3">
              <SectionCard
                title={`Contact Info (${presentContacts}/5)`}
                status={presentContacts >= 4 ? 'ok' : presentContacts >= 2 ? 'weak' : 'missing'}
                defaultOpen
              >
                <ul className="space-y-1.5 text-sm">
                  {contactFields.map(([label, value]) => (
                    <li key={label} className="flex items-center gap-2">
                      {value ? (
                        <Check className="h-3.5 w-3.5 text-aria-green" aria-hidden="true" />
                      ) : (
                        <X className="h-3.5 w-3.5 text-aria-red" aria-hidden="true" />
                      )}
                      <span className="text-aria-muted">{label}:</span>
                      <span className="truncate">{value || 'missing'}</span>
                    </li>
                  ))}
                </ul>
              </SectionCard>

              <SectionCard
                title={`Education (${parsed.education?.length ?? 0})`}
                status={parsed.education?.length ? 'ok' : 'missing'}
              >
                <ul className="space-y-2 text-sm">
                  {(parsed.education ?? []).map((e, i) => (
                    <li key={i}>
                      <p className="font-medium">{e.degree}</p>
                      <p className="text-xs text-aria-muted">
                        {e.institution} · {e.year}
                        {e.gpa ? ` · GPA ${e.gpa}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              </SectionCard>

              <SectionCard
                title={`Experience (${parsed.experience?.length ?? 0})`}
                status={
                  (parsed.experience?.length ?? 0) >= 2 ? 'ok' : parsed.experience?.length ? 'weak' : 'missing'
                }
              >
                <ul className="space-y-3 text-sm">
                  {(parsed.experience ?? []).map((e, i) => (
                    <li key={i}>
                      <p className="font-medium">
                        {e.title} <span className="text-aria-muted">- {e.company}</span>
                      </p>
                      <p className="text-xs text-aria-muted">{e.duration}</p>
                      <TechBadges items={e.technologies} />
                    </li>
                  ))}
                </ul>
              </SectionCard>

              <SectionCard
                title={`Projects (${parsed.projects?.length ?? 0})`}
                status={parsed.projects?.length ? 'ok' : 'weak'}
              >
                <ul className="space-y-3 text-sm">
                  {(parsed.projects ?? []).map((p, i) => (
                    <li key={i}>
                      <p className="font-medium">{p.name}</p>
                      <p className="text-xs text-aria-muted">{p.description}</p>
                      <TechBadges items={p.technologies} />
                    </li>
                  ))}
                </ul>
              </SectionCard>

              <SectionCard
                title="Skills"
                status={parsed.skills?.technical?.length ? 'ok' : 'missing'}
              >
                {['technical', 'tools', 'soft'].map((group) => (
                  <div key={group} className="mb-2">
                    <p className="text-xs font-medium uppercase tracking-wider text-aria-muted">
                      {group}
                    </p>
                    <TechBadges items={parsed.skills?.[group]} />
                  </div>
                ))}
              </SectionCard>

              {atsWarnings.length ? (
                <div className="rounded-xl border border-aria-red/40 bg-aria-red/5 p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold text-aria-red">
                    <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                    ATS Warnings
                  </p>
                  <p className="mt-1 text-xs text-aria-muted">
                    These elements may cause your resume to be rejected by automated screening
                    systems:
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                    {atsWarnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* TAB 2 - Issues */}
          {tab === 'Issues' ? (
            <ol className="space-y-4">
              {(resume.improvement_suggestions ?? []).map((s, i) => (
                <li key={i} className="rounded-xl border border-aria-border bg-aria-surface p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="font-mono text-sm text-aria-muted">{i + 1}.</span>
                    <span
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[11px] font-medium',
                        CATEGORY_TONES[s.category] ?? CATEGORY_TONES.Clarity,
                      )}
                    >
                      {s.category}
                    </span>
                  </div>
                  <p className="text-sm text-aria-red">{s.issue}</p>
                  <p className="mt-1.5 text-sm text-aria-green">
                    <span className="font-semibold">Fix:</span> {s.fix}
                  </p>
                  {s.example ? (
                    <p className="mt-1.5 text-sm italic text-aria-muted">"{s.example}"</p>
                  ) : null}
                </li>
              ))}
              {!resume.improvement_suggestions?.length ? (
                <p className="text-sm text-aria-muted">No issues found - strong resume.</p>
              ) : null}
            </ol>
          ) : null}

          {/* TAB 3 - Role Fit */}
          {tab === 'Role Fit' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {(resume.role_fit?.suggested_roles ?? []).map((r) => {
                const readiness = READINESS[r.readiness] ?? READINESS.needs_work
                return (
                  <Card key={r.role} padding="md">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">{ROLE_LABELS[r.role] ?? r.role}</p>
                      <span
                        className={cn(
                          'rounded-full border px-2 py-0.5 text-[11px] font-medium',
                          readiness.className,
                        )}
                      >
                        {readiness.label}
                      </span>
                    </div>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-aria-muted">Match</span>
                      <span className="font-mono tabular-nums">{r.match_percentage}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-aria-border">
                      <div
                        className="h-full rounded-full bg-aria-gradient transition-[width] duration-1000 ease-out-expo"
                        style={{ width: `${r.match_percentage}%` }}
                      />
                    </div>
                    <p className="mt-3 text-[11px] font-medium uppercase tracking-wider text-aria-muted">
                      Matching
                    </p>
                    <TechBadges items={r.matching_skills?.slice(0, 6)} tone="green" />
                    <p className="mt-2 text-[11px] font-medium uppercase tracking-wider text-aria-muted">
                      Missing
                    </p>
                    <TechBadges items={r.missing_skills?.slice(0, 6)} tone="red" />
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-4 w-full"
                      onClick={() => navigate('/select-role', { state: { role: r.role } })}
                    >
                      Practice This Role
                    </Button>
                  </Card>
                )
              })}
            </div>
          ) : null}

          {/* TAB 4 - Suggested Questions */}
          {tab === 'Suggested Questions' ? (
            <div>
              <p className="mb-4 text-sm text-aria-muted">
                ARIA generated these questions from <span className="font-semibold text-aria-text">your</span>{' '}
                resume. These are likely to come up in real interviews.
              </p>
              <label className="mb-4 flex items-center gap-2 text-sm">
                <span className="text-aria-muted">Role:</span>
                <select
                  value={questionRole ?? ''}
                  onChange={(e) => setQuestionRole(e.target.value)}
                  className="rounded-lg border border-aria-border bg-aria-surface px-3 py-1.5 text-sm focus:border-aria-blue focus:outline-none"
                >
                  {Object.entries(ROLE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              {questionsLoading ? (
                <Card padding="lg">
                  <LoadingSpinner
                    size="sm"
                    showLabel
                    label="Reading your resume and writing questions"
                  />
                </Card>
              ) : (
                <ol className="space-y-3">
                  {(questions?.questions ?? []).map((q, i) => (
                    <li key={i} className="rounded-xl border border-aria-border bg-aria-surface p-4">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium leading-relaxed">{q.question}</p>
                        <span
                          className={cn(
                            'shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize',
                            QUESTION_TYPES[q.type] ?? QUESTION_TYPES.technical,
                          )}
                        >
                          {String(q.type).replace('_', ' ')}
                        </span>
                      </div>
                      {q.resume_reference ? (
                        <p className="mt-1.5 text-xs text-aria-muted">From: {q.resume_reference}</p>
                      ) : null}
                      {q.what_to_listen_for ? (
                        <button
                          type="button"
                          onClick={() => setExpandedQ(expandedQ === i ? null : i)}
                          aria-expanded={expandedQ === i}
                          className="mt-2 flex items-center gap-1 text-xs font-medium text-aria-blue"
                        >
                          <ChevronDown
                            className={cn('h-3.5 w-3.5 transition-transform', expandedQ === i && 'rotate-180')}
                            aria-hidden="true"
                          />
                          What interviewers want to hear
                        </button>
                      ) : null}
                      {expandedQ === i ? (
                        <div className="mt-2 rounded-lg bg-aria-base p-3 text-xs leading-relaxed">
                          <p>
                            <span className="font-semibold text-aria-green">Good answer: </span>
                            {q.what_to_listen_for}
                          </p>
                          {q.red_flags ? (
                            <p className="mt-1.5">
                              <span className="font-semibold text-aria-red">Red flags: </span>
                              {q.red_flags}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-2"
                        onClick={() => setPractice(q)}
                      >
                        Practice This Question
                      </Button>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {practice ? (
        <PracticeModal question={practice} jobRole={questionRole} onClose={() => setPractice(null)} />
      ) : null}
    </div>
  )
}
