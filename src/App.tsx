import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CourseArchiveInput } from './lib/archive'
import { runPipeline, type PipelineResult } from './lib/pipeline'
import { buildMoodleBackup, mbzFilename } from './lib/mbz/build'
import type { ConvertOptions, EdxBlockStatus } from './lib/moodle/convert'
import type { EdXBlock } from './lib/edx/parse'

type Phase = 'idle' | 'busy' | 'done' | 'error'

const QUIZ_GROUPINGS: { value: ConvertOptions['quizGrouping']; label: string }[] = [
  { value: 'sequential', label: 'Por cada sequential (Semana/Unidad)' },
  { value: 'chapter', label: 'Un quiz por capítulo' },
  { value: 'vertical', label: 'Un quiz por vertical' },
]

const RESULT_LABEL: Record<EdxBlockStatus['result'], string> = {
  converted: 'Migrado',
  partial: 'Migrado con avisos',
  skipped: 'No migrado',
}

function bytesLabel(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

function blockTypeName(block: EdXBlock): string {
  return block.type === 'other' && 'customType' in block && block.customType ? block.customType : block.type
}

function Badge({ status }: { status: EdxBlockStatus | undefined }) {
  if (!status) return <span className="tag tag-neutral">Sin diagnosticar</span>
  return (
    <span className={`tag tag-${status.result}`}>
      {status.result === 'converted' ? '✓' : status.result === 'partial' ? '⚠' : '✕'} {RESULT_LABEL[status.result]}
      {status.target ? ` → ${status.target}` : ''}
    </span>
  )
}

function Notes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null
  return (
    <ul className="notes">
      {notes.map((n, i) => (
        <li key={i}>{n}</li>
      ))}
    </ul>
  )
}

