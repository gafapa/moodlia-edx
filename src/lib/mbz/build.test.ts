import { describe, it, expect } from 'vitest'
import { XMLParser } from 'fast-xml-parser'
import JSZip from 'jszip'
import { buildMoodleBackup, buildMoodleBackupFiles, mbzFilename } from './build'
import type {
  MoodleCourse,
  MoodleFile,
  MoodleLabelActivity,
  MoodlePageActivity,
  MoodleQuestion,
  MoodleQuizActivity,
  MoodleSection,
  MoodleUrlActivity,
} from '../moodle/types'

function course(): MoodleCourse {
  const file: MoodleFile = {
    id: 11001,
    contenthash: 'aaaaaaaaaa1234567890abcdef1234567890abcdef',
    contextid: 7001,
    component: 'mod_page',
    filearea: 'content',
    itemid: 5101,
    filepath: '/img/',
    filename: 'logo.png',
    bytes: new Uint8Array([1, 2, 3]),
    mimetype: 'image/png',
  }

  const sections: MoodleSection[] = [
    { id: 3001, number: 0, name: null, summary: '', sequence: [4001] },
    { id: 3002, number: 1, name: 'Tema 1', summary: '<p>intro</p>', sequence: [4003] },
  ]

  const page: MoodlePageActivity = {
    kind: 'page',
    id: 4001,
    instance: 5101,
    contextid: 7001,
    sectionId: 3001,
    sectionNumber: 0,
    name: 'Pagina',
    moduleVersion: '2015051100',
    content: '<p>hola</p>',
    contentformat: 1,
    files: [file],
  }

  const label: MoodleLabelActivity = {
    kind: 'label',
    id: 4002,
    instance: 5102,
    contextid: 7002,
    sectionId: 3001,
    sectionNumber: 0,
    name: 'Etiqueta',
    moduleVersion: '2015051100',
    intro: '<p>Etiqueta intro</p>',
  }

  const quiz: MoodleQuizActivity = {
    kind: 'quiz',
    id: 4003,
    instance: 5103,
    contextid: 7003,
    sectionId: 3002,
    sectionNumber: 1,
    name: 'Examen',
    moduleVersion: '2012061703',
    questions: [],
    questionIds: [6103, 6104],
    grade: 10,
    categoryId: 7202,
    contentHtml: '<p></p>',
  }

  const q1: MoodleQuestion = {
    id: 6103,
    name: '2+2',
    questiontext: '¿Cuánto es 2+2?',
    generalfeedback: '',
    qtype: 'multichoice',
    single: true,
    shuffleanswers: true,
    correctfeedback: 'Bien',
    partiallycorrectfeedback: 'Parcial',
    incorrectfeedback: 'Mal',
    answers: [
      { id: 6105, text: '4', fraction: 1, feedback: '' },
      { id: 6106, text: '5', fraction: 0, feedback: '' },
    ],
  }
  const q2: MoodleQuestion = {
    id: 6104,
    name: 'Capital',
    questiontext: 'Capital de Francia',
    generalfeedback: '',
    qtype: 'shortanswer',
    usecase: false,
    answers: [{ id: 6107, text: 'París', fraction: 1, feedback: '' }],
  }
  quiz.questions = [q1, q2]

  const url: MoodleUrlActivity = {
    kind: 'url',
    id: 4004,
    instance: 5104,
    contextid: 7004,
    sectionId: 3002,
    sectionNumber: 1,
    name: 'Docs',
    moduleVersion: '2015051100',
    externalurl: 'https://docs.example.com',
  }
  label.id = 4005 // reordenado: en la sección 0 el orden es page, label
  page.id = 4001
  sections[0].sequence = [4001, 4005]

  return {
    originalCourseId: 101,
    courseContextId: 7000,
    shortname: 'TEST1',
    fullname: 'Curso test',
    summary: '<p>resumen</p>',
    startdate: 1700000000,
    numsections: 1,
    sections,
    activities: [page, quiz, label, url],
    quizzes: [quiz],
    questions: [q1, q2],
    questionCategories: [
      { id: 7201, name: 'Curso', contextid: 7000, contextlevel: 50, contextinstanceid: 101 },
      { id: 7202, name: 'Quiz', contextid: 7003, contextlevel: 70, contextinstanceid: 4003 },
    ],
    files: [file],
    gradeRootCategoryId: 8301,
    courseGradeItemId: 8302,
    enrolIds: { manual: 9401, guest: 9402 },
    warnings: [],
  }
}

