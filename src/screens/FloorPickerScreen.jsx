import { floors, specialWards } from '../constants.js'

// The floor/special-ward grid. Which cards a given user may actually see is applied
// imperatively by an effect in App (it hides cards outside their assignment), so this
// renders all of them.
export default function FloorPickerScreen({ today, onPickFloor, onOpen }) {
  return <section className="dashboard"><div className="section-heading"><div><p className="eyebrow">مساحة العمل اليومية</p><h1>اختر الطابق أو الردهة</h1><p>ابدأ باختيار موقع الجارت الذي تريد تسجيله أو مراجعته.</p></div><div className="date-chip"><span>اليوم</span><strong>{today}</strong></div></div><div className="location-grid">{floors.map((item) => <button className="location-card" key={item.number} onClick={() => onPickFloor(item)}><span className="floor-number">{item.number}</span><span><strong>الطابق {item.number}</strong><small>{item.wards.length} أروقة فرعية</small></span><span className="arrow">←</span></button>)}{specialWards.map((ward) => <div className="location-card special" key={ward}><span className="floor-number">✚</span><span><strong>{ward}</strong></span><span className="ward-card-actions"><button className="secondary-button compact" onClick={() => onOpen({ floor: null, ward, mode: 'chart' })}>الجارت</button><button className="primary-button compact" onClick={() => onOpen({ floor: null, ward, mode: 'pills' })}>الحبوب</button></span></div>)}</div></section>
}
