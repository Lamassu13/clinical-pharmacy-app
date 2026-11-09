// How a vial count on the chart reads as a dose. One copy, used by the server's course forms
// (server/meropenem.js) and by the patient-entry form, which prefills «استمارة الميرونيم» with it.

// Which chart medicines are Meropenem: the catalogue writes it «Meronem …», a typed column may say
// «Meropenem …». The server matches the same words in SQL (MEROPENEM_SQL_PATTERN).
export const MEROPENEM_PATTERN = /(meronem|meropenem)/i
// Tigecycline: the catalogue writes the brand «Tygacil …»; a typed column may say «Tigecycline …».
export const TIGECYCLINE_PATTERN = /(tygacil|tigecycline|tigacyl)/i

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
