import type { ArchiveMap } from '../archive'

/**
 * Muy pequeño conjunto de helpers para leer OLX sin dependencia del DOM.
 * Cada bloque exportado por Open edX es un fichero XML cuyo elemento raíz
 * indica el tipo (chapter, sequential, vertical, html, problem, video, ...).
 * Los bloques se referencian por su `url_name`, lo que permite resolverlos
 * independientemente de la ruta física dentro del tarball.
 */

let _xmlTextDecoder: TextDecoder | undefined

function toUtf8(bytes: Uint8Array): string {
  if (bytes.length === 0) return ''
  _xmlTextDecoder ??= new TextDecoder('utf-8')
  return _xmlTextDecoder.decode(bytes)
}

/** Obtiene el nombre del elemento raíz de un documento XML. */
export function rootTag(xml: string): string | null {
  const m = /^\s*(?:<\?xml[^>]*\?>)?\s*<([a-zA-Z_][\w:-]*)/.exec(xml)
  return m ? m[1] : null
}

/** Extrae el valor de un atributo del elemento raíz. */
export function rootAttr(xml: string, attr: string): string | null {
  const re = new RegExp(`^([\\s\\S]*?<[a-zA-Z_][\\w:-]*[^>]*?>)`, 's')
  const m = re.exec(xml)
  if (!m) return null
  return attrValueIn(m[1], attr)
}

function attrValueIn(openTag: string, attr: string): string | null {
  const re = new RegExp(`\\b${attr}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`)
  const m = re.exec(openTag)
  if (!m) return null
  return m[2] ?? m[3] ?? m[4] ?? null
}

/**
 * Devuelve el contenido interno (entre apertura y cierre) del elemento raíz,
 * incluyendo posibles secciones CDATA, sin alterarlo.
 */
export function innerXml(xml: string): string {
  const openIdx = xml.indexOf('>')
  if (openIdx < 0) return ''
  const closeTag = '</' + rootTag(xml) + '>'
  const closeIdx = xml.indexOf(closeTag, openIdx)
  if (closeIdx < 0) return ''
  return xml.slice(openIdx + 1, closeIdx)
}

/** Conjunto de categorías raíz que nos interesan como bloques de contenido. */
const CONTENT_ROOTS = new Set([
  'chapter',
  'sequential',
  'vertical',
  'html',
  'problem',
  'video',
  'url',
  'discussion',
])

/** extension de ficheros XML a considerar. */
const XML_RE = /\.xml$/i

export interface BlockRecord {
  cat: string
  urlName: string
  displayName: string | null
  raw: string
}

/** Índice de todos los bloques del curso por url_name (y cat/url_name). */
export interface BlockIndex {
  byUrl: Map<string, BlockRecord[]>
  byCatUrl: Map<string, BlockRecord>
  errors: string[]
}

export function buildIndex(map: ArchiveMap): BlockIndex {
  const byUrl = new Map<string, BlockRecord[]>()
  const byCatUrl = new Map<string, BlockRecord>()
  const errors: string[] = []

  for (const [path, bytes] of map) {
    if (!XML_RE.test(path)) continue
    if (isMetadataPath(path)) continue
    const raw = toUtf8(bytes)
    if (!raw.trim()) continue
    const cat = rootTag(raw)
    if (!cat || !CONTENT_ROOTS.has(cat)) continue
    const urlName = rootAttr(raw, 'url_name') ?? filenameStem(path)
    const displayName = readDisplayName(raw)
    const record: BlockRecord = { cat, urlName, displayName, raw }
    push(byUrl, urlName, record)
    const key = `${cat}/${urlName}`
    if (byCatUrl.has(key)) errors.push(`Bloque duplicado: ${key}`)
    else byCatUrl.set(key, record)
  }

  return { byUrl, byCatUrl, errors }
}

function push(map: Map<string, BlockRecord[]>, key: string, value: BlockRecord) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/** rutas que no son bloques OLX: drafts, metadata, policy, about, curso raíz. */
function isMetadataPath(path: string): boolean {
  return (
    path.startsWith('drafts/') ||
    path.startsWith('xml_metadata/') ||
    path.startsWith('policy/') ||
    path.startsWith('about/') ||
    path.startsWith('static/') ||
    path === 'course.xml' ||
    path === 'course/course.xml'
  )
}

function filenameStem(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  return base.replace(/\.xml$/i, '')
}

function readDisplayName(raw: string): string | null {
  const attr = rootAttr(raw, 'display_name')
  if (attr != null && attr.length > 0) return decodeBasicEntities(attr)
  const m = /<metadata>[\s\S]*?<display_name>([^<]*)<\/display_name>[\s\S]*?<\/metadata>/.exec(raw)
  return m ? decodeBasicEntities(m[1].trim()) : null
}

