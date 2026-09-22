/** Asignador de ids enteros deterministas para las entidades del MBZ. */
export class IdAlloc {
  private next: number
  constructor(start: number) {
    this.next = start
  }
  /** devuelve y consume el siguiente id. */
  take(): number {
    return this.next++
  }
  /** mira el siguiente id sin consumirlo. */
  peek(): number {
    return this.next
  }
}