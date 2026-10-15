// County warning areas: the counties each National Weather Service forecast office (airfields.js)
// issues warnings for, as every WFO has its CWA.
//
// How the real ones are drawn and used:
//   - A CWA is a set of whole counties (NWS GIS: the CWA boundaries are "the counties/zones for
//     which each WFO is responsible for issuing forecasts and warnings"), and every county is in
//     exactly one. They were laid out with the 1990s modernization, each office at the middle of
//     the area its WSR-88D sees well, so a county belongs to the office nearest it; on the Plains
//     a CWA is a few dozen counties, some 20,000 to 30,000 mi2, reaching 100 to 150 mi from the
//     office. State lines do not bound them (Goodland's runs into Colorado and Nebraska).
//   - Products carry the office: "National Weather Service Dodge City KS", "The National Weather
//     Service in Dodge City has issued a", and its id in the VTEC line (/O.NEW.KDDC.TO.W.0012.../),
//     whose event tracking number counts each office's warnings of each kind (NWSI 10-511).
//   - Polygons have 3 to 20 vertices (NWSI 10-511).
//   - An office warns only inside its own CWA: a warning's polygon is clipped to it, and a storm
//     whose path runs on into a neighbour's CWA is warned there by the neighbour (Warning.js).
//
// Here: each county goes to the office nearest its centre; a county that would be cut off from
// the rest of its office's area (reached only through another's) goes to the neighbour it borders
// most, so every CWA is one piece, as real ones are.

// counties: planCounties' result ({ list }); airfields: planAirfields' (those with an office).
// Sets each county's `office` (the office id) and returns the offices: { id, name, city, radar (the
// radar it uses), x, y (miles, the office building), counties (ids), areaMi2 }.
export function planWarningAreas(counties, airfields) {
  const at = poly => [poly.reduce((s, q) => s + q[0], 0) / poly.length, poly.reduce((s, q) => s + q[1], 0) / poly.length];
  const offices = airfields.filter(a => a.nws).map(a => { const [x, y] = at(a.nws.building); return { id: a.nws.id, name: a.nws.name, city: a.city, radar: a.radar?.id ?? null, x, y }; });
  const list = counties.list;
  if (!offices.length) return [];
  const byId = new Map(list.map(c => [c.id, c]));
  const nearest = c => offices.reduce((a, b) => (Math.hypot(b.x - c.x, b.y - c.y) < Math.hypot(a.x - c.x, a.y - c.y) ? b : a));
  for (const c of list) c.office = nearest(c).id;
  // The county each office stands in.
  const { size, cellMiles, ids } = counties, cellOf = v => Math.min(size - 1, Math.max(0, Math.floor(v / cellMiles)));
  const home = new Map(offices.map(o => [o.id, byId.get(ids[cellOf(o.y) * size + cellOf(o.x)])]));
  for (const [id, c] of home) c.office = id;
  for (let pass = 0; pass < 20; pass++) {
    let moved = 0;
    for (const o of offices) {
      const seen = new Set([home.get(o.id).id]), queue = [home.get(o.id)];
      while (queue.length) for (const n of queue.pop().neighbours) { const c = byId.get(n); if (c.office === o.id && !seen.has(n)) { seen.add(n); queue.push(c); } }
      for (const c of list) {
        if (c.office !== o.id || seen.has(c.id)) continue;
        const votes = new Map();
        for (const n of c.neighbours) { const other = byId.get(n).office; if (other !== o.id) votes.set(other, (votes.get(other) ?? 0) + 1); }
        if (!votes.size) continue;
        c.office = [...votes].sort((a, b) => b[1] - a[1])[0][0]; moved++;
      }
    }
    if (!moved) break;
  }
  return offices.map(o => {
    const mine = list.filter(c => c.office === o.id);
    return { ...o, counties: mine.map(c => c.id), areaMi2: mine.reduce((s, c) => s + c.areaMi2, 0) };
  });
}
