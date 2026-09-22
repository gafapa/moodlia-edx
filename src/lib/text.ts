const ACCENTS: Record<string, string> = {
  á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', ñ: 'n',
  Á: 'A', É: 'E', Í: 'I', Ó: 'O', Ú: 'U', Ü: 'U', Ñ: 'N',
  à: 'a', è: 'e', ì: 'i', ò: 'o', ù: 'u', ç: 'c',
}

/** Elimina acentos y convierte a un slug de nombre corto de curso Moodle. */
export function makeShortname(s: string): string {
  const cleaned = s
    .replace(/[\u0300-\u036f]/g, '')
    .split('')
    .map((c) => ACCENTS[c] ?? c)
    .join('')
    .replace(/[^a-zA-Z0-9_.-]+/g, '')
    .replace(/[_.-]{2,}/g, '.')
    .replace(/^[._-]+|[._-]+$/g, '')
  return (cleaned || 'curso').slice(0, 60).toUpperCase()
}

/** Nombre plano a partir de un display_name de edX. */
export function plainName(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 255)
}

/** Descubre una fecha epoch (segundos) a partir de una cadena ISO de edX. */
export function startDateFromIso(iso: string | null | undefined, now = Date.now()): number {
  if (!iso) return Math.floor(now / 1000)
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return Math.floor(now / 1000)
  return Math.floor(t / 1000)
}