/**
 * Decides whether a job location is in the United States and which state(s) it is in.
 * Job boards write locations every way imaginable ("SF Bay Area", "Remote - US", "New York, NY; London, UK",
 * "Austin, Texas, United States", "US-Remote"), so this is deliberately thorough.
 */

export const STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico',
};
const NAME_TO_CODE = Object.fromEntries(Object.entries(STATES).map(([c, n]) => [n.toLowerCase(), c]));
// "Washington" alone usually means the state, but "Washington, DC" / "Washington D.C." is DC (handled first).
const STATE_NAME_RE = new RegExp(`\\b(${Object.values(STATES).map((n) => n.replace(/ /g, '\\s+')).sort((a, b) => b.length - a.length).join('|')})\\b`, 'gi');

// Large US cities that boards often list without a state.
const CITIES = {
  'new york city': 'NY', nyc: 'NY', manhattan: 'NY', brooklyn: 'NY', 'san francisco': 'CA', sf: 'CA', 'bay area': 'CA', 'silicon valley': 'CA',
  'los angeles': 'CA', 'san jose': 'CA', 'san diego': 'CA', 'palo alto': 'CA', 'mountain view': 'CA', 'menlo park': 'CA', sunnyvale: 'CA',
  'redwood city': 'CA', 'santa clara': 'CA', 'foster city': 'CA', oakland: 'CA', irvine: 'CA', 'santa monica': 'CA', 'south san francisco': 'CA',
  'el segundo': 'CA', hawthorne: 'CA', sacramento: 'CA', cupertino: 'CA', emeryville: 'CA', seattle: 'WA', bellevue: 'WA', redmond: 'WA',
  kirkland: 'WA', boston: 'MA', cambridge: 'MA', waltham: 'MA', somerville: 'MA', chicago: 'IL', austin: 'TX', dallas: 'TX', houston: 'TX',
  'san antonio': 'TX', 'fort worth': 'TX', plano: 'TX', denver: 'CO', boulder: 'CO', atlanta: 'GA', miami: 'FL', tampa: 'FL', orlando: 'FL',
  jacksonville: 'FL', phoenix: 'AZ', scottsdale: 'AZ', tempe: 'AZ', philadelphia: 'PA', pittsburgh: 'PA', portland: 'OR', 'salt lake city': 'UT',
  'lehi': 'UT', nashville: 'TN', minneapolis: 'MN', detroit: 'MI', 'ann arbor': 'MI', columbus: 'OH', cleveland: 'OH', cincinnati: 'OH',
  charlotte: 'NC', raleigh: 'NC', durham: 'NC', 'washington dc': 'DC', 'washington d.c.': 'DC', 'washington, d.c.': 'DC', 'washington, dc': 'DC',
  arlington: 'VA', 'mclean': 'VA', reston: 'VA', baltimore: 'MD', 'las vegas': 'NV', 'kansas city': 'MO', 'st. louis': 'MO', 'st louis': 'MO',
  indianapolis: 'IN', milwaukee: 'WI', 'new orleans': 'LA', honolulu: 'HI', 'jersey city': 'NJ', hoboken: 'NJ', newark: 'NJ', stamford: 'CT',
  'new haven': 'CT', providence: 'RI', 'starbase': 'TX', 'mcgregor': 'TX', 'cape canaveral': 'FL', 'brownsville': 'TX', 'huntsville': 'AL',
};
const CITY_RE = new RegExp(`\\b(${Object.keys(CITIES).sort((a, b) => b.length - a.length).map((c) => c.replace(/[.,]/g, '\\$&').replace(/ /g, '\\s+')).join('|')})\\b`, 'i');

// Anything here means the location (part) is outside the US.
const FOREIGN = new RegExp(`\\b(${[
  'canada', 'mexico', 'brazil', 'argentina', 'colombia', 'chile', 'peru', 'costa rica', 'latam', 'latin america', 'south america', 'central america',
  'united kingdom', 'uk', 'england', 'scotland', 'wales', 'ireland', 'germany', 'deutschland', 'france', 'spain', 'portugal', 'italy', 'netherlands',
  'belgium', 'switzerland', 'austria', 'sweden', 'norway', 'denmark', 'finland', 'poland', 'czech', 'romania', 'hungary', 'greece', 'ukraine', 'serbia',
  'bulgaria', 'croatia', 'estonia', 'latvia', 'lithuania', 'israel', 'turkey', 'uae', 'dubai', 'saudi', 'qatar', 'egypt', 'nigeria', 'kenya', 'south africa',
  'india', 'pakistan', 'bangladesh', 'sri lanka', 'nepal', 'china', 'hong kong', 'taiwan', 'japan', 'korea', 'singapore', 'malaysia', 'indonesia', 'philippines',
  'vietnam', 'thailand', 'australia', 'new zealand', 'europe', 'emea', 'apac', 'asia', 'africa', 'middle east', 'oceania', 'cet', 'gmt',
  'london', 'manchester', 'edinburgh', 'dublin', 'berlin', 'munich', 'hamburg', 'frankfurt', 'paris', 'amsterdam', 'madrid', 'barcelona', 'lisbon',
  'zurich', 'geneva', 'stockholm', 'copenhagen', 'oslo', 'helsinki', 'warsaw', 'krakow', 'prague', 'vienna', 'milan', 'rome', 'brussels', 'tel aviv',
  'toronto', 'vancouver', 'montreal', 'ottawa', 'calgary', 'waterloo', 'edmonton', 'mexico city', 'guadalajara', 'sao paulo', 'são paulo', 'bogota', 'bogotá',
  'buenos aires', 'bangalore', 'bengaluru', 'hyderabad', 'mumbai', 'pune', 'chennai', 'delhi', 'gurgaon', 'gurugram', 'noida', 'tokyo', 'seoul', 'beijing',
  'shanghai', 'shenzhen', 'sydney', 'melbourne', 'auckland', 'manila', 'jakarta', 'kuala lumpur', 'bangkok', 'ho chi minh', 'cairo', 'lagos', 'nairobi',
  'cape town', 'johannesburg', 'istanbul', 'riyadh', 'abu dhabi', 'doha', 'taipei', 'ontario', 'quebec', 'british columbia', 'alberta',
].map((s) => s.replace(/ /g, '\\s+')).join('|')})\\b`, 'i');

