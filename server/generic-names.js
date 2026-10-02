// Catalogue medicine names ("Amikacin 500mg Vial", "Lasix 40mg Tab") to the generic name the
// DDInter interaction data is keyed by ("amikacin", "furosemide"): strip strengths and dose forms,
// then map a brand to its generic. Add a line to BRAND_TO_GENERIC when `node server/import-ddinter.js`
// lists a catalogue medicine as unmatched.
const FORM_WORDS = /\b(tab|tabs|tablet|tablets|cap|caps|capsule|capsules|vial|vials|amp|amps|ampoule|ampoules|inj|injection|iv|im|sc|po|syrup|syp|susp|suspension|drops|drop|cream|oint|ointment|gel|supp|suppository|bottle|bag|infusion|solution|sol|sachet|prefilled|pfs|syringe|pen|ml|cc|mg|gm|g|mcg|iu|unit|units|er|sr|xr|cr|forte|plus|dispersible|effervescent|nebuliser|nebulizer|inhaler|inhalation|turbuhaler|eye|ear|nasal|spray)\b/g

export const BRAND_TO_GENERIC = {
  lasix: 'furosemide', meronem: 'meropenem', merrem: 'meropenem', clexane: 'enoxaparin', flagyl: 'metronidazole',
  tazocin: 'piperacillin', plavix: 'clopidogrel', lanoxin: 'digoxin', cordarone: 'amiodarone', aldactone: 'spironolactone',
  rocephin: 'ceftriaxone', zofran: 'ondansetron', zyvox: 'linezolid', depakine: 'valproic acid', valproate: 'valproic acid',
  'sodium valproate': 'valproic acid', epanutin: 'phenytoin', septrin: 'trimethoprim', cotrimoxazole: 'trimethoprim',
  'co-trimoxazole': 'trimethoprim', gentamycin: 'gentamicin', augmentin: 'amoxicillin', tazobactam: 'piperacillin',
  asa: 'acetylsalicylic acid', aspirin: 'acetylsalicylic acid', paracetamol: 'acetaminophen', adrenaline: 'epinephrine', noradrenaline: 'norepinephrine', frusemide: 'furosemide',
  pethidine: 'meperidine', lignocaine: 'lidocaine', 'vitamin k': 'phytonadione', kcl: 'potassium chloride',
  actemra: 'tocilizumab', aldomet: 'methyldopa', allermine: 'chlorpheniramine', amaryl: 'glimepiride', ambisome: 'amphotericin b (liposomal)',
  ambrisantan: 'ambrisentan', amoxil: 'amoxicillin', 'anti d': 'human rho(d) immune globulin', apresoline: 'hydralazine', aransip: 'darbepoetin alfa',
  avas: 'atorvastatin', brilinta: 'ticagrelor', brufen: 'ibuprofen', buscopan: 'scopolamine', hyoscine: 'scopolamine', capoten: 'captopril',
  ceftrixone: 'ceftriaxone', ciprodar: 'ciprofloxacin', colistin: 'colistimethate', cyclocapron: 'tranexamic acid', daonil: 'glyburide',
  decadrone: 'dexamethasone', depomedrol: 'methylprednisolone', solumedrol: 'methylprednisolone', ebixa: 'memantine', empadil: 'empagliflozin',
  enabrel: 'etanercept', endoxan: 'cyclophosphamide', entresto: 'sacubitril', esmeron: 'rocuronium', ferrosam: 'ferrous sulfate anhydrous',
  ferrofolic: 'ferrous sulfate anhydrous', flamazine: 'silver sulfadiazine (topical)', forxiga: 'dapagliflozin', garamycin: 'gentamicin',
  glucophage: 'metformin', histadin: 'cyproheptadine', ibandronic: 'ibandronate', inderal: 'propranolol', 'insulin lente': 'insulin human (zinc)',
  'insulin mix': 'insulin human (isophane)', 'insulin soluble': 'insulin human (regular)', isoptin: 'verapamil', keflex: 'cephalexin',
  kemadrin: 'procyclidine', keppra: 'levetiracetam', largactil: 'chlorpromazine', librium: 'chlordiazepoxide', luminal: 'phenobarbital',
  methoprim: 'trimethoprim', mgso: 'magnesium sulfate', mobic: 'meloxicam', mtx: 'methotrexate', nimotop: 'nimodipine', panadol: 'acetaminophen',
  pitocin: 'oxytocin', plasil: 'metoclopramide', qantavir: 'entecavir', redepra: 'mirtazapine', risek: 'omeprazole', rivotrel: 'clonazepam',
  scolin: 'succinylcholine', sinemet: 'levodopa', singular: 'montelukast', symbicort: 'budesonide', ventolin: 'salbutamol', tegretol: 'carbamazepine',
  tracurium: 'atracurium', tryptizole: 'amitriptyline', tysabri: 'natalizumab', valium: 'diazepam', venofer: 'iron sucrose', voltarin: 'diclofenac',
  xylocaine: 'lidocaine', zovirax: 'acyclovir', angesid: 'ketorolac',
  anafranil: 'clomipramine', angisar: 'hydrochlorothiazide', calcium: 'calcium carbonate', concor: 'bisoprolol', crestor: 'rosuvastatin',
  entersto: 'sacubitril', esomprazole: 'esomeprazole', 'insulin mixtard': 'insulin human (isophane)', isordil: 'isosorbide dinitrate',
  lacosmide: 'lacosamide', laxadyl: 'bisacodyl', olan: 'olanzapine', pantaprazole: 'pantoprazole', pulmicort: 'budesonide',
  tetrabenzine: 'tetrabenazine', thyroxine: 'levothyroxine', urso: 'ursodeoxycholic acid',
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
