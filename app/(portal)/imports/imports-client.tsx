"use client"

/**
 * Ported verbatim from Anker components/admin/import-panel.tsx.
 * Only change: endpoints move to the portal relay (/api/anker/...), since the
 * engine stays in the tenant app. See lib/anker-proxy.ts.
 */

import { useRef, useState, useTransition } from "react"
import {
  Upload, Loader2, AlertTriangle, CheckCircle2, FileSpreadsheet,
} from "lucide-react"

interface ImportReport {
  kind: "firm" | "investor"
  source: string
  rowsRead: number
  rowsParsed: number
  rowsSkipped: number
  firmsInserted: number
  firmsAlreadyPresent: number
  investorsInserted: number
  investorsAlreadyPresent: number
  detectedColumns: Record<string, string>
  errors: { row: number; error: string }[]
  durationMs: number
  dryRun: boolean
}

export function ImportsClient() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [kind, setKind] = useState<"firm" | "investor">("firm")
  const [source, setSource] = useState("csv:custom-2026")
  const [defaultType, setDefaultType] = useState("venture capital")
  const [dryRun, setDryRun] = useState(true)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)

  function pickFile() { inputRef.current?.click() }
  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    if (f) setFile(f)
  }

  function run() {
    if (!file) { setError("Choose a CSV / XLSX first."); return }
    if (!source.trim()) { setError("Source tag required."); return }
    setError(null); setReport(null)
    start(async () => {
      try {
        const fd = new FormData()
        fd.append("file", file)
        fd.append("kind", kind)
        fd.append("source", source.trim())
        fd.append("dry_run", String(dryRun))
        if (kind === "firm") fd.append("default_firm_type", defaultType)
        const res = await fetch("/api/anker/admin/imports", { method: "POST", body: fd })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error ?? `Import failed (${res.status})`)
        setReport(data as ImportReport)
      } catch (e: any) { setError(e?.message ?? "Import failed") }
    })
  }

  return (
    <div className="space-y-5">
      <div className="border border-foreground/10 rounded-lg p-5 space-y-3">
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="File">
            <input ref={inputRef} type="file" accept=".csv,.tsv,.xlsx,.xls" className="hidden" onChange={onFileChange} />
            <button
              type="button"
              onClick={pickFile}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 border-2 border-dashed border-foreground/20 rounded-md hover:border-foreground/40 hover:bg-foreground/[0.02] transition-colors text-sm"
            >
              <Upload className="w-4 h-4" />
              {file ? `${file.name} (${(file.size / 1024).toFixed(0)} KB)` : "Choose CSV / XLSX"}
            </button>
          </Field>
          <Field label="Kind">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as any)}
              className="w-full h-10 px-3 text-sm border border-foreground/15 rounded-md bg-background"
            >
              <option value="firm">Firm rows → investment_firms</option>
              <option value="investor">Investor rows → investors</option>
            </select>
          </Field>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="Source tag" hint="lets you re-query / undo this batch later">
            <input
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="csv:partner-list-2026"
              className="w-full h-10 px-3 text-sm font-mono border border-foreground/15 rounded-md bg-background"
            />
          </Field>
          {kind === "firm" && (
            <Field label="Default firm type" hint="when no Type column is detected">
              <select
                value={defaultType}
                onChange={(e) => setDefaultType(e.target.value)}
                className="w-full h-10 px-3 text-sm border border-foreground/15 rounded-md bg-background"
              >
                <option>venture capital</option>
                <option>family office</option>
                <option>fund of funds</option>
                <option>insurance company</option>
                <option>endowment</option>
                <option>foundation</option>
                <option>pension</option>
                <option>sovereign wealth fund</option>
                <option>accelerator</option>
              </select>
            </Field>
          )}
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
          Dry run (parse + dedup, no DB writes)
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={run}
            disabled={pending || !file}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-foreground text-background text-sm hover:bg-foreground/90 disabled:opacity-50"
          >
            {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            {dryRun ? "Dry-run import" : "Import"}
          </button>
          {file && (
            <button
              type="button"
              onClick={() => { setFile(null); setReport(null); setError(null) }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 rounded-md text-xs">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <span className="text-rose-700 dark:text-rose-400">{error}</span>
        </div>
      )}

      {report && (
        <div className="border border-foreground/10 rounded-lg p-5 space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <h3 className="font-display text-base">
              {report.dryRun ? "Dry-run report" : "Import complete"}
              <span className="text-muted-foreground font-normal"> · {(report.durationMs / 1000).toFixed(1)}s</span>
            </h3>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <Stat label="rows read" v={report.rowsRead} />
            <Stat label="parsed" v={report.rowsParsed} />
            <Stat label="skipped" v={report.rowsSkipped} />
            {report.kind === "firm" ? (
              <>
                <Stat label="firms inserted" v={report.firmsInserted} good />
                <Stat label="firms already" v={report.firmsAlreadyPresent} muted />
                <Stat label="founders inserted" v={report.investorsInserted} good />
                <Stat label="founders already" v={report.investorsAlreadyPresent} muted />
              </>
            ) : (
              <>
                <Stat label="investors inserted" v={report.investorsInserted} good />
                <Stat label="investors already" v={report.investorsAlreadyPresent} muted />
              </>
            )}
          </div>

          <div>
            <div className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground mb-1.5">
              Detected columns ({Object.keys(report.detectedColumns).length})
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5 text-[11px] font-mono">
              {Object.entries(report.detectedColumns).map(([canon, header]) => (
                <div key={canon} className="border border-foreground/10 rounded px-2 py-1 flex items-center justify-between">
                  <span className="text-foreground/80">{canon}</span>
                  <span className="text-muted-foreground truncate ml-2">{header}</span>
                </div>
              ))}
            </div>
          </div>

          {report.errors.length > 0 && (
            <div>
              <div className="font-mono uppercase tracking-wider text-[10px] text-rose-600 mb-1.5">
                Errors ({report.errors.length})
              </div>
              <ul className="space-y-0.5 text-[11px] font-mono max-h-48 overflow-y-auto">
                {report.errors.map((e, i) => (
                  <li key={i}><span className="text-muted-foreground">row {e.row}:</span> {e.error}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[11px] font-mono text-muted-foreground">
            source: <span className="text-foreground/80">{report.source}</span> · re-query later via{" "}
            <code>SELECT * FROM investment_firms WHERE source = &apos;{report.source}&apos;</code>
          </p>
        </div>
      )}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-xs">{label}</span>
        {hint && <span className="text-[10px] font-mono text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </label>
  )
}
function Stat({ label, v, good, muted }: { label: string; v: number; good?: boolean; muted?: boolean }) {
  return (
    <div className={`border border-foreground/10 rounded px-3 py-2 ${good ? "bg-emerald-50/50" : ""}`}>
      <div className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">{label}</div>
      <div className={`font-display text-xl ${muted ? "text-muted-foreground" : ""}`}>{v.toLocaleString()}</div>
    </div>
  )
}
