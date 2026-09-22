import { XMLParser } from 'fast-xml-parser'
import type { MoodleQuestion } from '../moodle/types'
import { decodeBasicEntities } from './parse'

/**
 * Convierte el XML interno de un bloque `<problem>` de edX en preguntas
 * Moodle. Tipos soportados: opción múltiple/única (multiplechoiceresponse,
 * choiceresponse, optionresponse), respuesta corta (stringresponse) y
 * numérica (numericalresponse). El resto se descarta con un aviso.
 */

export interface ProblemParseResult {
  questions: MoodleQuestion[]
  warnings: string[]
}

interface FXNode {
  [key: string]: unknown
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  cdataPropName: '#cdata',
  textNodeName: '#text',
  numberParseOptions: { leadingZeros: false, hex: false },
})

/** Devuelve el texto legible de un valor devuelto por fast-xml-parser. */
function textOf(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) {
    return value
      .map((v) => textOf(v))
      .filter(Boolean)
      .join(' ')
  }
  const obj = value as FXNode
  const parts: string[] = []
  for (const key of Object.keys(obj)) {
    if (key.startsWith('@_')) continue
    if (key === '#text' || key === '#cdata') {
      const v = obj[key]
      if (typeof v === 'string' || typeof v === 'number') parts.push(String(v))
    } else {
      const t = textOf(obj[key])
      if (t) parts.push(t)
    }
  }
  return parts.join(' ')
}

function firstChild(parent: FXNode | undefined, name: string): FXNode | null {
  if (!parent) return null
  const v = parent[name]
  if (v == null) return null
  if (Array.isArray(v)) return (v[0] as FXNode) ?? null
  if (typeof v === 'object') return v as FXNode
  return null
}

function childrenNodes(parent: FXNode | undefined, name: string): FXNode[] {
  if (!parent) return []
  const v = parent[name]
  if (v == null) return []
  if (Array.isArray(v)) return v as FXNode[]
  return [v as FXNode]
}

function cleanText(value: unknown): string {
  return decodeBasicEntities(textOf(value)).replace(/\s+/g, ' ').trim()
}

function attr(node: FXNode, name: string): string | null {
  const v = node[`@_${name}`]
  if (typeof v === 'string') return v
  return null
}

function parseTolerance(node: FXNode): number {
  // <responseparam type="tolerance" default="0.01"/>
  const params = childrenNodes(node, 'responseparam')
  for (const p of params) {
    if (attr(p, 'type') === 'tolerance') {
      const t = parseFloat(attr(p, 'default') ?? '')
      if (!Number.isNaN(t)) return t
    }
  }
  const direct = parseFloat(attr(node, 'tolerance') ?? '')
  return Number.isNaN(direct) ? 0 : direct
}

function parseOptionsList(raw: string | null): string[] {
  if (!raw) return []
  const trimmed = raw.trim()
  // forma ('a','b','c')
  const parens = /^\(\s*(.*?)\s*\)$/.exec(trimmed)
  if (parens) {
    return splitQuotedList(parens[1])
  }
  // forma ["a","b"]
  const brackets = /^\[\s*(.*?)\s*\]$/.exec(trimmed)
  if (brackets) return splitQuotedList(brackets[1])
  // forma simple 'a,b,c'
  return splitQuotedList(trimmed)
}

function splitQuotedList(s: string): string[] {
  const re = /'([^']*)'|"([^"]*)"|([^,]+)/g
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    const v = (m[1] ?? m[2] ?? m[3] ?? '').trim()
    if (v) out.push(v)
  }
  return out
}

/** Extrae el enunciado de una pregunta dentro del `<problem>`. */
function extractStem(problem: FXNode, responseName: string, fallback: string): string {
  const parts: string[] = []
  for (const key of Object.keys(problem)) {
    if (responseName !== key) {
      if (key === '#text' || key === '#cdata' || /^[a-zA-Z]/.test(key)) {
        const t = cleanText(problem[key])
        if (t) parts.push(t)
      }
    }
    if (key === responseName) break
  }
  return parts.join(' · ') || fallback
}

export function parseProblem(displayName: string, problemXml: string): ProblemParseResult {
  const warnings: string[] = []
  let parsed: unknown
  try {
    parsed = parser.parse(`<problem>${problemXml}</problem>`)
  } catch {
    return {
      questions: [],
      warnings: [`No se pudo parsear el problema "${displayName}"`],
    }
  }
  const problem = (parsed as FXNode).problem as FXNode | undefined
  if (!problem) {
    return {
      questions: [],
      warnings: [`Problema "${displayName}" vacío o ilegible`],
    }
  }

  const questions: MoodleQuestion[] = []
  const solutionText = cleanText(problem.solution || problem.detailedsolution)

  type Candidate = { kind: string; node: FXNode }
  const candidates: Candidate[] = []

  // tipos de respuesta con soporte
  candidates.push(
    ...[
      ...childrenNodes(problem, 'multiplechoiceresponse'),
      ...childrenNodes(problem, 'choiceresponse'),
    ].map((n) => ({ kind: 'mc', node: n })),
  )
  candidates.push(
    ...childrenNodes(problem, 'optionresponse').map((n) => ({ kind: 'option', node: n })),
  )
  candidates.push(
    ...childrenNodes(problem, 'stringresponse').map((n) => ({ kind: 'string', node: n })),
  )
  candidates.push(
    ...childrenNodes(problem, 'numericalresponse').map((n) => ({ kind: 'numerical', node: n })),
  )

  for (const { kind, node } of candidates) {
    const stem = extractStem(problem, kind, displayName)
    let q: MoodleQuestion | null = null
    switch (kind) {
      case 'mc':
        q = multichoice(stem, node, solutionText, warnings, displayName)
        break
      case 'option':
        q = optionResponse(stem, node, solutionText, warnings, displayName)
        break
      case 'string':
        q = shortanswer(stem, node, solutionText, warnings, displayName)
        break
      case 'numerical':
        q = numerical(stem, node, solutionText, warnings, displayName)
        break
      default:
        break
    }
    if (q) questions.push(q)
  }

  // 6) avisos para constructos sin soporte
  for (const unsupported of ['formularesponse', 'customresponse', 'script', 'python', 'drag_and_drop_schema']) {
    if (childrenNodes(problem, unsupported).length > 0) {
      warnings.push(
        `Pregunta "${stemLabel(displayName, problem)}": el bloque <${unsupported}> no se convierte (sin soporte)`,
      )
    }
  }

  return { questions, warnings }
}

