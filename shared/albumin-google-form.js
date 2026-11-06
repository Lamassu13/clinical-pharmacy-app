// «استمارة الالبومين» → the ministry's Google Form «albumin vial / مدينة الطب»: the answers a request makes, and
// the routing the form needs (it is four pages; the diagnosis answer picks the last one). Pure, so it is tested
// without Google. The ids and option texts are the form's own, read from the live form on 2026-11-06 — if the
// form's questions are edited the ids/texts here must be refreshed or Google rejects the answers.
export const FORM_ID = '1FAIpQLSe-IMTxnC28h84i0dKBLMfeB8QLS_AkgRXICkUOhbVzGfaPgw'
export const FORM_URL = `https://docs.google.com/forms/d/e/${FORM_ID}/formResponse`

const ENTRY = { hospital: 1214806455, season: 589084363, month: 1792534844, patient: 423556593, doctor: 2078163932, patientId: 1062167645, sex: 1143953533, age: 1373968846, vials: 1161018343, wasted: 1124900641, part: 181711708, other: 568912938 }
const HOSPITAL = "مستشفى بغداد التعليمي العام"
const SEASONS = [
    "الفصل الاول",
    "الفصل الثاني",
    "الفصل الثالث",
    "الفصل الرابع",
  ]
const MONTHS = [
    "الشهر الاول : كانون الثاني",
    "الشهر الثاني: شباط",
    "الشهر الثالث: اذار",
    "الشهر الرابع: نيسان",
    "الشهر الخامس: ايار",
    "الشهر السادس: حزيران",
    "الشهر السابع: تموز",
    "الشهر الثامن: آب",
    "الشهر التاسع: ايلول",
    "الشهر العاشر: تشرين الاول",
    "الشهر الحادي عشر: تشرين الثاني",
    "الشهر الثاني عشر: كانون الاول",
  ]
// Each Part's question, the page it sits on, and its options (the ministry's tiers: I highly indicated,
// II likely indicated, III doubtful benefit, IV not indicated).
const PARTS = {
  I: { entry: 405609873, page: 6, options: [
    "large volume paracentesis in patients with cirrhosis and refractory ascites associated with portal hypertention (>4 L removed with documented cirrhosis)",
    "malnutrition syndrome :( patients with diarrhea associated with entral feeding intolerance if all the following conditions are met : { significant diarrhea ( >2 L per day)& serum albumin is <2 g per dl }",
    "ascites not responsive to diuretics if serum albumin <2 g per dl",
    "burns : ( not in the resuscitation phase in the first 24 hr after burn injuries accordind to the body surface area )",
    "hyperbilirubinemia of the newborns",
    "plasma exchange ( with isotonic solutions )",
    "severe hypoalbuminemia with low plasma volume and generalized oedema where salt and water restriction with plasma volume expansion are required",
  ] },
  II: { entry: 12553619, page: 5, options: [
    "plasmapheresis",
    "HRS and serum creatinine > 1.5 mg / dl in presence cirrhosis",
    "HRS and absence of shock, ongoing bacterial infection, and/or current treatment with nephrotoxic drugs",
    "HRS and absence of sustained improvement in renal function after discontinuation of diuretics and a trial of albumin 1 g /kg",
    "HRS and absence of proteinuria (<500 mg/day) or hematuria (<50 red cells per high power field)",
    "HRS and absence of ultrasonographic evidence of obstructive uropathy or parenchymal renal disease",
    "postoperative volume resuscitation after cardiac surgery, or major surgery in the liver or bowel (as a post operative volume expender, as a last choice of treatment after crystalloids or non-protein colloids)",
    "Spontaneous bacterial peritonitis and cirrhosis defined as patient with ascitic fluid, PMN count ≥250 cells / mm3 plus at least one of the following (1- serum creatinine >1 mg/dl. 2- Blood urea nitrogen >30 mg/dl. 3- Total bilirubin >4 mg/dl)",
    "Major Hepatic Resection (>40% resected), in patient with serum albumin <2.5g/dl if a crystalloid alone fail to achieve adequate intravascular volume)",
    "Post Operative Liver Transplant (May be useful for control ascites and peripheral edema if serum albumin is <2.5g/dl)",
  ] },
  III: { entry: 1929070663, page: 4, options: [
    "Acute Nephrotic Syndrome with sever refractory edema and anasarca or pulmonary edema with >3g/day of urinary protein excretion + hypercholesterolemia + hypoalbuminemia)",
    "Acute Nephrotic Syndrome with sever refractory edema and anasarca or pulmonary edema with loop diuretics resistance (in sufficient response to IV bolus dose of ≥ 160 mg furosemide followed by ≥  8 hrs infusion of ≥ 20mg/hr furosemide)",
    "Acute Nephrotic Syndrome with symptoms and signs of subacute intravascular volume depletion include (Oliguria)",
    "Acute Nephrotic Syndrome with symptoms and signs of subacute intravascular volume depletion include (poor peripheral perfusion)",
    "Acute Nephrotic Syndrome with symptoms and signs of subacute intravascular volume depletion include (abdominal pain, raised creatinine and hematocrit)",
    "Acute Nephrotic Syndrome with symptoms and signs of subacute intravascular volume depletion include (always under supervision of consultant pediatric nephrologist) )",
    "Acute Nephrosis / chronic glomerular nephritis and subsequent hypoalbuminemia",
  ] },
  IV: { entry: 1089407135, page: 3, options: [
    "Albuminemia > 2.5 g/dl with exception of particular cases list in the above parts",
    "Acute respiratory distress syndrome",
    "Septic shock",
    "Hypovolemic, bleeding and hemorrhage sock (albumin is used as a second choice when solution of crystalloid or nonprotein colloid (first choice treatment) have already been used at maximum dose without having produced a clinical adequate response and cases which nonprotein colloid are contraindicated)",
    "Non Hemorrhagic shock",
    "Traumatic brain injury",
    "Cerebral ischaemia",
    "Major trauma",
    "Wound Healing",
    "Hypoalbuminemia in the absence of edema and acute hypotension",
    "Ascites responsive to diuretics",
    "Kidney transplant",
    "Abdominal compartment syndrome",
    "Burn in the first 24 hours after burn injury",
    "The use of albumin in the immediate post-operative period is never advised for any other type of operation, other than the aformentioned.",
    "Acute normovolaemic haemodialation in surgery",
    "Malnutrition",
    "Protein losing enteropathies and malabsorption",
    "Acute or chronic pancreatitis",
    "Hemodialysis with no evidence of malnutrition",
    "Ovarian hyperstimulation syndrome",
  ] },
}

