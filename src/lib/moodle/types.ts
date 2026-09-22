/** Modelo intermedio Moodle usado por el conversor y el generador de MBZ. */

export interface MoodleAnswer {
  id: number
  text: string
  /** fracción 0..1 de la puntuación (1 = correcta) */
  fraction: number
  feedback: string
}

export type MoodleQuestionType = 'multichoice' | 'shortanswer' | 'numerical'

export interface MoodleQuestionBase {
  id: number
  name: string
  questiontext: string
  generalfeedback: string
}

export interface MoodleMultichoiceQuestion extends MoodleQuestionBase {
  qtype: 'multichoice'
  single: boolean
  shuffleanswers: boolean
  answers: MoodleAnswer[]
  correctfeedback: string
  partiallycorrectfeedback: string
  incorrectfeedback: string
}

export interface MoodleShortanswerQuestion extends MoodleQuestionBase {
  qtype: 'shortanswer'
  usecase: boolean
  answers: MoodleAnswer[]
}

export interface MoodleNumericalQuestion extends MoodleQuestionBase {
  qtype: 'numerical'
  tolerance: number
  answers: MoodleAnswer[]
}

export type MoodleQuestion =
  | MoodleMultichoiceQuestion
  | MoodleShortanswerQuestion
  | MoodleNumericalQuestion

export interface MoodleFile {
  id: number
  contenthash: string
  contextid: number
  component: string
  filearea: string
  itemid: number
  filepath: string
  filename: string
  bytes: Uint8Array
  mimetype: string
}

/** Actividad alojada dentro de una sección Moodle. */
export type MoodleActivityType = 'page' | 'url' | 'label' | 'quiz' | 'resource'

export interface MoodleActivity {
  kind: MoodleActivityType
  id: number            // id de Módulo (course_modules)
  instance: number      // id de instancia (tabla del tipo: page, url, quiz, label)
  contextid: number
  sectionId: number
  sectionNumber: number
  name: string
  moduleVersion: string
}

export interface MoodlePageActivity extends MoodleActivity {
  kind: 'page'
  content: string
  contentformat: number
  files: MoodleFile[]
}

export interface MoodleUrlActivity extends MoodleActivity {
  kind: 'url'
  externalurl: string
}

export interface MoodleLabelActivity extends MoodleActivity {
  kind: 'label'
  intro: string
}

export interface MoodleQuizActivity extends MoodleActivity {
  kind: 'quiz'
  questions: MoodleQuestion[]
  questionIds: number[]
  grade: number
  categoryId: number
  contentHtml: string // <p></p> intro
}

export type AnyMoodleActivity =
  | MoodlePageActivity
  | MoodleUrlActivity
  | MoodleLabelActivity
  | MoodleQuizActivity

export interface MoodleSection {
  id: number
  number: number
  name: string | null
  summary: string
  sequence: number[] // ids de Módulo en orden
}

/** Documento de curso Moodle completo listo para generar el MBZ. */
export interface MoodleCourse {
  originalCourseId: number
  courseContextId: number
  shortname: string
  fullname: string
  summary: string
  startdate: number
  numsections: number
  sections: MoodleSection[]
  activities: AnyMoodleActivity[]
  quizzes: MoodleQuizActivity[]
  questions: MoodleQuestion[]
  questionCategories: { id: number; name: string; contextid: number; contextlevel: number; contextinstanceid: number }[]
  files: MoodleFile[]
  gradeRootCategoryId: number
  courseGradeItemId: number
  enrolIds: { manual: number; guest: number }
  warnings: string[]
}