/** Decodifica las entidades básicas XML de un texto legible. */
export function decodeBasicEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
}

export type BlockType =
  | 'chapter'
  | 'sequential'
  | 'vertical'
  | 'html'
  | 'problem'
  | 'video'
  | 'url'
  | 'discussion'
  | 'other'

export interface EdXBlockBase {
  type: BlockType
  urlName: string
  displayName: string
}

export interface EdXHtmlBlock extends EdXBlockBase {
  type: 'html'
  rawHtml: string
}
export interface EdXProblemBlock extends EdXBlockBase {
  type: 'problem'
  problemXml: string
}
export interface EdXVideoBlock extends EdXBlockBase {
  type: 'video'
  sources: string[]
  youtube: string | null
  edxVideoId: string | null
}
export interface EdXUrlBlock extends EdXBlockBase {
  type: 'url'
  url: string
}
export interface EdXDiscussionBlock extends EdXBlockBase {
  type: 'discussion'
}
export interface EdXOtherBlock extends EdXBlockBase {
  type: 'other'
}
export interface EdXCustomBlock extends EdXBlockBase {
  type: 'other'
  customType: string
}

export type EdXBlock =
  | EdXHtmlBlock
  | EdXProblemBlock
  | EdXVideoBlock
  | EdXUrlBlock
  | EdXDiscussionBlock
  | EdXCustomBlock

export interface EdXVertical {
  urlName: string
  displayName: string
  blocks: EdXBlock[]
}
export interface EdXSequential {
  urlName: string
  displayName: string
  verticals: EdXVertical[]
}
export interface EdXChapter {
  urlName: string
  displayName: string
  sequentials: EdXSequential[]
}

export interface EdXCourse {
  urlName: string
  displayName: string
  org: string
  code: string
  run: string
  language: string
  overviewHtml: string | null
  chapters: EdXChapter[]
}

export interface EdXCourseMeta {
  course: EdXCourse | null
  warnings: string[]
  errors: string[]
}

function resolveRecord(idx: BlockIndex, urlName: string): BlockRecord | null {
  const recs = idx.byUrl.get(urlName)
  if (!recs || recs.length === 0) return null
  return recs[0]
}

function toBlock(
  idx: BlockIndex,
  cat: string,
  urlName: string,
): { block: EdXBlock | null; warnings: string[] } {
  const warnings: string[] = []
  const rec = resolveRecord(idx, urlName)
  if (!rec) {
    warnings.push(`No se encontró el bloque ${cat}/${urlName}`)
    return { block: null, warnings }
  }
  const displayName = rec.displayName ?? urlName
  switch (rec.cat) {
    case 'html':
      return { block: { type: 'html', urlName, displayName, rawHtml: innerXml(rec.raw) }, warnings }
    case 'problem':
      return {
        block: { type: 'problem', urlName, displayName, problemXml: innerXml(rec.raw) },
        warnings,
      }
    case 'video':
      return { block: parseVideo(rec.raw, urlName, displayName), warnings }
    case 'url':
      return { block: parseUrl(rec.raw, urlName, displayName), warnings }
    case 'discussion':
      return { block: { type: 'discussion', urlName, displayName }, warnings }
    default:
      return {
        block: { type: 'other', customType: rec.cat, urlName, displayName },
        warnings,
      }
  }
}

function parseVideo(raw: string, urlName: string, displayName: string): EdXVideoBlock {
  const sources = [...raw.matchAll(/<source\b[^>]*\bsrc=["']([^"']+)["']/g)].map((m) => m[1])
  const youtube =
    rootAttrOfAny(raw, 'youtube_id_1_0') ??
    rootAttrOfAny(raw, 'youtube')
  const edxVideoId = rootAttrOfAny(raw, 'edx_video_id')
  return { type: 'video', urlName, displayName, sources, youtube, edxVideoId: edxVideoId ?? null }
}

/** busca un atributo en el propio bloque y en el elemento <video>. */
function rootAttrOfAny(raw: string, attr: string): string | null {
  const fromRoot = rootAttr(raw, attr)
  if (fromRoot != null && fromRoot.length > 0) return fromRoot
  const m = new RegExp(`<video\\b[^>]*\\b${attr}\\s*=\\s*["']([^"']+)["']`).exec(raw)
  return m ? m[1] : null
}

function parseUrl(raw: string, urlName: string, displayName: string): EdXUrlBlock {
  const attr = rootAttr(raw, 'url')
  const url = (attr ?? '').trim()
  return { type: 'url', urlName, displayName, url }
}