export function App() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [input, setInput] = useState<CourseArchiveInput | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PipelineResult | null>(null)
  const [builtSize, setBuiltSize] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [options, setOptions] = useState<ConvertOptions>({
    includeSequentialLabels: true,
    quizGrouping: 'sequential',
  })

  const fileRef = useRef<HTMLInputElement>(null)
  const downloadUrl = useRef<string | null>(null)
  const runRef = useRef(0)

  useEffect(() => {
    return () => {
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current)
    }
  }, [])

  useEffect(() => {
    if (!input) return
    const runId = ++runRef.current
    setPhase('busy')
    setError(null)
    setResult(null)
    setBuiltSize(null)
    ;(async () => {
      try {
        const res = await runPipeline(input, {
          ...options,
          shortname: options.shortname?.trim() || undefined,
        })
        if (runId !== runRef.current) return
        const blob = await buildMoodleBackup(res.course)
        if (runId !== runRef.current) return
        if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current)
        downloadUrl.current = URL.createObjectURL(blob)
        setBuiltSize(blob.size)
        setResult(res)
        setPhase('done')
      } catch (err) {
        if (runId !== runRef.current) return
        setError(err instanceof Error ? err.message : String(err))
        setPhase('error')
      }
    })()
  }, [input, options])

  const loadFile = useCallback((file: File) => {
    file.arrayBuffer().then((buf) => {
      setInput({ name: file.name, data: new Uint8Array(buf) })
    })
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const file = e.dataTransfer.files?.[0]
      if (file) loadFile(file)
    },
    [loadFile],
  )

  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) loadFile(file)
    },
    [loadFile],
  )

  const reset = useCallback(() => {
    runRef.current++
    setPhase('idle')
    setInput(null)
    setError(null)
    setResult(null)
    setBuiltSize(null)
    if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current)
    downloadUrl.current = null
    if (fileRef.current) fileRef.current.value = ''
  }, [])

  const statusByKey = useMemo(() => {
    if (!result) return new Map<string, EdxBlockStatus>()
    return new Map(result.diagnostics.map((d) => [d.key, d]))
  }, [result])

  const counts = useMemo(() => {
    if (!result) return null
    const leaves = result.diagnostics.filter((d) => d.type !== 'chapter' && d.type !== 'sequential')
    return {
      chapters: result.edx.chapters.length,
      sequentials: result.edx.chapters.reduce((a, c) => a + c.sequentials.length, 0),
      verticals: result.edx.chapters.reduce((a, c) => a + c.sequentials.reduce((b, s) => b + s.verticals.length, 0), 0),
      blocks: leaves.length,
      byResult: {
        converted: leaves.filter((d) => d.result === 'converted').length,
        partial: leaves.filter((d) => d.result === 'partial').length,
        skipped: leaves.filter((d) => d.result === 'skipped').length,
      },
    }
  }, [result])

  const stats = useMemo(() => {
    if (!result) return null
    const byKind: Record<string, number> = {}
    for (const act of result.course.activities) byKind[act.kind] = (byKind[act.kind] ?? 0) + 1
    const questionsByType: Record<string, number> = {}
    for (const q of result.course.questions) questionsByType[q.qtype] = (questionsByType[q.qtype] ?? 0) + 1
    const fileBytes = result.course.files.reduce((acc, f) => acc + f.bytes.byteLength, 0)
    return { byKind, questionsByType, fileBytes }
  }, [result])

  return (
    <div className="app">
      <header className="hero">
        <h1>moodlia</h1>
        <p className="tagline">
          Convierte un curso <strong>Open edX</strong> a un backup <strong>Moodle (.mbz)</strong>. Todo se procesa en tu
          navegador; los archivos no salen de tu equipo.
        </p>
      </header>

      <main>
        <section aria-label="Archivo de curso" className="card">
          <div
            className={`dropzone${dragOver ? ' dropzone-active' : ''}${input ? ' dropzone-has' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            role="button"
            tabIndex={0}
            aria-label="Zona de carga del curso Open edX"
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                fileRef.current?.click()
              }
            }}
            onClick={() => !input && fileRef.current?.click()}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".tar.gz,.tgz,.zip"
              aria-label="Seleccionar exportación del curso Open edX"
              onChange={onPick}
            />
            {input ? (
              <p className="file-note">
                {input.name} ({(input.data.byteLength / 1024).toFixed(0)} KB)
              </p>
            ) : (
              <p>Arrastra aquí tu exportación del curso (.tar.gz, .tgz o .zip) o haz clic para elegirla</p>
            )}
          </div>

          <fieldset className="options" disabled={phase === 'busy'}>
            <legend>Opciones de conversión</legend>

            <label className="checkbox">
              <input
                type="checkbox"
                checked={options.includeSequentialLabels}
                onChange={(e) => setOptions((o) => ({ ...o, includeSequentialLabels: e.target.checked }))}
              />
              Insertar etiquetas con el nombre de cada unit (sequential)
            </label>

            <label htmlFor="quiz-grouping" className="select">
              <span>Agrupar problemas en quizzes</span>
              <select
                id="quiz-grouping"
                value={options.quizGrouping}
                onChange={(e) =>
                  setOptions((o) => ({ ...o, quizGrouping: e.target.value as ConvertOptions['quizGrouping'] }))
                }
              >
                {QUIZ_GROUPINGS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>

            <label htmlFor="shortname" className="input">
              <span>Nombre corto del curso en Moodle (opcional)</span>
              <input
                id="shortname"
                type="text"
                placeholder="Se deriva automáticamente"
                value={options.shortname ?? ''}
                onChange={(e) => setOptions((o) => ({ ...o, shortname: e.target.value }))}
              />
            </label>
          </fieldset>

          <div className="actions">
            <button type="button" onClick={reset} disabled={phase === 'busy'} className="ghost">
              Empezar de nuevo
            </button>
          </div>
        </section>

        {phase === 'error' && error && (
          <section aria-label="Error" className="card error">
            <h2>No se pudo convertir</h2>
            <p>{error}</p>
          </section>
        )}

        {phase === 'busy' && (
          <section aria-live="polite" className="card busy">
            <p>Leyendo, convirtiendo y empaquetando…</p>
          </section>
        )}

        {phase === 'done' && result && counts && stats && (
          <>
            <section aria-label="Contenido del curso" className="card">
              <h2>{result.course.fullname}</h2>

              <dl className="summary">
                <div>
                  <dt>Capítulos</dt>
                  <dd>{counts.chapters}</dd>
                </div>
                <div>
                  <dt>Units</dt>
                  <dd>{counts.sequentials}</dd>
                </div>
                <div>
                  <dt>Actividades</dt>
                  <dd>
                    <ul className="inline">
                      {Object.entries(stats.byKind).map(([kind, n]) => (
                        <li key={kind}>
                          {n} {kind}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
                <div>
                  <dt>Preguntas</dt>
                  <dd>
                    <ul className="inline">
                      {Object.entries(stats.questionsByType).map(([type, n]) => (
                        <li key={type}>
                          {n} {type}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
                <div>
                  <dt>Tamaño del .mbz</dt>
                  <dd>{builtSize != null ? bytesLabel(builtSize) : '—'}</dd>
                </div>
              </dl>

              <p className="audit-line">
                {counts.blocks} elementos: <strong className="ok">{counts.byResult.converted} migrados</strong>{' '}
                · <span className="warn">{counts.byResult.partial} parciales</span> ·{' '}
                <span className="bad">{counts.byResult.skipped} no migrados</span>
              </p>

              <ul className="tree" aria-label="Elementos del curso y su estado de migración">
                {result.edx.chapters.map((ch, ci) => {
                  const cs = statusByKey.get(`chapter/${ci}/${ch.urlName}`)
                  return (
                    <li key={`ch-${ci}`}>
                      <details open>
                        <summary className="node chapter">
                          <Badge status={cs} />
                          <span>
                            Capítulo {ci + 1} · {ch.displayName}
                          </span>
                        </summary>
                        <Notes notes={cs?.notes ?? []} />
                        <ul>
                          {ch.sequentials.map((seq, si) => {
                            const ss = statusByKey.get(`sequential/${ci}/${si}/${seq.urlName}`)
                            return (
                              <li key={`seq-${ci}-${si}`}>
                                <details open>
                                  <summary className="node sequential">
                                    <Badge status={ss} />
                                    <span>{seq.displayName}</span>
                                  </summary>
                                  <Notes notes={ss?.notes ?? []} />
                                  <ul>
                                    {seq.verticals.map((vert, vi) => (
                                      <li key={`vert-${ci}-${si}-${vi}`} className="vertical">
                                        <p className="vertical-name">
                                          {vert.displayName && vert.displayName !== seq.displayName
                                            ? `Vertical · ${vert.displayName}`
                                            : 'Vertical'}
                                        </p>
                                        {vert.blocks.length === 0 && <p className="hint">Sin bloques</p>}
                                        <ul>
                                          {vert.blocks.map((blk, bi) => {
                                            const bs = statusByKey.get(`${ci}/${si}/${vi}/${blk.urlName}`)
                                            return (
                                              <li key={`blk-${ci}-${si}-${vi}-${bi}`} className="node block">
                                                <Badge status={bs} />
                                                <span>
                                                  {blockTypeName(blk)} · {blk.displayName}
                                                </span>
                                                <Notes notes={bs?.notes ?? []} />
                                              </li>
                                            )
                                          })}
                                        </ul>
                                      </li>
                                    ))}
                                  </ul>
                                </details>
                              </li>
                            )
                          })}
                        </ul>
                      </details>
                    </li>
                  )
                })}
              </ul>

              {result.warnings.length > 0 && (
                <details className="warnings">
                  <summary>{result.warnings.length} aviso{result.warnings.length === 1 ? '' : 's'}</summary>
                  <ul>
                    {result.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}

              {downloadUrl.current && builtSize != null && (
                <a className="download" href={downloadUrl.current} download={mbzFilename(result.course)}>
                  Descargar {mbzFilename(result.course)} ({bytesLabel(builtSize)})
                </a>
              )}
            </section>
          </>
        )}
      </main>

      <footer>
        <p>
          Restaura el .mbz en Moodle 2.9 o posterior (Administración del sitio → Restaurar curso). El foro «Anuncios» se
          añade automáticamente en la sección general.
        </p>
      </footer>
    </div>
  )
}