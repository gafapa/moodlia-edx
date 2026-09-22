import type { ArchiveMap } from '../archive'
import { getEntry } from '../archive'

/**
 * Transforma el HTML de un bloque `<html>` de edX para Moodle:
 * - Reescubre las referencias `/static/...` y `/c4x/<org>/<course>/asset/...`
 *   al marcador `@@PLUGINFILE@@` de Moodle.
 * - Devuelve los ficheros estáticos referenciados extraídos del tarball
 *   para ser incluidos en la actividad (componente mod_page, filearea content).
 */

export interface ExtractedFile {
  /** path de referencia original, ej. `/static/img/foo.png` */
  refPath: string
  /** path relativo usado como filepath+filename de Moodle, ej. `img/foo.png` */
  relPath: string
  bytes: Uint8Array | null
}

export interface HtmlConversion {
  html: string
  files: ExtractedFile[]
  missing: string[]
}

const REF_RE =
  /(<(?:a|img|video|audio|source|iframe|script|link|div|p|span|td|input|button)\b[^>]*\b(?:href|src|poster|data-src|data)\s*=\s*["'])(\/static\/[^"']+|\/c4x\/[^"']*\/asset\/[^"']+)(["'])/gi

export function convertEdxHtml(inputHtml: string, archive: ArchiveMap): HtmlConversion {
  const files: ExtractedFile[] = []
  const missing: string[] = []
  const seen = new Set<string>()

  const rewritten = inputHtml.replace(REF_RE, (_fullMatch, prefix, fullPath, suffix) => {
    if (seen.has(fullPath)) return `${prefix}@@PLUGINFILE@@/${relOf(fullPath)}${suffix}`
    seen.add(fullPath)

    const rel = relOf(fullPath)
    const lookup = pathToLookup(fullPath)
    const bytes = getEntry(archive, lookup)
    const file: ExtractedFile = { refPath: fullPath, relPath: rel, bytes: bytes ?? null }
    files.push(file)
    if (!bytes) missing.push(fullPath)

    return `${prefix}@@PLUGINFILE@@/${encodeMoodlePath(rel)}${suffix}`
  })

  return { html: rewritten, files, missing }
}

/** `/static/img/foo.png` → `img/foo.png` ; `/c4x/O/C/asset/foo.png` → `foo.png` */
function relOf(path: string): string {
  const staticIdx = path.indexOf('/static/')
  if (staticIdx >= 0) return path.slice(staticIdx + '/static/'.length)
  const assetIdx = path.indexOf('/asset/')
  if (assetIdx >= 0) return path.slice(assetIdx + '/asset/'.length)
  return path.replace(/^\//, '')
}

function pathToLookup(path: string): string {
  const staticIdx = path.indexOf('/static/')
  if (staticIdx >= 0) return `static/${path.slice(staticIdx + '/static/'.length)}`
  const assetIdx = path.indexOf('/asset/')
  if (assetIdx >= 0) return `static/${path.slice(assetIdx + '/asset/'.length)}`
  return path.replace(/^\//, '')
}

/** evita espacios/paréntesis en la ruta `@@PLUGINFILE@@/...` del HTML. */
function encodeMoodlePath(p: string): string {
  return p.replace(/ /g, '%20')
}