import { readCourseArchive, type CourseArchiveInput } from './archive'
import { parseCourse, type EdXCourse } from './edx/parse'
import { convertCourse, type ConvertOptions, type EdxBlockStatus } from './moodle/convert'
import type { MoodleCourse } from './moodle/types'

export interface PipelineOptions extends ConvertOptions {}

export interface PipelineResult {
  edx: EdXCourse
  course: MoodleCourse
  warnings: string[]
  diagnostics: EdxBlockStatus[]
}

/**
 * Ejecuta el pipeline completo edX → modelo Moodle a partir de los bytes
 * de una exportación OLX (`.tar.gz`, `.tgz` o `.zip`). Todo ocurre en el
 * navegador; ningún dato sale de la máquina.
 */
export function runPipeline(input: CourseArchiveInput, opts: PipelineOptions): Promise<PipelineResult> {
  const map = readCourseArchive(input)
  const meta = parseCourse(map)
  if (!meta.course) {
    const reason = meta.errors[0] ?? 'No se encontró course.xml en la exportación.'
    return Promise.reject(new Error(`No se pudo leer el curso: ${reason}`))
  }
  return convertCourse(meta.course, map, opts).then(({ course, warnings, diagnostics }) => ({
    edx: meta.course! as EdXCourse,
    course,
    warnings: [...meta.warnings, ...warnings],
    diagnostics,
  }))
}