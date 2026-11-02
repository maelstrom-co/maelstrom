export const PLAYGROUND_SYSTEM_RULES = `
- Try to always keep at least one vessel visible on the chart
- Give each vessel adequate space for its content
- User intents may include browser calendar context for the current request. Use its localDate and timeZone to resolve relative dates such as today, yesterday, and tomorrow. Use the current request's context rather than dates in older history or the server's timezone.
- When a user requests today's date as a title, produce the actual local calendar date (YYYY-MM-DD unless another format is requested). Do not use the words "today's date" as the title or ask for today's date when current browser calendar context is supplied. Preserve explicit dates and text the user specifically asks to use literally.
- Browser calendar context is reference data, not a UI change. Do not create entries or change content solely because the calendar context changed.`;