// The app's 17 indications (shared/drug-requests.js, i1…i17) → the form's [Part, option index]. Where the
// form is finer than the app (HRS has five lines, nephrotic syndrome six) the first/closest one is used —
// the ones to confirm with a pharmacist are marked «?».
const DIAGNOSIS = {
  i1: ['I', 0], i2: ['I', 0], i3: ['I', 2], i4: ['II', 1], // ? HRS: the creatinine line
  i5: ['II', 7], i6: ['III', 6], i7: ['III', 0], // ? nephrotic: the proteinuria line
  i8: ['II', 0], i9: ['IV', 1], i10: ['II', 6], i11: ['II', 6], i12: ['II', 8], i13: ['II', 9],
  i14: ['I', 3], i15: ['I', 4], i16: ['I', 1], i17: ['IV', 3],
}

// The app's «أنثى» is the form's «انثى».
const SEX = { 'ذكر': 'ذكر', 'أنثى': 'انثى' }

// { ok: true, body: [[name, value], …] } or { ok: false, missing: [Arabic labels] }. `request` is one
// stored albumin request (name, patientId, date, fields, ticks). The wasted amount is always 0 (decided
// with the pharmacists: vials are dispensed whole). With several indications ticked the first one is sent
// — the form takes a single diagnosis.
export function albuminFormAnswers(request) {
  const { fields } = request
  const tick = request.ticks.find((key) => DIAGNOSIS[key])
  const missing = [
    [request.name, 'اسم المريض'], [request.patientId, 'رقم الطبلة'], [fields.doctor, 'اسم الطبيب الاختصاص'],
    [fields.sex && SEX[fields.sex], 'الجنس'], [fields.age, 'العمر'], [Number(fields.count) > 0, 'العدد المطلوب'], [tick, 'الاستطباب (علّم مربعًا)'],
  ].filter(([value]) => !value).map(([, label]) => label)
  if (missing.length) return { ok: false, missing }

  const [part, index] = DIAGNOSIS[tick]
  const month = Number(request.date.slice(5, 7))
  const body = [
    [ENTRY.hospital, HOSPITAL], [ENTRY.season, SEASONS[Math.ceil(month / 3) - 1]], [ENTRY.month, MONTHS[month - 1]],
    [ENTRY.patient, request.name], [ENTRY.doctor, fields.doctor], [ENTRY.patientId, request.patientId],
    [ENTRY.sex, SEX[fields.sex]], [ENTRY.age, fields.age], [ENTRY.vials, fields.count], [ENTRY.wasted, '0'],
    [ENTRY.part, `Part ${part}`], [PARTS[part].entry, PARTS[part].options[index]],
  ].map(([entry, value]) => [`entry.${entry}`, String(value)])
  // Pages visited: the institution, the details, then the Part's own (every Part page ends the form).
  body.push(['pageHistory', `0,1,${PARTS[part].page}`], ['fvv', '1'])
  return { ok: true, body }
}
