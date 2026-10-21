// Synthetic demo donors ONLY. Every record here is fictional - no real people, no real numbers.
// Donation dates are relative to server start so the cooldown demo stays stable over time.
const lib = require('../lib');

const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const A = lib.AREAS;
const donor = (id, name, bloodGroup, area, lastDonation, extra = {}) => ({
  id, name, phone: '00000-DEMO-' + id.slice(2), bloodGroup, area, coords: A[area],
  lastDonation, available: true, verified: false, flagged: false, reports: 0, alerts: [], ...extra,
});

module.exports = [
  donor('D-100', 'Rahul',   'O+',  'Dilsukhnagar', daysAgo(210)),
  donor('D-101', 'Sneha',   'O+',  'LB Nagar',     daysAgo(22)),   // in 90-day cooldown: good for check_cooldown demo
  donor('D-102', 'Imran',   'O-',  'Dilsukhnagar', daysAgo(320)),
  donor('D-103', 'Priya',   'A+',  'Banjara Hills', daysAgo(150)),
  donor('D-104', 'Kiran',   'B+',  'Kukatpally',   daysAgo(180)),
  donor('D-105', 'Anjali',  'B-',  'Secunderabad', daysAgo(10)),   // recent donor: cooldown
  donor('D-106', 'Faisal',  'AB+', 'Mehdipatnam',  daysAgo(260)),  // universal plasma donor
  donor('D-107', 'Divya',   'O+',  'Uppal',        daysAgo(190)),
  donor('D-108', 'Rohit',   'A-',  'Madhapur',     daysAgo(140)),
  donor('D-109', 'Meena',   'B+',  'Charminar',    daysAgo(230)),
  donor('D-110', 'Arjun',   'O+',  'Gachibowli',   daysAgo(120)),
  donor('D-111', 'Zoya',    'AB-', 'Ameerpet',     daysAgo(300)),
  donor('D-112', 'Vikram',  'O-',  'Miyapur',      daysAgo(280)),
  donor('D-113', 'Lakshmi', 'A+',  'Dilsukhnagar', daysAgo(160)),
  donor('D-114', 'Sireesha','B-',  'Uppal',        daysAgo(170)),
  donor('D-115', 'Naveen',  'O+',  'Kukatpally',   daysAgo(12)),   // recent donor: cooldown
];
