// Characters that draw nothing but change how a name is shaped and compared: soft hyphen, the Arabic letter mark, zero-width
// space / non-joiner / joiner, the left-to-right and right-to-left marks and embeddings, word joiner and the invisible operators,
// the bidi isolates, and the byte-order mark. They come in with a name typed on a phone keyboard that switches language mid-word or
// pasted from a chat or a document. «جاس‌م» (a non-joiner before the م) prints with the م cut off the word, and is another patient
// to every comparison by name. Dropped wherever a patient's name is typed or saved (src and server both use this).
export const INVISIBLE = /[­؜​-‏‪-‮⁠-⁤⁦-⁩﻿]/g
// The same set as a Postgres regular-class body (it reads \uXXXX itself), for the migration and the folded search.
export const INVISIBLE_SQL = '[\\u00ad\\u061c\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u2069\\ufeff]'
export const stripInvisible = (value) => String(value ?? '').replace(INVISIBLE, '')
