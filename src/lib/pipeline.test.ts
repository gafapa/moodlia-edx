import { describe, it, expect } from 'vitest'
import { gzipSync, strToU8 } from 'fflate'
import { readTarGz } from './archive'
import { parseCourse } from './edx/parse'
import { convertCourse } from './moodle/convert'
import { parseProblem } from './edx/problems'

const TAR_BLOCK = 512

function tarHeader(name: string, data: Uint8Array): Uint8Array {
  const h = new Uint8Array(TAR_BLOCK)
  const ascii = (bytes: Uint8Array, at: number, text: string) => {
    const enc = strToU8(text)
    bytes.set(enc.subarray(0, Math.min(enc.length, at === 0 ? 100 : 8)), at)
  }
  ascii(h, 0, name)
  h[100] = 0 // fin del nombre
  ascii(h, 100, '0000644')
  h[108] = 0
  ascii(h, 108, '0000000')
  h[116] = 0
  ascii(h, 116, '0000000')
  h[124] = 0
  const sizeText = data.length.toString(8).padStart(11, '0')
  for (let i = 0; i < 11; i++) h[124 + i] = sizeText.charCodeAt(i)
  h[124 + 11] = 0 // fin del campo de tamaño (12 bytes)
  ascii(h, 136, '00000000000')
  h[147] = 0
  h[156] = 0x30 // '0' tipo fichero
  ascii(h, 257, 'ustar')
  h[262] = 0
  ascii(h, 263, '00')
  h[265] = 0
  let sum = 0
  for (let i = 0; i < TAR_BLOCK; i++) sum += h[i]
  const sumText = sum.toString(8).padStart(6, '0')
  const sumBytes = strToU8(sumText + '\0 ')
  h.set(sumBytes, 148)
  return h
}

function buildTar(entries: { name: string; data: Uint8Array }[]): Uint8Array {
  const chunks: Uint8Array[] = []
  let size = 0
  for (const e of entries) {
    const header = tarHeader(e.name, e.data)
    chunks.push(header, e.data)
    size += TAR_BLOCK + e.data.length + ((TAR_BLOCK - (e.data.length % TAR_BLOCK)) % TAR_BLOCK)
  }
  size += 2 * TAR_BLOCK
  const out = new Uint8Array(size + TAR_BLOCK * 2)
  let offset = 0
  for (const e of entries) {
    out.set(tarHeader(e.name, e.data), offset)
    offset += TAR_BLOCK
    out.set(e.data, offset)
    offset += e.data.length
    offset += (TAR_BLOCK - (e.data.length % TAR_BLOCK)) % TAR_BLOCK
  }
  return out // el resto queda a ceros = fin de tar (no hace falta pegarlo)
}

function syntheticCourseTar(): Uint8Array {
  const text = (s: string) => strToU8(s)
  const entries = [
    { name: 'course.xml', data: text('<course org="TestOrg" course="demo101" run="2026" url_name="course" display_name="Curso de prueba"><chapter url_name="ch1"/></course>') },
    { name: 'chapters/ch1/chapter.xml', data: text('<chapter url_name="ch1" display_name="Capítulo 1"><sequential url_name="s1"/></chapter>') },
    { name: 'sequentials/s1/sequential.xml', data: text('<sequential url_name="s1" display_name="Semana 1"><vertical url_name="v1"/></sequential>') },
    { name: 'verticals/v1/vertical.xml', data: text('<vertical url_name="v1" display_name="V1"><html url_name="h1"/><problem url_name="p1"/><video url_name="vdo1"/><url url_name="l1"/></vertical>') },
    { name: 'html/h1/html.xml', data: text('<html url_name="h1" display_name="Introducción"><![CDATA[<p>Hola <img src="/static/img/logo.png"/></p>]]></html>') },
    { name: 'problems/p1/problem.xml', data: text('<problem url_name="p1" display_name="Pregunta 1"><p>¿2+2?</p><multiplechoiceresponse><choicegroup type="MultipleChoice"><choice correct="true">4</choice><choice>5</choice></choicegroup></multiplechoiceresponse><solution>Es 4</solution></problem>') },
    { name: 'videos/vdo1/video.xml', data: text('<video url_name="vdo1" display_name="Vídeo 1" youtube="abc123"><source src="https://cdn.example.com/x.mp4"/></video>') },
    { name: 'urls/l1/url.xml', data: text('<url url_name="l1" display_name="Docs" url="https://docs.example.com"/>') },
    { name: 'static/img/logo.png', data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0]) },
    { name: 'about/overview.html', data: text('<section>Bienvenidos al curso</section>') },
  ]
  const tar = buildTar(entries)
  return gzipSync(tar)
}

