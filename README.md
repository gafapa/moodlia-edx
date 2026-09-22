# MoodlIA edX Converter

MoodlIA edX Converter is a static web application that turns an Open edX course export (OLX) into a Moodle course backup (`.mbz`). Archive extraction, OLX parsing, conversion, and backup generation run entirely in the browser: no course content is uploaded or sent to a server.

## What it converts

The converter reads a `.tar.gz`, `.tgz`, or `.zip` OLX export and builds a Moodle course with one section per chapter, following the chapter → sequential → vertical structure of the source course.

| Open edX block | Moodle result |
| --- | --- |
| `html` | Page activity with the block's HTML and its referenced static files |
| `problem` | Quiz question: multiple choice and single choice (`multiplechoiceresponse`, `choiceresponse`, `optionresponse`), short answer (`stringresponse`), and numerical (`numericalresponse`) |
| `video` | Page or URL activity pointing at the YouTube or file source |
| `url` | URL activity |
| `discussion`, other block types | Not migrated; reported in the diagnostics |

Questions are grouped into quizzes per sequential (default), per chapter, or per vertical. Sequential names can optionally be inserted as Text and media labels. Every source block receives a diagnostic status (`converted`, `partial`, or `skipped`) with notes, so the operator knows what needs manual work before the course is used.

The generated `.mbz` targets current Moodle releases and should be restored into a test course first. Restore it through Moodle's standard course restore; the converter does not talk to Moodle.

## Development

```text
npm install
npm run dev        # local development server
npm run typecheck  # TypeScript checks
npm test           # unit tests (vitest)
npm run build      # production build in dist/
```

The application is built with React, Vite, and TypeScript. It has no backend and no runtime configuration.

## Limitations

- Problem types outside the list above, graded discussions, LTI blocks, and custom XBlocks are skipped with a warning.
- Video blocks keep the source reference; media files hosted outside the export are not downloaded.
- The user interface is currently in Spanish.

## Project links

- Source code: https://github.com/gafapa/moodlia-edx
- Issue tracker: https://github.com/gafapa/moodlia-edx/issues

MoodlIA is an independent open-source project. It is not affiliated with, certified by, sponsored by, or endorsed by Moodle HQ or edX. Moodle is a registered trademark of Moodle Pty Ltd.

## License

GNU General Public License v3.0 or later. See `LICENSE`.
