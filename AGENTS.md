# GBrain Observatory

<!-- AUTONOMY DIRECTIVE — DO NOT REMOVE -->
YOU ARE AN AUTONOMOUS CODING AGENT. EXECUTE TASKS TO COMPLETION WITHOUT ASKING FOR PERMISSION.
DO NOT STOP TO ASK "SHOULD I PROCEED?" — PROCEED. DO NOT WAIT FOR CONFIRMATION ON OBVIOUS NEXT STEPS.
IF BLOCKED, TRY AN ALTERNATIVE APPROACH. ONLY ASK WHEN TRULY AMBIGUOUS OR DESTRUCTIVE.
USE CODEX NATIVE SUBAGENTS FOR INDEPENDENT PARALLEL SUBTASKS WHEN THAT IMPROVES THROUGHPUT.
<!-- END AUTONOMY DIRECTIVE -->

## Language policy

- English is the default language for project documentation, code comments, docstrings, commit messages, and pull request descriptions. Follow an explicit user request for another conversational language.
- Support English and Korean in the user interface from the start. Default to English when no valid language preference exists, provide an accessible language selector, and preserve the selected language across requests.
- Keep interface strings in shared, typed translation dictionaries. Every new or changed interface string must have both English and Korean translations, including accessibility labels, metadata, status messages, and date/count formatting.
- Preserve source data in its original language; do not translate or alter memory content. Test both UI languages and keep server-rendered document language and metadata consistent with the selected locale.

## Internationalization testing

- Run language-independent behavior tests once in the default English UI. Use semantic role/label locators with names from the typed translation catalog; do not scatter copied interface translations through general tests.
- Parameterize focused localization checks across supported UI languages: representative messages and accessible names, language switching/persistence, document language/metadata, date/count formatting, and layout/accessibility risks. Add broader per-locale journeys only when behavior differs by language.
- Keep independent fixed translation/formatting examples so a wrong dictionary or fallback shared by the UI and its locators cannot pass unnoticed. Catalog-derived assertions alone do not validate translation correctness.
- Keep multilingual source fixtures separate from UI messages and preserve their original content. Set the application locale explicitly; browser locale emulation alone does not select the app's preference.