describe('pipeline edX → Moodle', () => {
  it('consume courseTar y convierte', async () => {
    const gz = syntheticCourseTar()
    const map = readTarGz(gz)
    expect(map.size).toBeGreaterThan(0)

    const meta = parseCourse(map)
    expect(meta.errors).toEqual([])
    expect(meta.errors).toEqual([])
    expect(meta.course).not.toBeNull()
    const edx = meta.course!

    const { course, warnings, diagnostics } = await convertCourse(edx, map, {
      includeSequentialLabels: true,
      quizGrouping: 'sequential',
    })
    expect(warnings).toEqual([])

    // diagnóstico: un asiento por cada elemento del curso y bloque
    expect(diagnostics.map((d) => d.key)).toEqual([
      'chapter/0/ch1',
      'sequential/0/0/s1',
      '0/0/0/h1',
      '0/0/0/p1',
      '0/0/0/vdo1',
      '0/0/0/l1',
    ])
    const byType = Object.fromEntries(diagnostics.map((d) => [d.key, d]))
    expect(byType['0/0/0/h1'].target).toBe('page')
    expect(byType['0/0/0/p1']).toMatchObject({ result: 'converted', target: 'quiz' })
    expect(byType['0/0/0/vdo1']).toMatchObject({ result: 'converted', target: 'url' })
    expect(byType['0/0/0/l1']).toMatchObject({ result: 'converted', target: 'url' })

    // curso
    expect(course.shortname).toBe('TESTORG-DEMO101-2026')
    expect(course.fullname).toBe('Curso de prueba')
    expect(course.sections).toHaveLength(1)
    expect(course.sections[0].name).toBe('Capítulo 1')

    // página html con fichero estático reescrito
    const page = course.activities.find((a) => a.kind === 'page')
    expect(page).toBeTruthy()
    if (page?.kind !== 'page') throw new Error('falta page')
    expect(page.content).toContain('@@PLUGINFILE@@/img/logo.png')
    expect(page.files).toHaveLength(1)
    expect(page.files[0].filename).toBe('logo.png')
    expect(course.files).toHaveLength(1)
    expect(course.files[0].mimetype).toBe('image/png')

    // quiz procedente del problema
    const quiz = course.activities.find((a) => a.kind === 'quiz')
    expect(quiz).toBeTruthy()
    if (quiz?.kind !== 'quiz') throw new Error('falta quiz')
    expect(quiz.questions).toHaveLength(1)
    const q = quiz.questions[0]
    expect(q.qtype).toBe('multichoice')
    expect(q.answers).toHaveLength(2)
    expect(q.answers.find((a) => a.text === '4')?.fraction).toBe(1)
    expect(course.questionCategories).toHaveLength(2) // curso + quiz

    // vídeo → url de YouTube
    const video = course.activities.find((a) => a.kind === 'url' && a.externalurl.includes('youtube'))
    expect(video).toBeTruthy()

    // url
    const urlAct = course.activities.find((a) => a.kind === 'url' && a.externalurl.includes('docs'))
    expect(urlAct).toBeTruthy()

    // label del sequential al inicio de la sección
    const label = course.activities.find((a) => a.kind === 'label')
    expect(label).toBeTruthy()
    expect(course.sections[0].sequence[0]).toBe(label?.id)
  })

  it('parsea un problem de solo stringresponse', () => {
    const r = parseProblem('Q', '<p>Capital</p><stringresponse answer="París" type="ci"><textline/></stringresponse>')
    expect(r.questions).toHaveLength(1)
    expect(r.questions[0].qtype).toBe('shortanswer')
    expect(r.questions[0].answers[0].text).toBe('París')
  })

  it('avisa con customresponse', () => {
    const r = parseProblem('Q', '<p>hola</p><customresponse><foo/></customresponse>')
    expect(r.questions).toHaveLength(0)
    expect(r.warnings.join()).toContain('customresponse')
  })
})