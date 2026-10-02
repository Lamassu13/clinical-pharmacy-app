// Catalogue medicine names ("Amikacin 500mg Vial", "Lasix 40mg Tab") to the generic name the
// DDInter interaction data is keyed by ("amikacin", "furosemide"): strip strengths and dose forms,
// then map a brand to its generic. Add a line to BRAND_TO_GENERIC when `node server/import-ddinter.js`
// lists a catalogue medicine as unmatched.
const FORM_WORDS = /\b(tab|tabs|tablet|tablets|cap|caps|capsule|capsules|vial|vials|amp|amps|ampoule|ampoules|inj|injection|iv|im|sc|po|syrup|susp|suspension|drops|drop|cream|oint|ointment|gel|supp|suppository|bottle|bag|infusion|solution|sol|sachet|prefilled|syringe|pen|ml|cc|mg|gm|g|mcg|iu|unit|units|er|sr|xr|cr|forte|plus|dispersible|effervescent|nebuliser|nebulizer|inhaler|eye|ear|nasal|spray)\b/g

export const BRAND_TO_GENERIC = {
  lasix: 'furosemide', meronem: 'meropenem', merrem: 'meropenem', clexane: 'enoxaparin', flagyl: 'metronidazole',
  tazocin: 'piperacillin', plavix: 'clopidogrel', lanoxin: 'digoxin', cordarone: 'amiodarone', aldactone: 'spironolactone',
  rocephin: 'ceftriaxone', zofran: 'ondansetron', zyvox: 'linezolid', depakine: 'valproic acid', valproate: 'valproic acid',
  'sodium valproate': 'valproic acid', epanutin: 'phenytoin', septrin: 'trimethoprim', cotrimoxazole: 'trimethoprim',
  'co-trimoxazole': 'trimethoprim', gentamycin: 'gentamicin', augmentin: 'amoxicillin', tazobactam: 'piperacillin',
  asa: 'aspirin', paracetamol: 'acetaminophen', adrenaline: 'epinephrine', noradrenaline: 'norepinephrine', frusemide: 'furosemide',
  salbutamol: 'albuterol', pethidine: 'meperidine', lignocaine: 'lidocaine', 'vitamin k': 'phytonadione', kcl: 'potassium chloride',
}

// Lowercase generic name for a catalogue medicine name, or '' when nothing is left of it.
export const genericName = (name) => {
  const cleaned = String(name ?? '').toLowerCase()
    .replace(/\d+([.,]\d+)?\s*(%|mg|gm|g|mcg|iu|ml|cc|unit|units)?/g, ' ')
    .replace(FORM_WORDS, ' ')
    .replace(/[()/,+*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (BRAND_TO_GENERIC[cleaned]) return BRAND_TO_GENERIC[cleaned]
  const first = cleaned.split(' ')[0]
  return BRAND_TO_GENERIC[first] || cleaned
}
