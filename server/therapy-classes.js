// Duplicate therapy («التداخلات الدوائية»): two different drugs of one class given to one patient
// on the same day. Members are generic names as genericName() returns them (DDInter spelling).
// Aspirin + a P2Y12 inhibitor is deliberately not a class here: dual antiplatelet therapy is
// usually intended. Add a member or a class by adding a line.
export const THERAPY_CLASSES = [
  { name: 'Proton pump inhibitors', members: ['omeprazole', 'esomeprazole', 'pantoprazole', 'lansoprazole', 'rabeprazole'] },
  { name: 'Acid suppression (PPI + H2 blocker)', members: ['omeprazole', 'esomeprazole', 'pantoprazole', 'lansoprazole', 'rabeprazole', 'famotidine', 'ranitidine'] },
  { name: 'Anticoagulants', note: 'check if bridging is intended', members: ['enoxaparin', 'heparin', 'fondaparinux', 'warfarin', 'rivaroxaban', 'apixaban', 'dabigatran etexilate'] },
  { name: 'P2Y12 inhibitors', members: ['clopidogrel', 'ticagrelor', 'prasugrel'] },
  { name: 'NSAIDs', members: ['diclofenac', 'ibuprofen', 'ketorolac', 'naproxen', 'meloxicam', 'celecoxib', 'indomethacin', 'mefenamic acid'] },
  { name: 'Benzodiazepines', members: ['diazepam', 'clonazepam', 'lorazepam', 'midazolam', 'alprazolam', 'chlordiazepoxide', 'bromazepam'] },
  { name: 'Opioids', members: ['morphine', 'tramadol', 'fentanyl', 'meperidine', 'codeine', 'oxycodone'] },
  { name: 'Antipsychotics', members: ['haloperidol', 'olanzapine', 'quetiapine', 'risperidone', 'chlorpromazine', 'aripiprazole'] },
  { name: 'SSRIs', members: ['sertraline', 'fluoxetine', 'citalopram', 'escitalopram', 'paroxetine'] },
  { name: 'Statins', members: ['atorvastatin', 'rosuvastatin', 'simvastatin', 'pravastatin'] },
  { name: 'ACE inhibitors / ARBs', note: 'dual RAAS blockade', members: ['captopril', 'enalapril', 'lisinopril', 'ramipril', 'perindopril', 'losartan', 'valsartan', 'candesartan', 'irbesartan', 'telmisartan', 'sacubitril'] },
  { name: 'Beta blockers', members: ['bisoprolol', 'metoprolol', 'atenolol', 'carvedilol', 'propranolol', 'nadolol'] },
  { name: 'Loop diuretics', members: ['furosemide', 'bumetanide', 'torasemide'] },
  { name: 'Sulfonylureas', members: ['glimepiride', 'glyburide', 'gliclazide'] },
]

// [{ a, b, className, note }] for every two of `names` whose generics differ but share a class.
// `genericOf` maps a name to its generic; the same generic in two strengths is not a duplicate.
// A pair in two classes (two PPIs are also acid suppression) is reported once, by the first.
export const duplicatePairs = (names, genericOf) => {
  const pairs = []
  const seen = new Set()
  THERAPY_CLASSES.forEach((therapyClass) => {
    const inClass = names.filter((name) => therapyClass.members.includes(genericOf(name)))
    inClass.forEach((a, i) => inClass.slice(i + 1).forEach((b) => {
      const key = [a, b].sort().join('|')
      if (genericOf(a) === genericOf(b) || seen.has(key)) return
      seen.add(key)
      pairs.push({ a, b, className: therapyClass.name, note: therapyClass.note || '' })
    }))
  })
  return pairs
}
