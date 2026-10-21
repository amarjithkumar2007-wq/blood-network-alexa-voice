// Core matching logic (pure functions, unit tested)
const CAN_DONATE_TO = {
  'O-': ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'],
  'O+': ['O+', 'A+', 'B+', 'AB+'],
  'A-': ['A-', 'A+', 'AB-', 'AB+'],
  'A+': ['A+', 'AB+'],
  'B-': ['B-', 'B+', 'AB-', 'AB+'],
  'B+': ['B+', 'AB+'],
  'AB-': ['AB-', 'AB+'],
  'AB+': ['AB+'],
};
const GROUPS = Object.keys(CAN_DONATE_TO);

// Hyderabad areas (lat, lon) so the demo works without GPS
const AREAS = {
  'Gachibowli': [17.4401, 78.3489], 'Madhapur': [17.4483, 78.3915],
  'Kukatpally': [17.4948, 78.3996], 'Secunderabad': [17.4399, 78.4983],
  'Ameerpet': [17.4375, 78.4482], 'Dilsukhnagar': [17.3688, 78.5247],
  'Uppal': [17.4058, 78.5591], 'Charminar': [17.3616, 78.4747],
  'Banjara Hills': [17.4126, 78.4482], 'LB Nagar': [17.3457, 78.5522],
  'Miyapur': [17.4968, 78.3614], 'Mehdipatnam': [17.3950, 78.4410],
};
const URGENCY_WEIGHT = { critical: 3, urgent: 2, normal: 1 };
const COMPONENTS = ['Whole blood', 'Platelets', 'Plasma'];
// Minimum gap between donations by type (whole blood 90 days is the common rule; platelets/plasma can be given more often)
const GAP_DAYS = { 'Whole blood': 90, 'Platelets': 14, 'Plasma': 28 };
const MIN_GAP_DAYS = GAP_DAYS['Whole blood'];
// Plasma flows the other way: AB plasma is the universal donor, so donor group must be accepted by the patient's ABO type
const PLASMA_OK = (d, p) => { const a = (x) => x.replace(/[+-]/, ''); return a(d) === a(p) || a(d) === 'AB' || a(p) === 'O'; };

function compatible(donorGroup, patientGroup, component = 'Whole blood') {
  if (component === 'Plasma') return PLASMA_OK(donorGroup, patientGroup); // Rh does not matter for plasma
  return (CAN_DONATE_TO[donorGroup] || []).includes(patientGroup); // platelets: exact/compatible group, same rule as red cells here
}
function haversineKm(a, b) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function daysSince(dateStr, now = Date.now()) {
  if (!dateStr) return Infinity;
  return Math.floor((now - new Date(dateStr).getTime()) / 86400000);
}
function gapFor(component) { return GAP_DAYS[component] || MIN_GAP_DAYS; }
function isEligible(donor, now = Date.now(), component = 'Whole blood') {
  return donor.available !== false && !donor.flagged && daysSince(donor.lastDonation, now) >= gapFor(component);
}
// Days until the donor can give again (0 = eligible now)
function cooldownLeft(donor, now = Date.now(), component = 'Whole blood') {
  const d = daysSince(donor.lastDonation, now);
  return d === Infinity ? 0 : Math.max(0, gapFor(component) - d);
}
// Escalation: widen search radius by 2x per stage (max 3 stages) and alert blood banks from stage 1
const ESCALATION_MS = Number(process.env.ESCALATION_MS) || 10 * 60 * 1000;
function radiusFor(urgency, stage = 0) { return ({ critical: 25, urgent: 15, normal: 8 }[urgency] || 10) * Math.pow(2, Math.min(stage, 3)); }
function needsEscalation(r, now = Date.now()) {
  if (['Donation Coordinated', 'Completed', 'Flagged'].includes(r.status) || r.accepted && r.accepted.length || r.stage >= 3) return false;
  return now - new Date(r.lastEscalationAt || r.createdAt).getTime() >= ESCALATION_MS;
}
// Fraud checks: duplicate requests and money demands
const MONEY_WORDS = /(\bpay\b|\bpaid\b|\bpayment\b|paytm|phonepe|gpay|upi|\bcash\b|rupees|\brs\.?\b|₹|\bfee\b|\bmoney\b|advance)/i;
function fraudFlags(req, existing, now = Date.now()) {
  const flags = [], six = 6 * 3600e3;
  const same = existing.filter((x) => now - new Date(x.createdAt).getTime() < six);
  if (same.some((x) => x.phone === req.phone && x.patient.toLowerCase() === req.patient.toLowerCase() && x.bloodGroup === req.bloodGroup && x.area === req.area)) flags.push('duplicate request (same patient, group, area, contact within 6h)');
  if (same.filter((x) => x.phone === req.phone).length >= 2) flags.push('3+ requests from one number in 6h');
  if (MONEY_WORDS.test([req.hospital, req.note].join(' '))) flags.push('mentions money/payment');
  return flags;
}
// Score 0-100: exact group, distance, verification, urgency radius
function matchDonors(request, donors, now = Date.now()) {
  const origin = request.coords, comp = request.component || 'Whole blood';
  const radius = radiusFor(request.urgency, request.stage || 0);
  return donors
    .filter((d) => compatible(d.bloodGroup, request.bloodGroup, comp) && isEligible(d, now, comp))
    .map((d) => {
      const km = haversineKm(origin, d.coords);
      let score = 0;
      score += d.bloodGroup === request.bloodGroup ? 40 : 25;
      score += Math.max(0, 40 * (1 - km / radius));
      score += d.verified ? 15 : 0;
      score += Math.min(5, daysSince(d.lastDonation, now) / 180 * 5);
      return { donor: d, km: Math.round(km * 10) / 10, score: Math.round(score) };
    })
    .filter((m) => m.km <= radius)
    .sort((a, b) => b.score - a.score);
}
const BANKS = [
  { id: 'BB-1', name: 'Red Cross Blood Bank, Secunderabad', area: 'Secunderabad' },
  { id: 'BB-2', name: 'Chiranjeevi Blood Bank, Jubilee Hills', area: 'Banjara Hills' },
  { id: 'BB-3', name: 'Government Blood Bank, Kukatpally', area: 'Kukatpally' },
  { id: 'BB-4', name: 'Charminar Blood Centre', area: 'Charminar' },
];
module.exports = { gapFor, CAN_DONATE_TO, GROUPS, AREAS, COMPONENTS, GAP_DAYS, URGENCY_WEIGHT, MIN_GAP_DAYS, ESCALATION_MS, BANKS, compatible, haversineKm, daysSince, isEligible, cooldownLeft, radiusFor, needsEscalation, fraudFlags, matchDonors };
