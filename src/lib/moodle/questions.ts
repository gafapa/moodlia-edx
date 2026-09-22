/**
 * Serialización del banco de preguntas (`questions.xml`) de un backup Moodle.
 *
 * Los fragmentos por tipo de pregunta siguen la estructura que generan las
 * clases de backup de Moodle 2.9 (`backup_qtype_multichoice_plugin`,
 * `backup_qtype_shortanswer_plugin`, `backup_qtype_numerical_plugin`):
 * wrapper `<plugin_qtype_*_question>` con las respuestas estándar
 * (`question_answers`) y las tablas propias del tipo.
 */

import type { MoodleAnswer, MoodleQuestion } from './types'
import { IdAlloc } from './ids'
import { el, open, openAttr, close } from '../xml'

export const MOODLE_BACKUP_ROOT_ID = 90100
export const MOODLE_BACKUP_QUESTION_NOTE = 'Migrado desde Open edX'

export interface QuestionRenderOptions {
  now: number
  alloc: IdAlloc
}

/** Elige el formato de texto de Moodle según el contenido. */
export function formatOf(text: string): number {
  return text.includes('<') || text.includes('&') ? 1 : 2
}

function stamp(now: number, id: number): string {
  return `moodlia+${now}+q${id}`
}

/** Serializa una respuesta estándar de `question_answers`. */
export function answerXml(a: MoodleAnswer, format: number): string {
  return [
    openAttr('answer', { id: a.id }, 2),
    el('answertext', a.text),
    el('answerformat', format),
    el('fraction', a.fraction.toFixed(7)),
    el('feedback', a.feedback),
    el('feedbackformat', format),
    close('answer', 2),
  ].join('\n')
}

function baseQuestionXml(q: MoodleQuestion, now: number): string {
  const qf = formatOf(q.questiontext)
  const gf = formatOf(q.generalfeedback)
  return [
    openAttr('question', { id: q.id }, 1),
    el('parent', 0),
    el('name', q.name),
    el('questiontext', q.questiontext),
    el('questiontextformat', qf),
    el('generalfeedback', q.generalfeedback),
    el('generalfeedbackformat', gf),
    el('defaultmark', '1.0000000'),
    el('penalty', '0.1000000'),
    el('qtype', q.qtype),
    el('length', 1),
    el('stamp', stamp(now, q.id)),
    el('version', stamp(now, q.id + 100000)),
    el('hidden', 0),
    el('timecreated', now),
    el('timemodified', now),
    el('createdby', 2),
    el('modifiedby', 2),
  ].join('\n')
}

/** Serializa el wrapper `<plugin_qtype_*_question>` de una pregunta. */
export function pluginXml(q: MoodleQuestion, opts: QuestionRenderOptions): string {
  switch (q.qtype) {
    case 'multichoice':
      return multichoicePlugin(q, opts)
    case 'shortanswer':
      return shortanswerPlugin(q, opts)
    case 'numerical':
      return numericalPlugin(q, opts)
  }
}

function multichoicePlugin(q: Extract<MoodleQuestion, { qtype: 'multichoice' }>, opts: QuestionRenderOptions): string {
  const fmt = formatOf(q.answers[0]?.text ?? '')
  return [
    open('plugin_qtype_multichoice_question', 2),
    open('question_answers', 3),
    ...q.answers.map((a) => answerXml(a, fmt)),
    close('question_answers', 3),
    openAttr('multichoice', { id: opts.alloc.take() }, 3),
    el('layout', 1),
    el('single', q.single ? 1 : 0),
    el('shuffleanswers', q.shuffleanswers ? 1 : 0),
    el('correctfeedback', q.correctfeedback),
    el('correctfeedbackformat', formatOf(q.correctfeedback)),
    el('partiallycorrectfeedback', q.partiallycorrectfeedback),
    el('partiallycorrectfeedbackformat', formatOf(q.partiallycorrectfeedback)),
    el('incorrectfeedback', q.incorrectfeedback),
    el('incorrectfeedbackformat', formatOf(q.incorrectfeedback)),
    el('answernumbering', q.single ? 'abc' : 'none'),
    el('shownumcorrect', 0),
    el('showstandardinstruction', 1),
    close('multichoice', 3),
    close('plugin_qtype_multichoice_question', 2),
  ].join('\n')
}

