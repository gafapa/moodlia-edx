/**
 * Genera un backup de Moodle completo (`.mbz`, un ZIP con XML estilo moodle2)
 * a partir del modelo intermedio `MoodleCourse`.
 *
 * Referencias de formato: backups reales generados por Moodle 2.9
 * (`backup-moodle2-course-2-...-2016.mbz`) y 2.3 para `quiz.xml`.
 */

import JSZip from 'jszip'
import type {
  AnyMoodleActivity,
  MoodleCourse,
  MoodleFile,
  MoodleQuizActivity,
  MoodleSection,
} from '../moodle/types'
import { IdAlloc } from '../moodle/ids'
import { NULL, el, open, openAttr, close, doc } from '../xml'
import { questionsXmlDocument, type QuestionRenderOptions } from '../moodle/questions'

export interface BuildOptions {
  /** nombre del fichero .mbz; si se omite se construye automáticamente. */
  filename?: string
}

const BUILD_ALLOC_START = 90000

const ROLE_STUDENT_ID = 5

export function mbzFilename(course: MoodleCourse, now = Math.floor(Date.now() / 1000)): string {
  const d = new Date(now * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
  return `backup-moodle2-course-${course.originalCourseId}-${course.shortname.toLowerCase()}-${stamp}-nu.mbz`
}

const EMPTY_ROLES = doc([
  open('roles', 0),
  open('role_overrides', 1),
  close('role_overrides', 1),
  open('role_assignments', 1),
  close('role_assignments', 1),
  close('roles', 0),
])

const EMPTY_FILTERS = doc([
  open('filters', 0),
  open('filter_actives', 1),
  close('filter_actives', 1),
  open('filter_configs', 1),
  close('filter_configs', 1),
  close('filters', 0),
])

const EMPTY_CALENDAR = doc([open('events', 0), close('events', 0)])

const EMPTY_GRADE_HISTORY = doc([
  open('grade_history', 0),
  open('grade_grades', 1),
  close('grade_grades', 1),
  close('grade_history', 0),
])

const EMPTY_ACTIVITY_GRADEBOOK = doc([
  open('activity_gradebook', 0),
  open('grade_items', 1),
  close('grade_items', 1),
  open('grade_letters', 1),
  close('grade_letters', 1),
  close('activity_gradebook', 0),
])

const EMPTY_INFOREF = doc([open('inforef', 0), close('inforef', 0)])

interface BuildCtx {
  course: MoodleCourse
  now: number
  alloc: IdAlloc
  forum: { moduleId: number; instance: number; contextid: number }
  quizGradeItemIds: Map<number, number>
}

function buildCtx(course: MoodleCourse, now: number): BuildCtx {
  const alloc = new IdAlloc(BUILD_ALLOC_START)
  return {
    course,
    now,
    alloc,
    forum: { moduleId: alloc.take(), instance: alloc.take(), contextid: alloc.take() },
    quizGradeItemIds: new Map(),
  }
}

function rendererOf(ctx: BuildCtx): QuestionRenderOptions {
  return { now: ctx.now, alloc: ctx.alloc }
}

function moduleXml(act: AnyMoodleActivity, section: MoodleSection, added: number): string {
  return doc([
    openAttr('module', { id: act.id, version: act.moduleVersion }, 0),
    el('modulename', act.kind),
    el('sectionid', section.id),
    el('sectionnumber', section.number),
    el('idnumber', ''),
    el('added', added),
    el('score', 0),
    el('indent', 0),
    el('visible', 1),
    el('visibleold', 1),
    el('groupmode', 0),
    el('groupingid', 0),
    el('completion', 0),
    el('completiongradeitemnumber', NULL),
    el('completionview', 0),
    el('completionexpected', 0),
    el('availability', NULL),
    el('showdescription', 0),
    close('module', 0),
  ])
}

function forumModuleXml(ctx: BuildCtx, sectionId: number): string {
  return doc([
    openAttr('module', { id: ctx.forum.moduleId, version: '2015051102' }, 0),
    el('modulename', 'forum'),
    el('sectionid', sectionId),
    el('sectionnumber', 0),
    el('idnumber', ''),
    el('added', ctx.now),
    el('score', 0),
    el('indent', 0),
    el('visible', 1),
    el('visibleold', 1),
    el('groupmode', 0),
    el('groupingid', 0),
    el('completion', 0),
    el('completiongradeitemnumber', NULL),
    el('completionview', 0),
    el('completionexpected', 0),
    el('availability', NULL),
    el('showdescription', 0),
    close('module', 0),
  ])
}

/** Envuelve un XML de actividad con el elemento `<activity>` estándar. */
function wrapActivity(body: string, act: { instance: number; id: number; kind: string; contextid: number }): string {
  const inner = body.replace(/^\s*<\?xml[^>]*\?>\s*\n?/, '')
  return doc([
    openAttr('activity', { id: act.instance, moduleid: act.id, modulename: act.kind, contextid: act.contextid }, 0),
    inner,
    close('activity', 0),
  ])
}

function pageXml(act: Extract<AnyMoodleActivity, { kind: 'page' }>, now: number): string {
  return wrapActivity(
    doc([
      openAttr('page', { id: act.instance }, 0),
      el('name', act.name),
      el('intro', ''),
      el('introformat', 1),
      el('content', act.content),
      el('contentformat', act.contentformat),
      el('legacyfiles', 0),
      el('legacyfileslast', NULL),
      el('display', 5),
      el('displayoptions', 'a:2:{s:12:"printheading";s:1:"1";s:10:"printintro";s:1:"1";}'),
      el('revision', 1),
      el('timemodified', now),
      close('page', 0),
    ]),
    act,
  )
}

function urlXml(act: Extract<AnyMoodleActivity, { kind: 'url' }>, now: number): string {
  return wrapActivity(
    doc([
      openAttr('url', { id: act.instance }, 0),
      el('name', act.name),
      el('intro', ''),
      el('introformat', 1),
      el('externalurl', act.externalurl),
      el('display', 1),
      el('displayoptions', 'a:1:{s:10:"printintro";i:1;}'),
      el('parameters', 'a:0:{}'),
      el('timemodified', now),
      close('url', 0),
    ]),
    act,
  )
}

function labelXml(act: Extract<AnyMoodleActivity, { kind: 'label' }>, now: number): string {
  return wrapActivity(
    doc([
      openAttr('label', { id: act.instance }, 0),
      el('name', act.name),
      el('intro', act.intro),
      el('introformat', 1),
      el('timemodified', now),
      close('label', 0),
    ]),
    act,
  )
}

function forumXml(ctx: BuildCtx): string {
  const { forum } = ctx
  return wrapActivity(
    doc([
      openAttr('forum', { id: forum.instance }, 0),
      el('type', 'news'),
      el('name', 'Anuncios'),
      el('intro', 'Noticias y anuncios generales'),
      el('introformat', 0),
      el('assessed', 0),
      el('assesstimestart', 0),
      el('assesstimefinish', 0),
      el('scale', 1),
      el('maxbytes', 0),
      el('maxattachments', 1),
      el('forcesubscribe', 1),
      el('trackingtype', 1),
      el('rsstype', 0),
      el('rssarticles', 0),
      el('timemodified', ctx.now),
      el('warnafter', 0),
      el('blockafter', 0),
      el('blockperiod', 0),
      el('completiondiscussions', 0),
      el('completionreplies', 0),
      el('completionposts', 0),
      el('displaywordcount', 0),
      open('discussions', 1),
      close('discussions', 1),
      open('subscriptions', 1),
      close('subscriptions', 1),
      open('digests', 1),
      close('digests', 1),
      open('readposts', 1),
      close('readposts', 1),
      open('trackedprefs', 1),
      close('trackedprefs', 1),
      close('forum', 0),
    ]),
    { instance: forum.instance, id: forum.moduleId, kind: 'forum', contextid: forum.contextid },
  )
}

function quizGradesXml(ctx: BuildCtx, quiz: MoodleQuizActivity, itemId: number, sortorder: number): string {
  return doc([
    open('activity_gradebook', 0),
    open('grade_items', 1),
    openAttr('grade_item', { id: itemId }, 2),
    el('categoryid', ctx.course.gradeRootCategoryId),
    el('itemname', quiz.name),
    el('itemtype', 'mod'),
    el('itemmodule', 'quiz'),
    el('iteminstance', quiz.instance),
    el('itemnumber', 0),
    el('iteminfo', NULL),
    el('idnumber', NULL),
    el('calculation', NULL),
    el('gradetype', 1),
    el('grademax', quiz.grade.toFixed(5)),
    el('grademin', '0.00000'),
    el('scaleid', NULL),
    el('outcomeid', NULL),
    el('gradepass', '0.00000'),
    el('multfactor', '1.00000'),
    el('plusfactor', '0.00000'),
    el('aggregationcoef', '0.00000'),
    el('sortorder', sortorder),
    el('display', 0),
    el('decimals', NULL),
    el('hidden', 0),
    el('locked', 0),
    el('locktime', 0),
    el('needsupdate', 1),
    el('timecreated', ctx.now),
    el('timemodified', ctx.now),
    open('grade_grades', 3),
    close('grade_grades', 3),
    close('grade_item', 2),
    close('grade_items', 1),
    open('grade_letters', 1),
    close('grade_letters', 1),
    close('activity_gradebook', 0),
  ])
}

function quizXml(ctx: BuildCtx, quiz: MoodleQuizActivity): string {
  const qids = quiz.questionIds
  return wrapActivity(
    doc([
      openAttr('quiz', { id: quiz.instance }, 0),
      el('name', quiz.name),
      el('intro', quiz.contentHtml || '<p></p>'),
      el('introformat', 1),
      el('timeopen', 0),
      el('timeclose', 0),
      el('timelimit', 0),
      el('overduehandling', 'autoabandon'),
      el('graceperiod', 0),
      el('preferredbehaviour', 'adaptive'),
      el('attempts_number', 1),
      el('attemptonlast', 0),
      el('grademethod', 1),
      el('decimalpoints', 0),
      el('questiondecimalpoints', -1),
      el('reviewattempt', 69904),
      el('reviewcorrectness', 69904),
      el('reviewmarks', 69904),
      el('reviewspecificfeedback', 69904),
      el('reviewgeneralfeedback', 69904),
      el('reviewrightanswer', 69904),
      el('reviewoverallfeedback', 4368),
      el('questionsperpage', 0),
      el('navmethod', 'free'),
      el('shufflequestions', 1),
      el('shuffleanswers', 1),
      el('questions', `${qids.join(',')},0`),
      el('sumgrades', qids.length.toFixed(5)),
      el('grade', quiz.grade.toFixed(5)),
      el('timecreated', 0),
      el('timemodified', ctx.now),
      el('password', ''),
      el('subnet', ''),
      el('browsersecurity', '-'),
      el('delay1', 0),
      el('delay2', 0),
      el('showuserpicture', 0),
      el('showblocks', 0),
      open('question_instances', 1),
      ...qids.map((qid) =>
        [
          openAttr('question_instance', { id: ctx.alloc.take() }, 2),
          el('question', qid),
          el('grade', '1.0000000'),
          close('question_instance', 2),
        ].join('\n'),
      ),
      close('question_instances', 1),
      open('feedbacks', 1),
      [
        openAttr('feedback', { id: ctx.alloc.take() }, 2),
        el('feedbacktext', ''),
        el('feedbacktextformat', 0),
        el('mingrade', '0.00000'),
        el('maxgrade', (quiz.grade + 1).toFixed(5)),
        close('feedback', 2),
      ].join('\n'),
      close('feedbacks', 1),
      open('overrides', 1),
      close('overrides', 1),
      open('grades', 1),
      close('grades', 1),
      open('attempts', 1),
      close('attempts', 1),
      close('quiz', 0),
    ]),
    quiz,
  )
}

function activityInforefXml(ctx: BuildCtx, act: AnyMoodleActivity): string {
  const lines: string[] = []
  const quiz = act as MoodleQuizActivity
  if (act.kind === 'quiz') {
    const itemId = ctx.quizGradeItemIds.get(quiz.id)
    if (itemId != null) {
      lines.push(
        open('grade_itemref', 1),
        open('grade_item', 2),
        el('id', itemId),
        close('grade_item', 2),
        close('grade_itemref', 1),
      )
    }
    const courseCat = ctx.course.questionCategories[0]
    lines.push(
      open('question_categoryref', 1),
      ...courseCategoryRef(courseCat.id),
      ...courseCategoryRef(quiz.categoryId),
      close('question_categoryref', 1),
    )
  }
  return doc([open('inforef', 0), ...lines, close('inforef', 0)])
}

function courseCategoryRef(id: number): string[] {
  return [open('question_category', 2), el('id', id), close('question_category', 2)]
}

function sectionXml(section: MoodleSection, forumModuleId: number | null): string {
  const sequence =
    section.number === 0 && forumModuleId != null ? [forumModuleId, ...section.sequence] : section.sequence
  return doc([
    openAttr('section', { id: section.id }, 0),
    el('number', section.number),
    el('name', section.number === 0 ? NULL : section.name ?? NULL),
    el('summary', section.summary),
    el('summaryformat', 1),
    el('sequence', sequence.join(',')),
    el('visible', 1),
    el('availabilityjson', NULL),
    close('section', 0),
  ])
}

function enrolmentsXml(ctx: BuildCtx): string {
  const { enrolIds } = ctx.course
  const makeEnrol = (id: number, type: string, roleid: number, threshold = 86400) => [
    openAttr('enrol', { id }, 2),
    el('enrol', type),
    el('status', 0),
    el('name', NULL),
    el('enrolperiod', 0),
    el('enrolstartdate', 0),
    el('enrolenddate', 0),
    el('expirynotify', 0),
    el('expirythreshold', threshold),
    el('notifyall', 0),
    el('password', ''),
    el('cost', NULL),
    el('currency', NULL),
    el('roleid', roleid),
    el('customint1', NULL),
    el('customint2', NULL),
    el('customint3', NULL),
    el('customint4', NULL),
    el('customint5', NULL),
    el('customint6', NULL),
    el('customint7', NULL),
    el('customint8', NULL),
    el('customchar1', NULL),
    el('customchar2', NULL),
    el('customchar3', NULL),
    el('customdec1', NULL),
    el('customdec2', NULL),
    el('customtext1', NULL),
    el('customtext2', NULL),
    el('customtext3', NULL),
    el('customtext4', NULL),
    el('timecreated', ctx.now),
    el('timemodified', ctx.now),
    open('user_enrolments', 3),
    close('user_enrolments', 3),
    close('enrol', 2),
  ]
  return doc([
    open('enrolments', 0),
    open('enrols', 1),
    makeEnrol(enrolIds.manual, 'manual', ROLE_STUDENT_ID).join('\n'),
    makeEnrol(enrolIds.guest, 'guest', 0, 0).join('\n'),
    close('enrols', 1),
    close('enrolments', 0),
  ])
}

function courseXml(ctx: BuildCtx): string {
  const { course } = ctx
  return doc([
    openAttr('course', { id: course.originalCourseId, contextid: course.courseContextId }, 0),
    el('shortname', course.shortname),
    el('fullname', course.fullname),
    el('idnumber', ''),
    el('summary', course.summary),
    el('summaryformat', 1),
    el('format', 'topics'),
    el('showgrades', 1),
    el('newsitems', 4),
    el('startdate', course.startdate),
    el('marker', 0),
    el('maxbytes', 5242880),
    el('legacyfiles', 0),
    el('showreports', 0),
    el('visible', 1),
    el('groupmode', 0),
    el('groupmodeforce', 0),
    el('defaultgroupingid', 0),
    el('lang', ''),
    el('theme', ''),
    el('timecreated', ctx.now),
    el('timemodified', ctx.now),
    el('requested', 0),
    el('enablecompletion', 0),
    el('completionnotify', 0),
    el('numsections', course.numsections),
    el('hiddensections', 0),
    el('coursedisplay', 0),
    openAttr('category', { id: 1 }, 1),
    el('name', 'Migración'),
    el('description', ''),
    close('category', 1),
    open('tags', 1),
    close('tags', 1),
    close('course', 0),
  ])
}

function courseInforefXml(ctx: BuildCtx): string {
  const { course } = ctx
  const lines: string[] = [
    open('roleref', 1),
    open('role', 2),
    el('id', ROLE_STUDENT_ID),
    close('role', 2),
    close('roleref', 1),
  ]
  if (course.files.length > 0) {
    lines.push(
      open('fileref', 1),
      ...course.files.map((f) => [open('file', 2), el('id', f.id), close('file', 2)].join('\n')),
      close('fileref', 1),
    )
  }
  lines.push(
    open('question_categoryref', 1),
    ...course.questionCategories.flatMap((c) => courseCategoryRef(c.id)),
    close('question_categoryref', 1),
  )
  return doc([open('inforef', 0), ...lines, close('inforef', 0)])
}

function filesXml(ctx: BuildCtx): string {
  return doc([open('files', 0), ...ctx.course.files.map((f) => fileEntryXml(ctx, f)), close('files', 0)])
}

function fileEntryXml(ctx: BuildCtx, f: MoodleFile): string {
  return [
    openAttr('file', { id: f.id }, 1),
    el('contenthash', f.contenthash),
    el('contextid', f.contextid),
    el('component', f.component),
    el('filearea', f.filearea),
    el('itemid', f.itemid),
    el('filepath', f.filepath),
    el('filename', f.filename),
    el('userid', 2),
    el('filesize', f.bytes.byteLength),
    el('mimetype', f.mimetype || NULL),
    el('status', 0),
    el('timecreated', ctx.now),
    el('timemodified', ctx.now),
    el('source', f.filename),
    el('author', 'Migración desde edX'),
    el('license', 'allrightsreserved'),
    el('sortorder', 0),
    el('repositorytype', NULL),
    el('repositoryid', NULL),
    el('reference', NULL),
    close('file', 1),
  ].join('\n')
}

function courseGradeItemXml(ctx: BuildCtx): string {
  const { course } = ctx
  return [
    openAttr('grade_item', { id: course.courseGradeItemId }, 2),
    el('categoryid', NULL),
    el('itemname', NULL),
    el('itemtype', 'course'),
    el('itemmodule', NULL),
    el('iteminstance', course.originalCourseId),
    el('itemnumber', NULL),
    el('iteminfo', NULL),
    el('idnumber', NULL),
    el('calculation', NULL),
    el('gradetype', 1),
    el('grademax', '0.00000'),
    el('grademin', '0.00000'),
    el('scaleid', NULL),
    el('outcomeid', NULL),
    el('gradepass', '0.00000'),
    el('multfactor', '1.00000'),
    el('plusfactor', '0.00000'),
    el('aggregationcoef', '0.00000'),
    el('aggregationcoef2', '0.00000'),
    el('weightoverride', 0),
    el('sortorder', 1),
    el('display', 0),
    el('decimals', NULL),
    el('hidden', 0),
    el('locked', 0),
    el('locktime', 0),
    el('needsupdate', 0),
    el('timecreated', ctx.now),
    el('timemodified', ctx.now),
    open('grade_grades', 3),
    close('grade_grades', 3),
    close('grade_item', 2),
  ].join('\n')
}

function gradebookXml(ctx: BuildCtx): string {
  const { course } = ctx
  return doc([
    open('gradebook', 0),
    open('grade_categories', 1),
    openAttr('grade_category', { id: course.gradeRootCategoryId }, 2),
    el('parent', NULL),
    el('depth', 1),
    el('path', `/${course.gradeRootCategoryId}/`),
    el('fullname', '?'),
    el('aggregation', 13),
    el('keephigh', 0),
    el('droplow', 0),
    el('aggregateonlygraded', 1),
    el('aggregateoutcomes', 0),
    el('timecreated', ctx.now),
    el('timemodified', ctx.now),
    el('hidden', 0),
    close('grade_category', 2),
    close('grade_categories', 1),
    open('grade_items', 1),
    courseGradeItemXml(ctx),
    close('grade_items', 1),
    open('grade_letters', 1),
    close('grade_letters', 1),
    open('grade_settings', 1),
    openAttr('grade_setting', { id: '' }, 2),
    el('name', 'minmaxtouse'),
    el('value', 1),
    close('grade_setting', 2),
    close('grade_settings', 1),
    close('gradebook', 0),
  ])
}

function rolesXml(): string {
  return doc([
    open('roles_definition', 0),
    openAttr('role', { id: ROLE_STUDENT_ID }, 1),
    el('name', ''),
    el('shortname', 'student'),
    el('nameincourse', NULL),
    el('description', ''),
    el('sortorder', ROLE_STUDENT_ID),
    el('archetype', 'student'),
    close('role', 1),
    close('roles_definition', 0),
  ])
}

function questionsXml(ctx: BuildCtx): string {
  const courseCat = ctx.course.questionCategories[0]
  return questionsXmlDocument(ctx.course.questionCategories, (catId) => (catId === courseCat.id ? ctx.course.questions : []), rendererOf(ctx))
}

function setting(indent: number, level: string, ref: string, name: string, value: string): string[] {
  return [
    open('setting', indent),
    el('level', level),
    ...(ref ? [el(level, ref)] : []),
    el('name', name),
    el('value', value),
    close('setting', indent),
  ]
}

function moodleBackupXml(ctx: BuildCtx, filename: string): string {
  const { course } = ctx
  const activityEntries: string[] = []
  const settings: string[] = []

  const forumKey = `forum_${ctx.forum.moduleId}`
  activityEntries.push(
    open('activity', 1),
    el('moduleid', ctx.forum.moduleId),
    el('sectionid', course.sections[0]?.id ?? 1),
    el('modulename', 'forum'),
    el('title', 'Anuncios'),
    el('directory', `activities/${forumKey}`),
    close('activity', 1),
  )
  settings.push(...setting(2, 'activity', forumKey, `${forumKey}_included`, '1'))
  settings.push(...setting(2, 'activity', forumKey, `${forumKey}_userinfo`, '0'))

  for (const act of course.activities) {
    const key = `${act.kind}_${act.id}`
    activityEntries.push(
      open('activity', 1),
      el('moduleid', act.id),
      el('sectionid', act.sectionId),
      el('modulename', act.kind),
      el('title', act.name),
      el('directory', `activities/${key}`),
      close('activity', 1),
    )
    settings.push(...setting(2, 'activity', key, `${key}_included`, '1'))
    settings.push(...setting(2, 'activity', key, `${key}_userinfo`, '0'))
  }

  const sectionEntries: string[] = []
  for (const sec of course.sections) {
    const key = `section_${sec.id}`
    sectionEntries.push(
      open('section', 1),
      el('sectionid', sec.id),
      el('title', sec.number === 0 ? '0' : sec.name ?? ''),
      el('directory', `sections/${key}`),
      close('section', 1),
    )
    settings.push(...setting(2, 'section', key, `${key}_included`, '1'))
    settings.push(...setting(2, 'section', key, `${key}_userinfo`, '0'))
  }

  const rootSettings = [
    ['filename', filename],
    ['imscc11', '0'],
    ['users', '0'],
    ['anonymize', '0'],
    ['role_assignments', '0'],
    ['activities', '1'],
    ['blocks', '1'],
    ['filters', '1'],
    ['comments', '0'],
    ['badges', '0'],
    ['calendarevents', '1'],
    ['userscompletion', '0'],
    ['logs', '0'],
    ['grade_histories', '0'],
    ['questionbank', '1'],
    ['groups', '1'],
  ] as const

  return doc([
    open('moodle_backup', 0),
    open('information', 1),
    el('name', filename),
    el('moodle_version', '2015051105.07'),
    el('moodle_release', '2.9.5+ (Build: 20160422)'),
    el('backup_version', '2015051100'),
    el('backup_release', '2.9'),
    el('backup_date', ctx.now),
    el('mnet_remoteusers', 0),
    el('include_files', 1),
    el('include_file_references_to_external_content', 0),
    el('original_wwwroot', 'http://localhost/moodle'),
    el('original_site_identifier_hash', hex32(course.shortname)),
    el('original_course_id', course.originalCourseId),
    el('original_course_format', 'topics'),
    el('original_course_fullname', course.fullname),
    el('original_course_shortname', course.shortname),
    el('original_course_startdate', course.startdate),
    el('original_course_contextid', course.courseContextId),
    el('original_system_contextid', 2),
    open('details', 2),
    openAttr('detail', { backup_id: hex32(`${course.shortname}${ctx.now}`) }, 3),
    el('type', 'course'),
    el('format', 'moodle2'),
    el('interactive', 1),
    el('mode', 10),
    el('execution', 1),
    el('executiontime', 0),
    close('detail', 3),
    close('details', 2),
    open('contents', 2),
    open('activities', 3),
    ...activityEntries,
    close('activities', 3),
    open('sections', 3),
    ...sectionEntries,
    close('sections', 3),
    open('course', 3),
    el('courseid', course.originalCourseId),
    el('title', course.shortname),
    el('directory', 'course'),
    close('course', 3),
    close('contents', 2),
    open('settings', 2),
    ...rootSettings.flatMap(([name, value]) => setting(3, 'root', '', name, value)),
    ...settings,
    close('settings', 2),
    close('information', 1),
    close('moodle_backup', 0),
  ])
}

function hex32(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  const base = h.toString(16).padStart(8, '0')
  return `${base}${base}${base}${base}`
}

/**
 * Construye el árbol de ficheros del MBZ sin comprimir. Devuelve un mapa
 * «ruta completa dentro del ZIP» → contenido (XML o bytes).
 */
export function buildMoodleBackupFiles(course: MoodleCourse, opts: BuildOptions = {}): Map<string, string | Uint8Array> {
  const now = Math.floor(Date.now() / 1000)
  const ctx = buildCtx(course, now)
  const filename = opts.filename ?? mbzFilename(course, now)
  const files = new Map<string, string | Uint8Array>()

  files.set('moodle_backup.xml', moodleBackupXml(ctx, filename))
  files.set('questions.xml', questionsXml(ctx))
  files.set('files.xml', filesXml(ctx))
  files.set('gradebook.xml', gradebookXml(ctx))
  files.set('roles.xml', rolesXml())
  files.set('completion.xml', doc([open('course_completion', 0), close('course_completion', 0)]))
  files.set('groups.xml', doc([open('groups', 0), open('groupings', 1), close('groupings', 1), close('groups', 0)]))
  files.set('outcomes.xml', doc([open('outcomes_definition', 0), close('outcomes_definition', 0)]))
  files.set('scales.xml', doc([open('scales_definition', 0), close('scales_definition', 0)]))
  files.set('grade_history.xml', EMPTY_GRADE_HISTORY)

  // course/
  files.set('course/course.xml', courseXml(ctx))
  files.set('course/enrolments.xml', enrolmentsXml(ctx))
  files.set('course/inforef.xml', courseInforefXml(ctx))
  files.set('course/roles.xml', EMPTY_ROLES)
  files.set('course/filters.xml', EMPTY_FILTERS)
  files.set('course/calendar.xml', EMPTY_CALENDAR)

  // secciones
  const generalSection = course.sections.find((s) => s.number === 0) ?? course.sections[0]
  const forumModuleId = generalSection ? ctx.forum.moduleId : null
  for (const sec of course.sections) {
    files.set(`sections/section_${sec.id}/section.xml`, sectionXml(sec, forumModuleId))
    files.set(`sections/section_${sec.id}/inforef.xml`, EMPTY_INFOREF)
  }

  // foro de noticias en la sección general
  if (generalSection) {
    const key = `forum_${ctx.forum.moduleId}`
    files.set(`activities/${key}/module.xml`, forumModuleXml(ctx, generalSection.id))
    files.set(`activities/${key}/forum.xml`, forumXml(ctx))
    files.set(`activities/${key}/grades.xml`, EMPTY_ACTIVITY_GRADEBOOK)
    files.set(`activities/${key}/inforef.xml`, EMPTY_INFOREF)
    files.set(`activities/${key}/roles.xml`, EMPTY_ROLES)
    files.set(`activities/${key}/filters.xml`, EMPTY_FILTERS)
    files.set(`activities/${key}/calendar.xml`, EMPTY_CALENDAR)
    files.set(`activities/${key}/grade_history.xml`, EMPTY_GRADE_HISTORY)
  }

  // actividades
  const sectionsById = new Map(course.sections.map((s) => [s.id, s]))
  let gradeItemSort = 1
  for (const act of course.activities) {
    const section = sectionsById.get(act.sectionId) ?? course.sections[0]
    const key = `${act.kind}_${act.id}`
    files.set(`activities/${key}/module.xml`, moduleXml(act, section, now))
    switch (act.kind) {
      case 'page':
        files.set(`activities/${key}/page.xml`, pageXml(act, now))
        files.set(`activities/${key}/grades.xml`, EMPTY_ACTIVITY_GRADEBOOK)
        files.set(`activities/${key}/inforef.xml`, EMPTY_INFOREF)
        break
      case 'url':
        files.set(`activities/${key}/url.xml`, urlXml(act, now))
        files.set(`activities/${key}/grades.xml`, EMPTY_ACTIVITY_GRADEBOOK)
        files.set(`activities/${key}/inforef.xml`, EMPTY_INFOREF)
        break
      case 'label':
        files.set(`activities/${key}/label.xml`, labelXml(act, now))
        files.set(`activities/${key}/grades.xml`, EMPTY_ACTIVITY_GRADEBOOK)
        files.set(`activities/${key}/inforef.xml`, EMPTY_INFOREF)
        break
      case 'quiz': {
        gradeItemSort += 1
        const itemId = ctx.alloc.take()
        ctx.quizGradeItemIds.set(act.id, itemId)
        files.set(`activities/${key}/quiz.xml`, quizXml(ctx, act))
        files.set(`activities/${key}/grades.xml`, quizGradesXml(ctx, act, itemId, gradeItemSort))
        files.set(`activities/${key}/inforef.xml`, activityInforefXml(ctx, act))
        break
      }
    }
    files.set(`activities/${key}/roles.xml`, EMPTY_ROLES)
    files.set(`activities/${key}/filters.xml`, EMPTY_FILTERS)
    files.set(`activities/${key}/calendar.xml`, EMPTY_CALENDAR)
    files.set(`activities/${key}/grade_history.xml`, EMPTY_GRADE_HISTORY)
  }

  // blobs de ficheros
  for (const f of course.files) {
    files.set(`files/${f.contenthash.slice(0, 2)}/${f.contenthash}`, f.bytes)
  }

  return files
}

/**
 * Genera el `.mbz` completo como Blob comprimido.
 */
export async function buildMoodleBackup(course: MoodleCourse, opts: BuildOptions = {}): Promise<Blob> {
  const files = buildMoodleBackupFiles(course, opts)
  const zip = new JSZip()
  for (const [path, content] of files) {
    zip.file(path, content)
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}