export function parseCourse(map: ArchiveMap): EdXCourseMeta {
  const warnings: string[] = []
  const errors: string[] = []

  const idx = buildIndex(map)
  errors.push(...idx.errors)

  const courseRaw = map.get('course.xml') ?? map.get('course/course.xml')
  if (!courseRaw) {
    errors.push('No se encontró course.xml (¿es realmente una exportación de curso Open edX?)')
    return { course: null, warnings, errors }
  }
  const raw = toUtf8(courseRaw)
  const displayName = rootAttr(raw, 'display_name') ?? readDisplayName(raw)
  const org = rootAttr(raw, 'org') ?? ''
  const code = rootAttr(raw, 'course') ?? ''
  const run = rootAttr(raw, 'run') ?? ''
  const urlName = rootAttr(raw, 'url_name') ?? 'course'
  const language = rootAttr(raw, 'language') ?? ''

  const overviewHtml = readOverview(map)
  const chapters: EdXChapter[] = []

  const chapterRefs = collectChildRefs(raw, 'chapter')
  for (const ref of chapterRefs) {
    const rec = resolveRecord(idx, ref)
    if (!rec) {
      warnings.push(`Capítulo "${ref}" no encontrado en el tarball`)
      continue
    }
    chapters.push(parseChapter(idx, rec, warnings))
  }

  return {
    course: {
      urlName,
      displayName: displayName ?? ((org + ' ' + code).trim() || 'Curso edX'),
      org,
      code,
      run,
      language,
      overviewHtml,
      chapters,
    },
    warnings,
    errors,
  }
}

function parseChapter(idx: BlockIndex, rec: BlockRecord, warnings: string[]): EdXChapter {
  const sequentials: EdXSequential[] = []
  const displayName = rec.displayName ?? rec.urlName
  for (const ref of collectChildRefs(rec.raw, 'sequential')) {
    const srec = resolveRecord(idx, ref)
    if (!srec) {
      warnings.push(`Sequential "${ref}" no encontrado`)
      continue
    }
    sequentials.push(parseSequential(idx, srec, warnings))
  }
  return { urlName: rec.urlName, displayName, sequentials }
}

function parseSequential(idx: BlockIndex, rec: BlockRecord, warnings: string[]): EdXSequential {
  const verticals: EdXVertical[] = []
  const displayName = rec.displayName ?? rec.urlName
  for (const ref of collectChildRefs(rec.raw, 'vertical')) {
    const vrec = resolveRecord(idx, ref)
    if (!vrec) {
      warnings.push(`Vertical "${ref}" no encontrado`)
      continue
    }
    verticals.push(parseVertical(idx, vrec, warnings))
  }
  return { urlName: rec.urlName, displayName, verticals }
}

function parseVertical(idx: BlockIndex, rec: BlockRecord, warnings: string[]): EdXVertical {
  const blocks: EdXBlock[] = []
  const displayName = rec.displayName ?? rec.urlName
  for (const child of childrenOf(rec.raw)) {
    const ref = child.urlName
    if (ref == null) {
      warnings.push(`Referencia sin url_name en vertical "${displayName}" (${child.tag})`)
      continue
    }
    const { block, warnings: w } = toBlock(idx, child.tag, ref)
    warnings.push(...w)
    if (block) blocks.push(block)
  }
  return { urlName: rec.urlName, displayName, blocks }
}

interface ChildRef {
  tag: string
  urlName: string | null
}

/** Lista los elementos hijo de un bloque con su atributo url_name. */
function collectChildRefs(raw: string, tag: string): string[] {
  return childrenOf(raw)
    .filter((c) => c.tag === tag)
    .map((c) => c.urlName)
    .filter((c): c is string => c != null)
}

function childrenOf(raw: string): ChildRef[] {
  const inner = innerXml(raw)
  const out: ChildRef[] = []
  const re = /<([a-zA-Z_][\w:-]*)\b([^>]*)>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(inner)) !== null) {
    const full = m[0]
    // saltar cierres y auto-contenidos (como <metadata/>)
    const tag = m[1]
    const rest = m[2]
    if (full.startsWith('</')) continue
    const urlName = attrValueIn(full, 'url_name')
    out.push({ tag, urlName })
    // para elementos sin cierre (self-closing) o vacíos no hay hijos
    void rest
  }
  return out
}

function readOverview(map: ArchiveMap): string | null {
  const candidate = map.get('about/overview.html')
  if (!candidate) return null
  const text = toUtf8(candidate)
  return stripTags(text).trim() || null
}

function stripTags(html: string): string {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, ' ')
  const withSpaces = withoutComments.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return decodeBasicEntities(withSpaces)
}