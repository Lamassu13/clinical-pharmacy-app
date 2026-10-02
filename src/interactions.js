// «التداخلات الدوائية» — a hand-kept list of well-known drug-drug interactions, matched against
// the chart's medicine names (catalogue spellings vary by strength and form, so each side is a
// pattern run on medicineKey(name), not an exact name). Bundled with the app: nothing is stored
// on the server. This is a screening aid for the pharmacist, not a complete reference — extend it
// by adding a line. severity: 'major' (avoid / act), 'moderate' (monitor).
const rule = (a, b, severity, note) => ({ a, b, severity, note })

export const INTERACTION_RULES = [
  rule(/warfarin|ورفارين/, /aspirin|asa\b|clopidogrel|plavix|enoxaparin|clexane|heparin|diclofenac|ibuprofen|ketorolac|naproxen|اسبرين|أسبرين/, 'major', 'Increased bleeding risk'),
  rule(/warfarin|ورفارين/, /metronidazole|flagyl|fluconazole|ciprofloxacin|clarithromycin|amiodarone|فلاجيل/, 'major', 'Raises INR and increases bleeding risk'),
  rule(/enoxaparin|clexane|heparin/, /aspirin|clopidogrel|plavix|diclofenac|ibuprofen|ketorolac|naproxen/, 'moderate', 'Increased bleeding risk'),
  rule(/clopidogrel|plavix/, /omeprazole|esomeprazole/, 'moderate', 'Omeprazole/esomeprazole reduce clopidogrel activation; prefer pantoprazole'),
  rule(/amikacin|gentamicin|gentamycin|tobramycin|streptomycin/, /furosemide|lasix|vancomycin|colistin|amphotericin/, 'major', 'Additive nephrotoxicity and ototoxicity'),
  rule(/vancomycin/, /piperacillin|tazocin|tazobactam/, 'moderate', 'Increased risk of acute kidney injury'),
  rule(/meropenem|meronem|ميروبينيم/, /valpro|depakine|epilim|فالبروات/, 'major', 'Meropenem markedly lowers valproate levels; seizure breakthrough'),
  rule(/digoxin|lanoxin/, /amiodarone|cordarone|verapamil|clarithromycin/, 'major', 'Raised digoxin level; risk of toxicity'),
  rule(/digoxin|lanoxin/, /furosemide|lasix|hydrochlorothiazide/, 'moderate', 'Hypokalaemia increases digoxin toxicity'),
  rule(/clarithromycin|erythromycin/, /simvastatin|atorvastatin|lovastatin/, 'major', 'Risk of myopathy / rhabdomyolysis'),
  rule(/ciprofloxacin|levofloxacin|moxifloxacin/, /amiodarone|ondansetron|haloperidol|azithromycin|clarithromycin/, 'major', 'QT prolongation; risk of arrhythmia'),
  rule(/amiodarone|cordarone/, /ondansetron|haloperidol|azithromycin/, 'major', 'QT prolongation; risk of arrhythmia'),
  rule(/tramadol/, /ondansetron|sertraline|fluoxetine|citalopram|escitalopram|linezolid|amitriptyline/, 'major', 'Risk of serotonin syndrome and seizures'),
  rule(/linezolid/, /sertraline|fluoxetine|citalopram|escitalopram|amitriptyline/, 'major', 'Risk of serotonin syndrome'),
  rule(/spironolactone|aldactone/, /enalapril|captopril|lisinopril|ramipril|losartan|potassium|kcl/, 'major', 'Risk of hyperkalaemia'),
  rule(/enalapril|captopril|lisinopril|ramipril|losartan/, /potassium|kcl/, 'moderate', 'Risk of hyperkalaemia'),
  rule(/phenytoin|epanutin/, /fluconazole|metronidazole|flagyl|omeprazole/, 'moderate', 'Raised phenytoin level'),
  rule(/ciprofloxacin|levofloxacin/, /antacid|maalox|calcium|ferrous|iron|zinc|magnesium/, 'moderate', 'Metal cations reduce quinolone absorption; separate doses by 2 hours'),
  rule(/ceftriaxone|rocephin|سيفترياكسون/, /calcium gluconate|calcium chloride|ringer/, 'major', 'Precipitates with calcium IV; do not give together'),
  rule(/methotrexate/, /trimethoprim|septrin|co-?trimoxazole|ibuprofen|diclofenac|naproxen/, 'major', 'Increased methotrexate toxicity'),
  rule(/ketorolac|diclofenac|ibuprofen|naproxen/, /enalapril|captopril|lisinopril|ramipril|losartan|furosemide|lasix/, 'moderate', 'Risk of kidney injury and reduced antihypertensive effect'),
]
