import { gunzipSync, unzipSync } from 'fflate'

/** Mapa de rutas normalizadas (minúsculas, `/`) → contenido en bytes. */
export type ArchiveMap = Map<string, Uint8Array>

export interface CourseArchiveInput {
  name: string
  data: Uint8Array
}

const MAGIC_GZIP = [0x1f, 0x8b]
const MAGIC_ZIP = [0x50, 0x4b]

function isGzip(data: Uint8Array): boolean {
  return data.length > 2 && data[0] === MAGIC_GZIP[0] && data[1] === MAGIC_GZIP[1]
}

function isZip(data: Uint8Array): boolean {
  return data.length > 4 && data[0] === MAGIC_ZIP[0] && data[1] === MAGIC_ZIP[1]
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '')
}

interface TarEntry {
  name: string
  data: Uint8Array
  type: string
}

const TAR_BLOCK = 512

/** Parser de tar (cabeceras POSIX/ustar, GNU longname y PAX path). */
export function parseTar(data: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = []
  let offset = 0
  let pendingName: string | null = null

  while (offset + TAR_BLOCK <= data.length) {
    const block = data.subarray(offset, offset + TAR_BLOCK)
    // fin del tar (bloques de ceros)
    if (block.every((b) => b === 0)) break

    let name = parseAscii(block, 0, 100)
    const size = parseTarSize(block, 124)
    const type = String.fromCharCode(block[156])
    const dataStart = offset + TAR_BLOCK
    const dataEnd = dataStart + size
    if (dataEnd > data.length) break

    switch (type) {
      case 'L': // GNU long name
        pendingName = parseAscii(data, dataStart, Math.min(size, 4096))
        break
      case 'x': {
        // PAX extended header: buscar "path="
        const text = parseAscii(data, dataStart, size)
        const m = /(?:^|\s)path=([^\s\x00]+)/.exec(text)
        if (m) pendingName = m[1].trim()
        break
      }
      case '0':
      case '':
      case '7':
        entries.push({
          name: pendingName ?? name,
          data: data.slice(dataStart, dataEnd),
          type: 'file',
        })
        pendingName = null
        break
      default:
        // directorios ('5') y demás cabeceras se ignoran
        pendingName = null
        break
    }
    offset = dataEnd + ((TAR_BLOCK - (size % TAR_BLOCK)) % TAR_BLOCK)
  }

  return entries
}

function parseTarSize(block: Uint8Array, at: number): number {
  const first = block[at]
  if (first === 0x80 || first === 0xff) {
    // codificación base-256
    let n = 0
    for (let i = at + 8; i < at + 12 && i < block.length; i++) {
      n = (n * 256) + block[i]
    }
    return n
  }
  const text = parseAscii(block, at, 12).trim().replace(/\0+$/, '')
  const parsed = parseInt(text, 8)
  return Number.isNaN(parsed) ? 0 : parsed
}

function parseAscii(bytes: Uint8Array, at: number, len: number): string {
  const slice = bytes.subarray(at, at + len)
  let end = 0
  while (end < slice.length && slice[end] !== 0) end++
  return new TextDecoder('utf-8').decode(slice.subarray(0, end))
}

/** Extrae un .tar.gz a un mapa de rutas → bytes. */
export function readTarGz(data: Uint8Array): ArchiveMap {
  const raw = gunzipSync(data)
  const map: ArchiveMap = new Map()
  for (const e of parseTar(raw)) {
    if (!['file', '0', ''].includes(e.type)) continue
    const p = normalizePath(e.name)
    if (!p) continue
    map.set(p.toLowerCase(), e.data)
  }
  return map
}

/** Extrae un .zip a un mapa de rutas → bytes. */
export function readZip(data: Uint8Array): ArchiveMap {
  const files = unzipSync(data)
  const map: ArchiveMap = new Map()
  for (const [name, bytes] of Object.entries(files)) {
    const p = normalizePath(name)
    if (!p) continue
    map.set(p.toLowerCase(), bytes)
  }
  return map
}

/**
 * Lee un archivo de curso Open edX (`.tar.gz`, `.tgz`) o `.zip` y devuelve
 * el mapa de ficheros. Todo ocurre en cliente; nada se envía a ningún servidor.
 */
export function readCourseArchive(input: CourseArchiveInput): ArchiveMap {
  const { name, data } = input
  const lower = name.toLowerCase()
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz') || isGzip(data)) {
    return readTarGz(data)
  }
  if (lower.endsWith('.zip') || isZip(data)) {
    return readZip(data)
  }
  throw new Error(
    `Formato no soportado (${name}). Sube la exportación del curso edX en .tar.gz, .tgz o .zip.`,
  )
}

/** Lee los bytes de una ruta del mapa sin importar mayúsculas. */
export function getEntry(map: ArchiveMap, path: string): Uint8Array | undefined {
  return map.get(path.toLowerCase())
}