function shortanswerPlugin(q: Extract<MoodleQuestion, { qtype: 'shortanswer' }>, opts: QuestionRenderOptions): string {
  const fmt = formatOf(q.answers[0]?.text ?? '')
  return [
    open('plugin_qtype_shortanswer_question', 2),
    open('question_answers', 3),
    ...q.answers.map((a) => answerXml(a, fmt)),
    close('question_answers', 3),
    openAttr('shortanswer', { id: opts.alloc.take() }, 3),
    el('usecase', q.usecase ? 1 : 0),
    close('shortanswer', 3),
    close('plugin_qtype_shortanswer_question', 2),
  ].join('\n')
}

function numericalPlugin(q: Extract<MoodleQuestion, { qtype: 'numerical' }>, opts: QuestionRenderOptions): string {
  return [
    open('plugin_qtype_numerical_question', 2),
    open('question_answers', 3),
    ...q.answers.map((a) => answerXml(a, 0)),
    close('question_answers', 3),
    open('numerical_units', 3),
    close('numerical_units', 3),
    open('numerical_options', 3),
    openAttr('numerical_option', { id: opts.alloc.take() }, 4),
    el('showunits', 0),
    el('unitsleft', 0),
    el('unitgradingtype', 1),
    el('unitpenalty', '0.1000000'),
    close('numerical_option', 4),
    close('numerical_options', 3),
    open('numerical_records', 3),
    q.answers.map((a, i) =>
      [
        openAttr('numerical_record', { id: opts.alloc.take() }, 4),
        el('answer', a.text),
        el('tolerance', i === 0 ? q.tolerance.toFixed(7) : '0.0000000'),
        close('numerical_record', 4),
      ].join('\n'),
    ).join('\n'),
    close('numerical_records', 3),
    close('plugin_qtype_numerical_question', 2),
  ].join('\n')
}

/** Serializa una pregunta completa (base + plugin + hints). */
export function questionXml(q: MoodleQuestion, opts: QuestionRenderOptions): string {
  return [
    baseQuestionXml(q, opts.now),
    pluginXml(q, opts),
    open('question_hints', 2),
    close('question_hints', 2),
    close('question', 1),
  ].join('\n')
}

/** Serializa una `<question_category>` completa con sus preguntas. */
export function questionCategoryXml(
  cat: { id: number; name: string; contextid: number; contextlevel: number; contextinstanceid: number },
  questions: MoodleQuestion[],
  opts: QuestionRenderOptions,
): string {
  return [
    openAttr('question_category', { id: cat.id }, 1),
    el('name', cat.name),
    el('contextid', cat.contextid),
    el('contextlevel', cat.contextlevel),
    el('contextinstanceid', cat.contextinstanceid),
    el('info', MOODLE_BACKUP_QUESTION_NOTE),
    el('infoformat', 0),
    el('stamp', `moodlia+${opts.now}+cat${cat.id}`),
    el('parent', 0),
    el('sortorder', 999),
    open('questions', 2),
    ...questions.map((q) => questionXml(q, opts)),
    close('questions', 2),
    close('question_category', 1),
  ].join('\n')
}

/** Documento `questions.xml` generado a partir de categorías + preguntas. */
export function questionsXmlDocument(
  categories: {
    id: number
    name: string
    contextid: number
    contextlevel: number
    contextinstanceid: number
  }[],
  byCategory: (catId: number) => MoodleQuestion[],
  opts: QuestionRenderOptions,
): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    open('question_categories', 0),
    ...categories.map((cat) => questionCategoryXml(cat, byCategory(cat.id), opts)),
    close('question_categories', 0),
  ].join('\n')
}