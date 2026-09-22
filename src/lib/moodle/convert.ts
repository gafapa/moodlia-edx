import type { ArchiveMap } from '../archive'
import type { EdXBlock, EdXChapter, EdXCourse, EdXHtmlBlock, EdXProblemBlock, EdXVertical } from '../edx/parse'
import { parseProblem } from '../edx/problems'
import { convertEdxHtml } from '../edx/html'
import { IdAlloc } from './ids'
import type {
  AnyMoodleActivity,
  MoodleCourse,
  MoodleFile,
  MoodleLabelActivity,
  MoodlePageActivity,
  MoodleQuestion,
  MoodleQuizActivity,
  MoodleSection,
  MoodleUrlActivity,
} from './types'
import { makeShortname, plainName, startDateFromIso } from '../text'
import { sha1Hex } from '../hash'

export interface ConvertOptions {
  /** inserta una etiqueta (label) con el nombre de cada sequential. */
  includeSequentialLabels: boolean
  /** cómo agrupar los problemas para formar los quizzes. */
  quizGrouping: 'sequential' | 'chapter' | 'vertical'
  /** nombre corto del curso Moodle; si se omite se deriva de edX. */
  shortname?: string
}

interface BlockPos {
  chapterIdx: number
  seqIdx: number
  verticalIdx: number
}

interface PendingFile {
  bytes: Uint8Array
  contextid: number
  component: string
  filearea: string
  itemid: number
  filepath: string
  filename: string
}

export interface ConversionResult {
  course: MoodleCourse
  warnings: string[]
  /** diagnóstico por elemento del curso edX y sus bloques. */
  diagnostics: EdxBlockStatus[]
}

/** Resultado de la migración de un elemento (capítulo, unit, bloque). */
export type EdxBlockStatusResult = 'converted' | 'partial' | 'skipped'

export interface EdxBlockStatus {
  /** clave única `capítulo/unit/vertical/url_name`. */
  key: string
  type: string
  displayName: string
  result: EdxBlockStatusResult
  /** actividad de Moodle generada: section, label, page, url, quiz… */
  target?: string
  notes: string[]
}

const DEFAULT_QUIZ_GRADE = 10

