// How a vial count on the chart reads as a dose. One copy, used by the server's course forms
// (server/meropenem.js) and by the patient-entry form, which prefills «استمارة الميرونيم» with it.

// Which chart medicines are Meropenem: the catalogue writes it «Meronem …», a typed column may say
// «Meropenem …». The server matches the same words in SQL (MEROPENEM_SQL_PATTERN).
export const MEROPENEM_PATTERN = /(meronem|meropenem)/i
// Tigecycline: the catalogue writes the brand «Tygacil …»; a typed column may say «Tigecycline …».
export const TIGECYCLINE_PATTERN = /(tygacil|tigecycline|tigacyl)/i
// Colistin: the catalogue writes «Colistin 1000000 IU vial»; colistimethate and the brand Colomycin are the same drug.
export const COLISTIN_PATTERN = /(colistin|colistimethate|colomycin|coly-?mycin)/i
// IVIG: intravenous immunoglobulin under whatever name the catalogue gives it (the generic words or a common brand).
export const IVIG_PATTERN = /(ivig|immunoglobulin|immune globulin|gamma ?globulin|octagam|intratect|privigen|gammagard|kiovig|flebogamma|gamunex|sandoglobulin|nanogam|pentaglobin)/i

// A dose box on the request forms holds one number (what the ministry's Google Form takes): tigecycline in mg a
// day («100»), colistin in IU a day («1000000»). Rows saved before that hold the old wording, so it is still read:
// «50mg × 2» (tigecycline: strength × times, joined with +), «6 MU» (colistin, million units).
const TIMES = /\d\s*(?:mg|gm|g)?\s*[×xX*]\s*\d/
export const dailyMg = (text) => {
  const dose = String(text ?? '').trim()
  let total = 0
  let found = false
  for (const match of dose.matchAll(/(\d+(?:\.\d+)?)\s*(mg|gm|g)?\s*[×xX*]\s*(\d+)/g)) {
    total += Number(match[1]) * (/^g/i.test(match[2] || '') ? 1000 : 1) * Number(match[3])
    found = true
  }
  if (found) return total
  return /^\d+(\.\d+)?$/.test(dose) ? Number(dose) : null
}
// The old tigecycline wording turned into the number (anything else is left as typed).
export const tigecyclineDoseNumber = (text) => (TIMES.test(text) ? String(dailyMg(text) ?? '') : text)
// The old colistin wording («6 MU») turned into IU.
export const colistinDoseNumber = (text) => {
  const million = /^\s*(\d+(?:\.\d+)?)\s*(?:MU|MIU)\s*$/i.exec(text)
  return million ? String(Math.round(Number(million[1]) * 1e6)) : text
}

// Colistin vial strength in IU: «Colistin 1000000 IU vial» → 1000000, «Colomycin 2MU» → 2000000; 0 when the name gives none.
export const colistinIU = (medicine) => {
  const name = String(medicine)
  const iu = name.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:IU|units?)\b/i)
  if (iu) return Number(iu[1].replace(/,/g, ''))
  const mu = name.match(/(\d+(?:\.\d+)?)\s*(?:MU|MIU)\b/i)
  return mu ? Number(mu[1]) * 1e6 : 0
}

// Vial strength in mg: "Meronem 1000gm Vial" → 1000, "Meronem 500gm Vial" → 500. The catalogue
// writes gm where it means mg, so a small number with "g" or "gm" ("1g", "Tazocin 4.5gm",
// "Rocephin 1gm") is read as grams — no vial here is under 10 mg.
export const strengthMg = (medicine) => {
  const match = String(medicine).match(/(\d+(?:\.\d+)?)\s*(mg|gm|g)\b/i)
  if (!match) return 0
  const value = Number(match[1])
  return match[2].toLowerCase() !== 'mg' && value < 10 ? value * 1000 : value
}
export const formatMg = (mg) => (mg >= 1000 ? `${mg / 1000}g` : `${mg}mg`)

// Meropenem is given three times a day, so a quantity that divides by 3 reads as a per-dose
// amount: 1g vial × 6 → "2g × 3", 500mg × 3 → "500mg × 3". Anything else stays as vials × count.
// Other drugs pass their own doses-a-day (server/ddd.js); without one it stays as vials × count.
export const doseText = (medicine, quantity, perDay = 3) => {
  const mg = strengthMg(medicine)
  if (!mg) return `× ${quantity}`
  return perDay && quantity % perDay === 0 ? `${formatMg(mg * quantity / perDay)} × ${perDay}` : `${formatMg(mg)} × ${quantity}`
}

// A day's total Meronem (mg: Σ vial strength × vials) read as one dose × times a day, for the
// department's course report. The chart records only vials, so this is an inference, not a record:
// try 3, then 2, then 1 times a day and take the first that makes the dose 1 g or 500 mg (the two
// doses in use); a total that fits none (6 g, say) is split by 3 if it divides, else by 2 if even,
// else given once. 1 g of vials in a day therefore reads «500 mg × 2», never «1 g × 1».
export const inferDose = (totalMg) => {
  if (!(totalMg > 0)) return null
  for (const perDay of [3, 2, 1]) {
    const doseMg = totalMg / perDay
    if (doseMg === 1000 || doseMg === 500) return { doseMg, perDay }
  }
  const perDay = totalMg % 3 === 0 ? 3 : totalMg % 2 === 0 ? 2 : 1
  return { doseMg: totalMg / perDay, perDay }
}