function stemLabel(displayName: string, problem: FXNode): string {
  return cleanText(problem[`label`]) || displayName
}

function findChoices(node: FXNode): { container: FXNode; group: FXNode | null } {
  const group = firstChild(node, 'choicegroup')
  if (group) return { container: group, group }
  // choiceresponse sin choicegroup: los choices van directos
  return { container: node, group: null }
}

function collectChoices(options: { container: FXNode }): FXNode[] {
  return childrenNodes(options.container, 'choice')
}

function multichoice(
  stem: string,
  node: FXNode,
  solution: string,
  warnings: string[],
  fallback: string,
): MoodleQuestion | null {
  const { container } = findChoices(node)
  const choices = collectChoices({ container })
  if (choices.length === 0) {
    warnings.push(`Opción múltiple "${fallback}": sin opciones `)
    return null
  }
  const single = choices.filter((c) => attr(c, 'correct') === 'true').length <= 1
  const answers = choices.map((c, _i) => ({
    text: cleanText(c),
    correct: attr(c, 'correct') === 'true',
    feedback: cleanText(firstChild(c, 'solution')),
  }))
  const correctCount = answers.filter((a) => a.correct).length
  if (correctCount === 0) {
    warnings.push(`Pregunta "${fallback}": ninguna opción marcada como correcta`)
  }

  return {
    id: -1,
    name: stem.slice(0, 255) || fallback,
    questiontext: stem,
    generalfeedback: solution,
    qtype: 'multichoice',
    single,
    shuffleanswers: true,
    correctfeedback: '¡Respuesta correcta!',
    partiallycorrectfeedback: 'Parcialmente correcto',
    incorrectfeedback: 'Respuesta incorrecta.',
    answers: answers.map((a) => ({
      id: -1,
      text: a.text,
      fraction: a.correct ? 1 : 0,
      feedback: a.feedback,
    })),
  }
}

function optionResponse(
  stem: string,
  node: FXNode,
  solution: string,
  warnings: string[],
  fallback: string,
): MoodleQuestion | null {
  const input = firstChild(node, 'optioninput')
  if (!input) {
    warnings.push(`optionresponse "${fallback}": sin <optioninput>`)
    return null
  }
  const optionsRaw = attr(input, 'options') ?? attr(input, 'option') ?? ''
  const options = parseOptionsList(optionsRaw)
  const correct = attr(input, 'correct')
  if (!correct) {
    warnings.push(`optionresponse "${fallback}": sin atributo correct`)
  }
  const name = cleanText(attr(input, 'name')) || stem || fallback
  return {
    id: -1,
    name: name.slice(0, 255),
    questiontext: stem,
    generalfeedback: solution,
    qtype: 'multichoice',
    single: true,
    shuffleanswers: true,
    correctfeedback: '¡Respuesta correcta!',
    partiallycorrectfeedback: 'Parcialmente correcto',
    incorrectfeedback: 'Respuesta incorrecta.',
    answers: options
      .filter((o) => o.length > 0)
      .map((o) => ({
        id: -1,
        text: o,
        fraction: correct === o ? 1 : 0,
        feedback: '',
      })),
  }
}

function shortanswer(
  stem: string,
  node: FXNode,
  solution: string,
  warnings: string[],
  fallback: string,
): MoodleQuestion | null {
  let answer = attr(node, 'answer')
  if (answer == null) {
    const targets = childrenNodes(node, 'target')
    if (targets.length > 0) answer = cleanText(targets[0])
  }
  if (answer == null || answer.length === 0) {
    warnings.push(`stringresponse "${fallback}": sin valor de referencia (answer)`)
    answer = '(sin clave)'
  }
  const type = attr(node, 'type') ?? ''
  const caseSensitive = type !== 'ci'
  const answers = answer
    .split(/\s*\|\s*/)
    .map((a) => a.trim())
    .filter(Boolean)
    .map((a) => ({ id: -1, text: a, fraction: 1, feedback: '' }))
  return {
    id: -1,
    name: (stem || fallback).slice(0, 255),
    questiontext: stem,
    generalfeedback: solution,
    qtype: 'shortanswer',
    usecase: caseSensitive,
    answers,
  }
}

function numerical(
  stem: string,
  node: FXNode,
  solution: string,
  warnings: string[],
  fallback: string,
): MoodleQuestion | null {
  let answer = attr(node, 'answer')
  if (answer == null) {
    const targets = childrenNodes(node, 'target')
    if (targets.length > 0) answer = cleanText(targets[0])
  }
  if (answer == null || answer.length === 0) {
    warnings.push(`numericalresponse "${fallback}": sin valor de referencia (answer)`)
    answer = '0'
  }
  const tolerance = parseTolerance(node)
  return {
    id: -1,
    name: (stem || fallback).slice(0, 255),
    questiontext: stem,
    generalfeedback: solution,
    qtype: 'numerical',
    tolerance,
    answers: [
      {
        id: -1,
        text: answer.trim(),
        fraction: 1,
        feedback: '',
      },
    ],
  }
}