/**
 * Utilidades para construir XML al estilo de los backups de Moodle.
 * En los backups Moodle los valores nulos de la BD se serializan como
 * el marcador literal `$@NULL@$` y los textos se escapan como contenido XML.
 */

export const NULL = '$@NULL@$'

/** Escapa texto para usarlo como contenido de un elemento XML. */
export function esc(value: string | number | boolean): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Escapa un valor para usarlo como atributo XML. */
export function escAttr(value: string | number): string {
  return esc(value).replace(/"/g, '&quot;')
}

/**
 * Construye `<tag>content</tag>`.
 * - `content === NULL` imprime el marcador tal cual.
 * - `content === undefined` emite una etiqueta vacía `<tag></tag>`.
 * - Cualquier otro valor se escapa.
 */
export function el(tag: string, content?: string | number | boolean): string {
  if (content === undefined) return `<${tag}></${tag}>`
  if (content === NULL) return `<${tag}>${NULL}</${tag}>`
  return `<${tag}>${esc(content)}</${tag}>`
}

/** Cierra un elemento de apertura. */
export function open(tag: string, indent = 0): string {
  return '  '.repeat(indent) + `<${tag}>`
}

/** `<tag k="v" ...>` con atributos bien colocados (antes del `>`). */
export function openAttr(tag: string, attrs: Record<string, string | number>, indent = 0): string {
  const as = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${escAttr(v)}"`)
    .join('')
  return '  '.repeat(indent) + `<${tag}${as}>`
}

export function close(tag: string, indent = 0): string {
  return '  '.repeat(indent) + `</${tag}>`
}

/** Cabecera estándar de los ficheros XML de Moodle. */
export function header(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>`
}

/** Devuelve una lista de líneas unidas, útil para componer documentos. */
export function doc(body: string[]): string {
  return `${header()}\n${body.filter((l) => l !== '').join('\n')}`
}