const US_WORDS = /\b(united\s+states|u\.s\.a?\.?|usa|us|america|north\s+america|americas)\b/i;
const REMOTE = /\b(remote|anywhere|distributed|work\s+from\s+home|wfh|virtual|telecommute)\b/i;
const STATE_CODE_RE = /(?:,|\s-|\()\s*([A-Z]{2})\b(?![a-z])/g;

/** Splits a multi-location string ("NYC; SF / Remote") into parts. */
const splitParts = (s) => String(s || '').split(/\s*(?:;|\||\/(?!\s*hybrid)|\n|\bor\b|•)\s*/i).map((p) => p.trim()).filter(Boolean);

function parsePart(part) {
  const text = part.replace(/\s+/g, ' ');
  const states = new Set();
  const foreign = FOREIGN.test(text) && !/\b(new\s+england)\b/i.test(text);
  // "Washington, DC" before "Washington" the state.
  if (/\bwashington,?\s*d\.?\s?c\.?\b/i.test(text)) states.add('DC');
  // Two-letter codes clash with countries ("Bengaluru, IN", "Toronto, ON"), so they only count without a foreign name.
  if (!foreign) for (const m of text.matchAll(STATE_CODE_RE)) if (STATES[m[1]]) states.add(m[1]);
  for (const m of text.matchAll(STATE_NAME_RE)) {
    const code = NAME_TO_CODE[m[1].toLowerCase().replace(/\s+/g, ' ')];
    if (code && !(code === 'WA' && states.has('DC'))) states.add(code);
  }
  // A known city fills in the state only when none is written ("Portland, ME" is Maine, not Oregon).
  const city = text.match(CITY_RE)?.[1];
  if (city && !states.size && !foreign) states.add(CITIES[city.toLowerCase().replace(/\s+/g, ' ')]);
  // Upper-case "US" only, so the word "us" ("join us") doesn't count.
  const usWord = /\b(united\s+states|u\.s\.a?\.?|usa)\b/i.test(text) || /\bUS\b/.test(text) || /\b(north\s+america|americas)\b/i.test(text);
  const remote = REMOTE.test(text);
  let us = null;
  if (states.size || usWord) us = true;
  if (foreign && !states.size && !usWord) us = false;
  return { us, states: [...states], remote, foreign };
}

/**
 * @param {string|string[]} location free text location(s)
 * @param {{ country?: string, defaultUS?: boolean, remote?: boolean }} hints structured data from the source
 * @returns {{ us: boolean, states: string[], city: string, remote: boolean, decided: boolean }} decided: the text itself settled US or not
 */
export function parseLocation(location, hints = {}) {
  const parts = (Array.isArray(location) ? location : [location]).flatMap(splitParts);
  const parsed = parts.map(parsePart);
  const states = [...new Set(parsed.flatMap((p) => p.states))];
  const remote = !!hints.remote || parsed.some((p) => p.remote);
  const country = String(hints.country || '').trim().toLowerCase();
  let us;
  const decided = parsed.some((p) => p.us === true) || (parsed.length > 0 && parsed.every((p) => p.us === false));
  if (country) us = ['us', 'usa', 'united states', 'united states of america', 'u.s.'].includes(country) || parsed.some((p) => p.us === true);
  else if (parsed.some((p) => p.us === true)) us = true;
  else if (parsed.length && parsed.every((p) => p.us === false)) us = false;
  // Only "Remote"/"Hybrid" or no location: trust the source (a US company's own board) or reject (worldwide aggregators).
  else us = !!hints.defaultUS && !parsed.some((p) => p.foreign);
  const usPart = parts.find((_, i) => parsed[i].us && parsed[i].states.length) || '';
  const city = usPart.split(',')[0].replace(REMOTE, '').replace(/\b(hybrid|on-?site|in[- ]office|hq|headquarters)\b/gi, '').replace(/[-–()]/g, ' ').replace(/\s+/g, ' ').trim();
  // "Texas" alone is a state, but in "New York, NY" the first part is the city.
  const stateOnly = NAME_TO_CODE[city.toLowerCase()] && !usPart.includes(',');
  const isPlace = city && !US_WORDS.test(city) && !STATES[city] && !stateOnly && !FOREIGN.test(city);
  return { us, states, city: isPlace ? city : '', remote, decided };
}