describe('generador de MBZ', () => {
  it('crea todos los ficheros clave', () => {
    const files = buildMoodleBackupFiles(course())
    const paths = [...files.keys()]
    for (const required of [
      'moodle_backup.xml',
      'questions.xml',
      'files.xml',
      'gradebook.xml',
      'roles.xml',
      'course/course.xml',
      'course/enrolments.xml',
      'course/inforef.xml',
      'sections/section_3001/section.xml',
      'sections/section_3002/section.xml',
      'activities/page_4001/page.xml',
      'activities/quiz_4003/quiz.xml',
      'activities/label_4005/label.xml',
      'activities/url_4004/url.xml',
    ]) {
      expect(paths).toContain(required)
    }
    // foro de noticias
    const forumActivity = [...files.keys()].find((p) => p.startsWith('activities/forum_') && p.endsWith('/forum.xml'))
    expect(forumActivity).toBeTruthy()
    // blobs de ficheros
    expect(files.get('files/aa/aaaaaaaaaa1234567890abcdef1234567890abcdef')).toBeInstanceOf(Uint8Array)
  })

  it('serializa el banco de preguntas con los wrappers de plugin y categoria de quiz', () => {
    const files = buildMoodleBackupFiles(course())
    const questions = files.get('questions.xml') as string
    expect(questions).toContain('<plugin_qtype_multichoice_question>')
    expect(questions).toContain('<plugin_qtype_shortanswer_question>')
    expect(questions).toContain('<qtype>multichoice</qtype>')
    expect(questions).toContain('<question_category id="7202">')
    expect(questions).toContain('answertext>París<')
  })

  it('genera quiz.xml coherente con sus preguntas', () => {
    const files = buildMoodleBackupFiles(course())
    const quizXml = files.get('activities/quiz_4003/quiz.xml') as string
    expect(quizXml).toContain('<questions>6103,6104,0</questions>')
    expect(quizXml).toContain('<sumgrades>2.00000</sumgrades>')
    expect(quizXml).toContain('<grade>10.00000</grade>')
    expect(quizXml).toContain('<question_instance')
    expect(quizXml).toContain('<name>Examen</name>')
    const gradesXml = files.get('activities/quiz_4003/grades.xml') as string
    expect(gradesXml).toContain('<itemtype>mod</itemtype>')
    expect(gradesXml).toContain('<itemmodule>quiz</itemmodule>')
    const inforef = files.get('activities/quiz_4003/inforef.xml') as string
    expect(inforef).toContain('<question_category>')
    expect(inforef).toContain('<id>7201</id>')
    expect(inforef).toContain('<id>7202</id>')
  })

  it('incluye el foro de noticias en la seccion general y su setting', () => {
    const files = buildMoodleBackupFiles(course())
    const section0 = files.get('sections/section_3001/section.xml') as string
    const forumModuleId = section0.match(/<sequence>(9000\d+),/)![1]
    expect(files.has(`activities/forum_${forumModuleId}/module.xml`)).toBe(true)
    const mb = files.get('moodle_backup.xml') as string
    expect(mb).toContain(`<modulename>forum</modulename>`)
    expect(mb).toContain(`forum_${forumModuleId}_included`)
  })

  it('mbzFilename construye un nombre de backup descargable', () => {
    const name = mbzFilename(course(), 1461418647)
    expect(name).toMatch(/^backup-moodle2-course-101-test1-/)
    expect(name.endsWith('.mbz')).toBe(true)
  })

  it('buildMoodleBackup produce un Blob comprimido', async () => {
    const blob = await buildMoodleBackup(course())
    expect(blob.size).toBeGreaterThan(100)
  })

  it('todo XML generado es bien formado y los atributos van antes de `>`', async () => {
    const files = buildMoodleBackupFiles(course())
    const parser = new XMLParser()
    for (const content of files.values()) {
      if (!(content instanceof Uint8Array)) {
        if (!content.trim().startsWith('<?xml')) continue
        parser.parse(content as string) // lanza si el XML está mal formado
        expect(content).not.toMatch(/>\s+[a-z_]+="/i)
        expect(content).not.toMatch(/<[a-z_]+>\s+[a-z_]+="/i)
      }
    }
    // los atributos están bien colocados
    expect(files.get('activities/quiz_4003/quiz.xml')).toContain('<quiz id="5103">')
    expect(files.get('activities/quiz_4003/module.xml')).toContain('<module id="4003" version="2012061703">')
    expect(files.get('questions.xml')).toContain('<question_category id="7201">')
    expect(files.get('course/course.xml')).toContain('<course id="101" contextid="7000">')
    const section0 = files.get('sections/section_3001/section.xml') as string
    expect(section0).toMatch(/<section id="3001">/)

    // el ZIP vuelve a leerse
    const blob = await buildMoodleBackup(course())
    const zip = await JSZip.loadAsync(blob)
    const quizXml = (await zip.file('activities/quiz_4003/quiz.xml')?.async('string')) ?? ''
    expect(quizXml.length).toBeGreaterThan(0)
  })
})