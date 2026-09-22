/**
 * SHA-1 hex en bytes. En el navegador usa webcrypto y en Node 24 también
 * (globalThis.crypto). Moodle usa SHA-1 para el `contenthash` de los ficheros.
 */
export async function sha1Hex(data: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('WebCrypto (crypto.subtle) no está disponible en este entorno')
  }
  const digest = await subtle.digest('SHA-1', data as BufferSource)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** SHA-256 hex (usado para el id del detalle del backup en moodle_backup.xml). */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('WebCrypto (crypto.subtle) no está disponible en este entorno')
  }
  const digest = await subtle.digest('SHA-256', data as BufferSource)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}