// Antibiotic consumption in WHO Defined Daily Doses (DDD per 100 patient-days), for the reports.
// DDDs from the WHO ATC/DDD Index (atcddd.fhi.no, last updated 2026-01-20); AWaRe groups from the
// WHO AWaRe classification 2023 (antifungals are not classified). Keyed by genericName().
// ddd: per route, in grams — except colistin, in million units (unit: 'MU'). P = parenteral, O = oral.
// A combination's DDD refers to one ingredient: `share` is that ingredient's part of the labelled
// strength (Tazocin 4.5 g = piperacillin 4 g; Augmentin 625 mg = amoxicillin 500 mg).
import { genericName } from './generic-names.js'
import { strengthMg } from './meropenem.js'

export const DDD = {
  amoxicillin: { atc: 'J01CA04', aware: 'Access', ddd: { O: 1.5, P: 3 }, combo: { pattern: /augmentin|clav/i, atc: 'J01CR02', share: 0.8 } },
  ampicillin: { atc: 'J01CA01', aware: 'Access', ddd: { O: 2, P: 6 } },
  piperacillin: { atc: 'J01CA12', aware: 'Watch', ddd: { P: 14 }, combo: { pattern: /tazocin|tazobactam/i, atc: 'J01CR05', share: 8 / 9 } },
  cephalexin: { atc: 'J01DB01', aware: 'Access', ddd: { O: 2 } },
  cefazolin: { atc: 'J01DB04', aware: 'Access', ddd: { P: 3 } },
  cefuroxime: { atc: 'J01DC02', aware: 'Watch', ddd: { O: 0.5, P: 3 } },
  cefotaxime: { atc: 'J01DD01', aware: 'Watch', ddd: { P: 4 } },
  ceftazidime: { atc: 'J01DD02', aware: 'Watch', ddd: { P: 4 } },
  ceftriaxone: { atc: 'J01DD04', aware: 'Watch', ddd: { P: 2 } },
  cefixime: { atc: 'J01DD08', aware: 'Watch', ddd: { O: 0.4 } },
  cefoperazone: { atc: 'J01DD12', aware: 'Watch', ddd: { P: 4 } },
  cefepime: { atc: 'J01DE01', aware: 'Watch', ddd: { P: 4 } },
  meropenem: { atc: 'J01DH02', aware: 'Watch', ddd: { P: 3 } },
  ertapenem: { atc: 'J01DH03', aware: 'Watch', ddd: { P: 1 } },
  imipenem: { atc: 'J01DH51', aware: 'Watch', ddd: { P: 2 } },
  azithromycin: { atc: 'J01FA10', aware: 'Watch', ddd: { O: 0.3, P: 0.5 } },
  clarithromycin: { atc: 'J01FA09', aware: 'Watch', ddd: { O: 0.5, P: 1 } },
  clindamycin: { atc: 'J01FF01', aware: 'Access', ddd: { O: 1.2, P: 1.8 } },
  doxycycline: { atc: 'J01AA02', aware: 'Access', ddd: { O: 0.1, P: 0.1 } },
  tigecycline: { atc: 'J01AA12', aware: 'Reserve', ddd: { P: 0.1 } },
  gentamicin: { atc: 'J01GB03', aware: 'Access', ddd: { P: 0.24 } },
  amikacin: { atc: 'J01GB06', aware: 'Access', ddd: { P: 1 } },
  ciprofloxacin: { atc: 'J01MA02', aware: 'Watch', ddd: { O: 1, P: 0.8 } },
  levofloxacin: { atc: 'J01MA12', aware: 'Watch', ddd: { O: 0.5, P: 0.5 } },
  moxifloxacin: { atc: 'J01MA14', aware: 'Watch', ddd: { O: 0.4, P: 0.4 } },
  vancomycin: { atc: 'J01XA01', aware: 'Watch', ddd: { P: 2 } },
  teicoplanin: { atc: 'J01XA02', aware: 'Watch', ddd: { P: 0.4 } },
  colistimethate: { atc: 'J01XB01', aware: 'Reserve', ddd: { P: 9 }, unit: 'MU' },
  metronidazole: { atc: 'J01XD01', oralAtc: 'P01AB01', aware: 'Access', ddd: { P: 1.5, O: 2 } }, // WHO files oral metronidazole under P01AB01
  linezolid: { atc: 'J01XX08', aware: 'Reserve', ddd: { O: 1.2, P: 1.2 } },
  fluconazole: { atc: 'J02AC01', ddd: { O: 0.2, P: 0.2 } },
  voriconazole: { atc: 'J02AC03', ddd: { O: 0.4, P: 0.4 } },
  'amphotericin b': { atc: 'J02AA01', ddd: { P: 0.035 } },
  'amphotericin b (liposomal)': { atc: 'J02AA01', ddd: { P: 0.21 } },
  caspofungin: { atc: 'J02AX04', ddd: { P: 0.05 } },
}

const PARENTERAL = /\b(vial|amp|ampoule|inj|injection|infusion|iv|bag)\b/i
const ORAL = /\b(tab|tablet|cap|capsule)s?\b/i
const PER_VOLUME = /\b(syp|syrup|susp|suspension|drops?)\b|\/\s*\d*\s*ml/i // strength is per ml, not per unit

// One consumption line → its DDDs, or { reason } when it is an antibiotic that cannot be counted,
// or null when it is not a followed antibiotic at all.
export const dddLine = (name, quantity) => {
  const entry = DDD[genericName(name)]
  if (!entry) return null
  const combo = entry.combo?.pattern.test(name) ? entry.combo : null
  const route = PARENTERAL.test(name) ? 'P' : ORAL.test(name) ? 'O' : Object.keys(entry.ddd).length === 1 ? Object.keys(entry.ddd)[0] : null
  if (PER_VOLUME.test(name)) return { atc: entry.atc, aware: entry.aware || null, reason: 'تركيز لكل مل' }
  if (!route || !entry.ddd[route]) return { atc: entry.atc, aware: entry.aware || null, reason: 'طريق الإعطاء غير معروف' }
  const iu = String(name).match(/(\d[\d,]*)\s*(iu|units?)\b/i)
  const perUnit = entry.unit === 'MU' ? (iu ? Number(iu[1].replace(/,/g, '')) / 1e6 : 0) : (strengthMg(name) / 1000) * (combo?.share ?? 1)
  if (!perUnit) return { atc: entry.atc, aware: entry.aware || null, reason: 'التركيز غير مكتوب في الاسم' }
  const amount = perUnit * quantity
  return { atc: combo?.atc || (route === 'O' && entry.oralAtc) || entry.atc, aware: entry.aware || null, route, unit: entry.unit || 'g', amount, ddds: amount / entry.ddd[route] }
}
