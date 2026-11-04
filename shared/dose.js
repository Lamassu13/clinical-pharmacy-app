// How a vial count on the chart reads as a dose. One copy, used by the server's course forms
// (server/meropenem.js) and by the patient-entry form, which prefills «استمارة الميرونيم» with it.

// Which chart medicines are Meropenem: the catalogue writes it «Meronem …», a typed column may say
// «Meropenem …». The server matches the same words in SQL (MEROPENEM_SQL_PATTERN).
export const MEROPENEM_PATTERN = /(meronem|meropenem)/i

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
