// Patient names are typed by hand, so one name comes in spellings: «أحمد»/«احمد», «علي»/«على», «فاطمة»/«فاطمه»,
// harakat, a stretched letter, a doubled space. For comparing and searching, those are folded away:
// the alef forms → ا, ى → ي, ة → ه, harakat and tatweel dropped, runs of spaces → one, case lowered.
export const foldName = (name) => String(name ?? '').toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim()

// The same fold, in SQL, for a column holding a name (Postgres reads the \uXXXX escapes in a regex itself).
export const foldedSql = (column) => String.raw`lower(btrim(regexp_replace(translate(regexp_replace(${column}, '[ً-ْـ]', '', 'g'), 'أإآىة', 'ااايه'), '\s+', ' ', 'g')))`