export async function convertCourse(
  edx: EdXCourse,
  archive: ArchiveMap,
  opts: ConvertOptions,
): Promise<ConversionResult> {
  const warnings: string[] = []
  const diagnostics: EdxBlockStatus[] = []
  const shortname = makeShortname(opts.shortname || [edx.org, edx.code, edx.run].join('-'))
  const fullname = plainName(edx.displayName)

  const now = Math.floor(Date.now() / 1000)
  const startdate = startDateFromIso(edxStart(edx), now)

  const ctxAlloc = new IdAlloc(7000)
  const moduleAlloc = new IdAlloc(4000)
  const sectionAlloc = new IdAlloc(3000)
  const instanceAlloc = new IdAlloc(5100)
  const questionAlloc = new IdAlloc(6100)
  const qcatAlloc = new IdAlloc(7200)
  const gradeAlloc = new IdAlloc(8300)
  const enrolAlloc = new IdAlloc(9400)
  const fileAlloc = new IdAlloc(11000)

  const courseContextId = ctxAlloc.take()
  const originalCourseId = 2 + (Math.abs(hashCode(shortname)) % 900)

  const sections: MoodleSection[] = []
  const activities: AnyMoodleActivity[] = []
  const quizzes: MoodleQuizActivity[] = []
  const questions: MoodleQuestion[] = []
  const questionCategories: MoodleCourse['questionCategories'] = []
  const pendingFiles: PendingFile[] = []
  const fileRefs = new Map<string, { refPath: string; contextid: number; itemid: number }>()

  const gradeRootCategoryId = gradeAlloc.take()
  const courseGradeItemId = gradeAlloc.take()
  const enrolIds = { manual: enrolAlloc.take(), guest: enrolAlloc.take() }

  // categoría del banco de preguntas a nivel de curso
  const courseQcatId = qcatAlloc.take()
  questionCategories.push({
    id: courseQcatId,
    name: 'Preguntas importadas de edX',
    contextid: courseContextId,
    contextlevel: 50,
    contextinstanceid: originalCourseId,
  })

  interface QuizBucket {
    quiz: MoodleQuizActivity
    moduleId: number
  }
  const buckets = new Map<string, QuizBucket>()

  function quizNameFor(edxName: string | null): string {
    return (edxName ?? 'Examen').slice(0, 120)
  }

  const pushed = (section: MoodleSection, act: AnyMoodleActivity, moduleId: number) => {
    act.id = moduleId
    section.sequence.push(moduleId)
    activities.push(act)
  }

  function ensureBucket(
    key: string,
    section: MoodleSection,
    name: string,
  ): QuizBucket {
    let bucket = buckets.get(key)
    if (bucket) return bucket
    const moduleId = moduleAlloc.take()
    const instanceId = instanceAlloc.take()
    const ctxId = ctxAlloc.take()
    const qcatId = qcatAlloc.take()
    const quiz: MoodleQuizActivity = {
      kind: 'quiz',
      id: moduleId,
      instance: instanceId,
      contextid: ctxId,
      sectionId: section.id,
      sectionNumber: section.number,
      name,
      moduleVersion: '2012061703',
      questions: [],
      questionIds: [],
      grade: DEFAULT_QUIZ_GRADE,
      categoryId: qcatId,
      contentHtml: '',
    }
    questionCategories.push({
      id: qcatId,
      name: `Categoría de "${name}"`,
      contextid: ctxId,
      contextlevel: 70,
      contextinstanceid: moduleId,
    })
    bucket = { quiz, moduleId }
    buckets.set(key, bucket)
    pushed(section, quiz, moduleId)
    quizzes.push(quiz)
    return bucket
  }

  function addProblemQuestion(bucket: QuizBucket, block: EdXProblemBlock): { count: number; notes: string[] } {
    const { questions: parsed, warnings: w } = parseProblem(block.displayName, block.problemXml)
    warnings.push(...w.map((x) => `«${block.displayName}»: ${x}`))
    for (const q of parsed) {
      q.id = questionAlloc.take()
      for (const a of q.answers) a.id = questionAlloc.take()
      bucket.quiz.questions.push(q)
      bucket.quiz.questionIds.push(q.id)
      questions.push(q)
    }
    return { count: parsed.length, notes: w }
  }

  function addPage(section: MoodleSection, block: EdXHtmlBlock) {
    const moduleId = moduleAlloc.take()
    const instanceId = instanceAlloc.take()
    const ctxId = ctxAlloc.take()
    const conv = convertEdxHtml(block.rawHtml, archive)
    for (const m of conv.missing) {
      warnings.push(`Fichero estático no encontrado en el curso: ${m}`)
    }
    for (const f of conv.files) {
      if (!f.bytes) continue
      const filepath = '/' + dirOf(f.relPath)
      const filename = baseOf(f.relPath)
      pendingFiles.push({
        bytes: f.bytes,
        contextid: ctxId,
        component: 'mod_page',
        filearea: 'content',
        itemid: instanceId,
        filepath,
        filename,
      })
      // el mapa de referencias permite al generador de MBZ avisar de colisiones
      fileRefs.set(`${ctxId}:${filepath}${filename}`, { refPath: f.refPath, contextid: ctxId, itemid: instanceId })
    }
    const page: MoodlePageActivity = {
      kind: 'page',
      id: moduleId,
      instance: instanceId,
      contextid: ctxId,
      sectionId: section.id,
      sectionNumber: section.number,
      name: plainName(block.displayName) || `Página ${block.urlName}`,
      moduleVersion: '2015051100',
      content: conv.html,
      contentformat: 1,
      files: [],
    }
    pushed(section, page, moduleId)
  }

  function addUrl(section: MoodleSection, name: string, url: string): boolean {
    if (!/^(https?|mailto):/i.test(url)) {
      warnings.push(`URL no válida descartada en "${name}": ${url}`)
      return false
    }
    const moduleId = moduleAlloc.take()
    const instanceId = instanceAlloc.take()
    const ctxId = ctxAlloc.take()
    const act: MoodleUrlActivity = {
      kind: 'url',
      id: moduleId,
      instance: instanceId,
      contextid: ctxId,
      sectionId: section.id,
      sectionNumber: section.number,
      name: plainName(name) || 'Enlace',
      moduleVersion: '2015051100',
      externalurl: url,
    }
    pushed(section, act, moduleId)
    return true
  }

  function addLabel(section: MoodleSection, text: string, atIndex: number) {
    if (!text.trim()) return
    const moduleId = moduleAlloc.take()
    const instanceId = instanceAlloc.take()
    const ctxId = ctxAlloc.take()
    const label: MoodleLabelActivity = {
      kind: 'label',
      id: moduleId,
      instance: instanceId,
      contextid: ctxId,
      sectionId: section.id,
      sectionNumber: section.number,
      name: text.slice(0, 255),
      moduleVersion: '2015051100',
      intro: text,
    }
    activities.push(label)
    section.sequence.splice(atIndex, 0, moduleId)
  }

  function videoUrl(block: Extract<EdXBlock, { type: 'video' }>): string | null {
    if (block.youtube) return `https://www.youtube.com/watch?v=${block.youtube}`
    const src = block.sources.find((s) => /^https?:/i.test(s))
    if (src) return src
    return null
  }

  // capítulos → secciones (hoisting cubre buildSection y processChapter)
  edx.chapters.forEach((chapter, chapterIdx) => {
    const sec = buildSection(chapterIdx, chapter)
    processChapter(chapter, sec, chapterIdx)
  })

  function buildSection(idx: number, chapter: EdXChapter): MoodleSection {
    const section: MoodleSection = {
      id: sectionAlloc.take(),
      number: idx,
      name: chapter.displayName || null,
      summary: '',
      sequence: [],
    }
    sections.push(section)
    diagnostics.push({
      key: `chapter/${idx}/${chapter.urlName}`,
      type: 'chapter',
      displayName: chapter.displayName,
      result: 'converted',
      target: 'section',
      notes: [],
    })
    return section
  }

  function processChapter(chapter: EdXChapter, section: MoodleSection, chapterIdx: number) {
    chapter.sequentials.forEach((seq, seqIdx) => {
      const labelIndex = section.sequence.length
      if (opts.includeSequentialLabels) {
        addLabel(section, seq.displayName, labelIndex)
      }
      const notes: string[] = []
      if (seq.verticals.length === 0 && seq.displayName) {
        notes.push('Sin unidades (verticales); no se genera contenido en Moodle')
        warnings.push(`Sequential vacío "${seq.displayName}" (sin verticales)`)
      }
      diagnostics.push({
        key: `sequential/${chapterIdx}/${seqIdx}/${seq.urlName}`,
        type: 'sequential',
        displayName: seq.displayName,
        result: seq.verticals.length === 0 ? 'skipped' : 'converted',
        target: opts.includeSequentialLabels ? 'label' : undefined,
        notes,
      })
      for (const vertical of seq.verticals) {
        processVertical(section, vertical, chapterIdx, seqIdx, 0)
      }
    })
  }

  function processVertical(
    section: MoodleSection,
    vertical: EdXVertical,
    chapterIdx: number,
    seqIdx: number,
    verticalIdx: number,
  ) {
    const pos: BlockPos = { chapterIdx, seqIdx, verticalIdx }
    vertical.blocks.forEach((block) => {
      const base: EdxBlockStatus = {
        key: `${pos.chapterIdx}/${pos.seqIdx}/${pos.verticalIdx}/${block.urlName}`,
        type: block.type,
        displayName: block.displayName,
        result: 'converted',
        notes: [],
      }
      switch (block.type) {
        case 'html':
          base.target = 'page'
          addPage(section, block)
          break
        case 'problem': {
          const key = bucketKey(chapterIdx, seqIdx, vertical)
          const bucket = ensureBucket(key, section, quizNameFor(bucketName(chapterIdx, seqIdx, vertical)))
          const r = addProblemQuestion(bucket, block)
          base.target = 'quiz'
          if (r.count === 0) {
            base.result = 'skipped'
            base.notes.push('No se pudieron extraer preguntas (formato no soportado aún)')
          } else if (r.notes.length > 0) {
            base.result = 'partial'
          }
          base.notes.push(...r.notes)
          break
        }
        case 'video': {
          const url = videoUrl(block)
          if (url) {
            base.target = 'url'
            if (!addUrl(section, block.displayName, url)) {
              base.result = 'skipped'
              base.notes.push('URL no válida; no se generó la actividad')
            }
          } else {
            base.result = 'skipped'
            base.notes.push('Sin fuente pública detectable (fuentes o YouTube)')
            warnings.push(
              `Vídeo "${block.displayName}" sin URL pública detectable (fuentes o YouTube); no se convierte`,
            )
          }
          break
        }
        case 'url':
          base.target = 'url'
          if (!addUrl(section, block.displayName, block.url)) {
            base.result = 'skipped'
            base.notes.push('URL no válida; no se generó la actividad')
          }
          break
        case 'discussion':
          base.result = 'skipped'
          base.notes.push(
            'Los foros de edX no se migran; Moodle incluye un foro «Anuncios» en la sección general',
          )
          warnings.push(
            `Foro de discusión "${block.displayName}" no se convierte (crea un foro "Anuncios" en Moodle)`,
          )
          break
        default:
          base.type = block.customType ?? 'other'
          base.result = 'skipped'
          base.notes.push(`Tipo "${base.type}" no soportado por la conversión`)
          warnings.push(
            `Bloque "${block.displayName}" de tipo "${block.customType}" no se convierte`,
          )
      }
      diagnostics.push(base)
    })
  }

  function bucketKey(chapterIdx: number, seqIdx: number, vertical: EdXVertical): string {
    switch (opts.quizGrouping) {
      case 'chapter':
        return `chapter:${chapterIdx}`
      case 'vertical':
        return `vertical:${chapterIdx}/${seqIdx}/${vertical.urlName}`
      default:
        return `sequential:${chapterIdx}/${seqIdx}`
    }
  }

  function bucketName(chapterIdx: number, seqIdx: number, vertical: EdXVertical): string | null {
    switch (opts.quizGrouping) {
      case 'chapter':
        return edx.chapters[chapterIdx]?.displayName ?? null
      case 'vertical':
        return vertical.displayName ?? null
      default: {
        const seq = edx.chapters[chapterIdx]?.sequentials[seqIdx]
        return seq?.displayName ?? edx.chapters[chapterIdx]?.displayName ?? null
      }
    }
  }

  // hash de los ficheros y asignación de ids definitiva
  const files: MoodleFile[] = []
  for (const pf of pendingFiles) {
    const contenthash = await sha1Hex(pf.bytes)
    files.push({
      id: fileAlloc.take(),
      contenthash,
      contextid: pf.contextid,
      component: pf.component,
      filearea: pf.filearea,
      itemid: pf.itemid,
      filepath: pf.filepath,
      filename: pf.filename,
      bytes: pf.bytes,
      mimetype: deriveMime(pf.filename),
    })
    // enlazar ficheros a sus páginas
    for (const act of activities) {
      if (act.kind === 'page' && act.instance === pf.itemid) {
        act.files.push(files[files.length - 1])
      }
    }
  }

  // introducción del curso: overview de edX
  const summary = plainName(edx.overviewHtml ?? '')

  const course: MoodleCourse = {
    originalCourseId,
    courseContextId,
    shortname,
    fullname,
    summary,
    startdate,
    numsections: Math.max(0, sections.length - 1),
    sections,
    activities,
    quizzes,
    questions,
    questionCategories,
    files,
    gradeRootCategoryId,
    courseGradeItemId,
    enrolIds,
    warnings,
  }

  return { course, warnings, diagnostics }
}

function dirOf(rel: string): string {
  const i = rel.lastIndexOf('/')
  return i >= 0 ? rel.slice(0, i) : ''
}

function baseOf(rel: string): string {
  const i = rel.lastIndexOf('/')
  return i >= 0 ? rel.slice(i + 1) : rel
}

function deriveMime(name: string): string {
  const i = name.lastIndexOf('.')
  if (i < 0) return 'application/octet-stream'
  const ext = name.slice(i).toLowerCase()
  const table: Record<string, string> = {
    '.html': 'text/html',
    '.htm': 'text/html',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.ico': 'image/vnd.microsoft.icon',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.zip': 'application/zip',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.odt': 'application/vnd.oasis.opendocument.text',
    '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
    '.odp': 'application/vnd.oasis.opendocument.presentation',
  }
  return table[ext] ?? 'application/octet-stream'
}

function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  }
  return h
}

function edxStart(edx: EdXCourse): string | null {
  return (edx as EdXCourse & { start?: string }).start ?? null
}