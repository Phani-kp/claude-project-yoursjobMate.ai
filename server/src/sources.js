import { builtInBoards } from './companies.js';
import { parseLocation } from './usLocation.js';

/**
 * Job sources. Each returns { key, label, full, jobs } where every job is normalised to:
 *   { external_id, source, title, company, location, states[], city, remote, us, salary, job_type, url, description, tags[], posted_at }
 * `full` means the source returned its complete current list, so postings missing from it have closed.
 */

const UA = { 'User-Agent': 'YoursJobMate/1.0 (+job search assistant)', Accept: 'application/json' };

export async function fetchJson(url, { headers = {}, timeout = 25_000, retries = 2, body } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const init = body ? { method: 'POST', body: JSON.stringify(body), headers: { ...UA, 'Content-Type': 'application/json', ...headers } } : { headers: { ...UA, ...headers } };
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
      if (res.status === 429 || res.status >= 500) throw Object.assign(new Error(`HTTP ${res.status}`), { retry: true });
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
      const text = await res.text();
      try { return JSON.parse(text); } catch { throw Object.assign(new Error(`Not JSON: ${text.slice(0, 40)}`), { retry: true }); }
    } catch (e) {
      const retry = e.retry || e.name === 'TimeoutError' || e.cause?.code === 'ECONNRESET';
      if (!retry || attempt >= retries) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
const decode = (s) => String(s || '').replace(/&(#\d+|#x[0-9a-f]+|[a-z0-9]+);/gi, (m, e) => {
  if (ENTITIES[e.toLowerCase()]) return ENTITIES[e.toLowerCase()];
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  return m;
});
/** HTML (possibly entity-escaped, as Greenhouse sends it) to readable plain text. */
export const htmlToText = (html) => decode(decode(html)
  .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)[^>]*>/gi, '\n')
  .replace(/<li[^>]*>/gi, '• ')
  .replace(/<[^>]+>/g, ' '))
  .replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();

const iso = (d) => { const t = d ? new Date(typeof d === 'number' && d < 1e12 ? d * 1000 : d) : null; return t && !Number.isNaN(t.getTime()) ? t.toISOString() : null; };
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const range = (min, max, per = '') => (min && max ? `${money(min)} – ${money(max)}${per}` : min ? `From ${money(min)}${per}` : '');

function job(fields, locationInput, hints) {
  const loc = parseLocation(locationInput, hints);
  return {
    ...fields, title: decode(fields.title).trim(), company: decode(fields.company).trim(),
    us: loc.us, states: loc.states, city: loc.city, remote: loc.remote, description: (fields.description || '').slice(0, 5000),
  };
}

// ---- Company boards (direct from the employer's ATS) ------------------------------------------

async function greenhouse({ token, name }) {
  const data = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`, { timeout: 60_000 });
  // The posting's own location wins; the company's office list is only used when that location is just "Remote" or similar.
  const placesOf = (j) => (parseLocation(j.location?.name).decided ? [j.location.name] : [j.location?.name, ...(j.offices || []).map((o) => o.name)].filter(Boolean));
  return (data.jobs || []).map((j) => job({
    external_id: `greenhouse-${token}-${j.id}`, source: 'Greenhouse', title: j.title, company: name,
    location: j.location?.name || '', url: j.absolute_url, description: htmlToText(j.content),
    tags: (j.departments || []).map((d) => d.name).filter(Boolean), salary: '', job_type: '',
    posted_at: iso(j.first_published) || iso(j.updated_at),
  }, placesOf(j), { defaultUS: true }));
}

async function lever({ token, name }) {
  const data = await fetchJson(`https://api.lever.co/v0/postings/${token}?mode=json`, { timeout: 60_000 });
  return (Array.isArray(data) ? data : []).map((j) => {
    const c = j.categories || {};
    const s = j.salaryRange;
    const description = [j.descriptionPlain, ...(j.lists || []).map((l) => `${l.text}\n${htmlToText(l.content)}`), j.additionalPlain].filter(Boolean).join('\n\n');
    return job({
      external_id: `lever-${token}-${j.id}`, source: 'Lever', title: j.text, company: name,
      location: c.location || '', url: j.hostedUrl, description, tags: [c.team, c.department].filter(Boolean),
      salary: s && s.currency === 'USD' ? range(s.min, s.max, s.interval?.includes('hour') ? '/hr' : '/yr') : '', job_type: c.commitment || '',
      posted_at: iso(j.createdAt),
    }, c.allLocations?.length ? c.allLocations : [c.location], { country: j.country, defaultUS: true, remote: j.workplaceType === 'remote' });
  });
}

async function ashby({ token, name }) {
  const data = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=true`, { timeout: 60_000 });
  return (data.jobs || []).filter((j) => j.isListed !== false).map((j) => {
    // Give each location its country so "Remote" in Canada isn't read as US.
    const places = [{ location: j.location, address: j.address }, ...(j.secondaryLocations || [])]
      .map((l) => [l.location, l.address?.postalAddress?.addressRegion, l.address?.postalAddress?.addressCountry].filter(Boolean).join(', '));
    return job({
      external_id: `ashby-${token}-${j.id}`, source: 'Ashby', title: (j.title || '').trim(), company: name,
      location: j.location || '', url: j.jobUrl, description: j.descriptionPlain || htmlToText(j.descriptionHtml),
      tags: [j.department, j.team].filter(Boolean), salary: j.compensation?.scrapeableCompensationSalarySummary || '',
      job_type: ({ FullTime: 'Full-time', PartTime: 'Part-time', Intern: 'Internship', Contract: 'Contract', Temporary: 'Temporary' })[j.employmentType] || j.employmentType || '',
      posted_at: iso(j.publishedAt),
    }, places, { defaultUS: true, remote: j.isRemote && j.workplaceType === 'Remote' });
  });
}

// ---- Workday (most Fortune 500 employers) ----------------------------------------------------------

const MAX_AGE_DAYS = Number(process.env.JOB_MAX_AGE_DAYS) || 30;
// Workday only gives whole days ("Posted 3 Days Ago"): use the start of that day, so dates never land in the future
// and stay the same from one sync to the next.
const daysAgoIso = (days) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return new Date(d.getTime() - days * 864e5).toISOString(); };

/** "Posted Today" / "Posted Yesterday" / "Posted 3 Days Ago" / "Posted 30+ Days Ago" → days. */
const workdayDays = (s = '') => (/today/i.test(s) ? 0 : /yesterday/i.test(s) ? 1 : /\+/.test(s) ? 999 : Number(s.match(/(\d+)/)?.[1] ?? 999));

/** Workday writes "US, CA, Santa Clara"; job paths look like "/job/US-CA-Santa-Clara/...". Both become "Santa Clara, CA, US". */
function workdayPlace(text, path) {
  const m = String(text || '').match(/^(US|USA|United States)[,\s-]+([A-Z]{2})[,\s-]+(.+)$/);
  if (m) return `${m[3]}, ${m[2]}, US`;
  if (/^\d+ Locations?$/i.test(text || '')) {
    const seg = String(path || '').split('/')[2] || '';
    const p = seg.match(/^(US|USA)-([A-Z]{2})-(.+)$/);
    return p ? `${p[3].replace(/-/g, ' ')}, ${p[2]}, US` : '';
  }
  return text || '';
}

/** Finds the "United States" value in Workday's location facets (the parameter name differs between employers). */
function workdayUSFacet(facets = []) {
  for (const f of facets) {
    for (const v of f.values || []) {
      if (v.facetParameter && v.values) { const nested = workdayUSFacet([v]); if (nested) return nested; }
      if (/^(united states( of america)?|usa|us)$/i.test(v.descriptor || '') && /location|country/i.test(f.facetParameter)) return { param: f.facetParameter, id: v.id };
    }
  }
  return null;
}

async function workday({ token, name }) {
  const [tenant, wd, site] = token.split('|');
  const host = `https://${tenant}.${wd}.myworkdayjobs.com`;
  const api = `${host}/wday/cxs/${tenant}/${site}/jobs`;
  const max = Number(process.env.WORKDAY_MAX_JOBS) || 500;
  const first = await fetchJson(api, { body: { appliedFacets: {}, limit: 20, offset: 0, searchText: '' } });
  const us = workdayUSFacet(first.facets);
  const appliedFacets = us ? { [us.param]: [us.id] } : {};
  const jobs = [];
  const undated = [];
  // Workday lists the newest postings first, so paging stops at the first one older than the window.
  for (let offset = 0; offset < max; offset += 20) {
    const page = offset === 0 && !us ? first : await fetchJson(api, { body: { appliedFacets, limit: 20, offset, searchText: '' } });
    let old = false;
    for (const p of page.jobPostings || []) {
      const days = p.postedOn ? workdayDays(p.postedOn) : null;
      if (days !== null && days > MAX_AGE_DAYS) { old = true; continue; }
      const j = job({
        external_id: `workday-${tenant}-${p.bulletFields?.[0] || p.externalPath}`, source: 'Workday', title: p.title, company: name,
        location: workdayPlace(p.locationsText, p.externalPath) || p.locationsText || '', url: `${host}/${site}${p.externalPath}`,
        description: '', tags: [], salary: '', job_type: '', posted_at: days === null ? null : daysAgoIso(days),
      }, workdayPlace(p.locationsText, p.externalPath), { defaultUS: !!us });
      jobs.push(j);
      if (days === null) undated.push([j, p.externalPath]);
    }
    if (old || (page.jobPostings || []).length < 20) break;
  }
  // Some employers hide "Posted N days ago" in the list; their job pages still carry the posting date.
  let next = 0;
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (next < Math.min(undated.length, 300)) {
      const [j, path] = undated[next++];
      try {
        const info = (await fetchJson(`${host}/wday/cxs/${tenant}/${site}${path}`, { retries: 1 })).jobPostingInfo || {};
        j.posted_at = iso(info.startDate) || (info.postedOn ? daysAgoIso(workdayDays(info.postedOn)) : null);
        if (info.jobDescription) j.description = htmlToText(info.jobDescription).slice(0, 5000);
      } catch { /* left undated: skipped by the sync */ }
    }
  }));
  return jobs;
}

// ---- SmartRecruiters and Workable ----------------------------------------------------------------

async function smartrecruiters({ token, name }) {
  const jobs = [];
  const max = Number(process.env.SMARTRECRUITERS_MAX_JOBS) || 1000;
  for (let offset = 0; offset < max; offset += 100) {
    const data = await fetchJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings?country=us&limit=100&offset=${offset}`);
    for (const p of data.content || []) {
      const l = p.location || {};
      jobs.push(job({
        external_id: `smartrecruiters-${token}-${p.id}`, source: 'SmartRecruiters', title: p.name, company: name,
        location: l.fullLocation || [l.city, l.region].filter(Boolean).join(', '), url: `https://jobs.smartrecruiters.com/${token}/${p.id}`,
        description: '', tags: [p.department?.label, p.function?.label].filter(Boolean), salary: '',
        job_type: p.typeOfEmployment?.label || '', posted_at: iso(p.releasedDate),
      }, [l.fullLocation || [l.city, l.region].filter(Boolean).join(', ')], { country: l.country, remote: !!l.remote }));
    }
    if ((data.content || []).length < 100 || offset + 100 >= (data.totalFound || 0)) break;
  }
  return jobs;
}

async function workable({ token, name }) {
  const data = await fetchJson(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(token)}?details=true`);
  return (data.jobs || []).map((p) => job({
    external_id: `workable-${token}-${p.shortcode}`, source: 'Workable', title: p.title, company: name || data.name,
    location: [p.city, p.state].filter(Boolean).join(', ') || p.country || '', url: p.url || p.application_url || `https://apply.workable.com/${token}/j/${p.shortcode}/`,
    description: htmlToText(p.description), tags: [p.department].filter(Boolean), salary: '', job_type: p.employment_type || '',
    posted_at: iso(p.published_on || p.created_at),
  }, [[p.city, p.state, p.country].filter(Boolean).join(', ')], { country: p.country, remote: !!p.telecommuting }));
}

// ---- Amazon (its own careers site) ---------------------------------------------------------------

async function amazon() {
  const max = Number(process.env.AMAZON_MAX_JOBS) || 3000;
  const cutoff = Date.now() - MAX_AGE_DAYS * 864e5;
  const jobs = [];
  for (let offset = 0; offset < max; offset += 100) {
    const data = await fetchJson(`https://www.amazon.jobs/en/search.json?normalized_country_code%5B%5D=USA&result_limit=100&offset=${offset}&sort=recent`);
    const page = data.jobs || [];
    for (const j of page) {
      const places = (j.locations || []).map((l) => { try { const o = typeof l === 'string' ? JSON.parse(l) : l; return o.normalizedCountryCode === 'USA' ? `${o.normalizedCityName || o.city}, ${o.region}` : ''; } catch { return ''; } }).filter(Boolean);
      jobs.push(job({
        external_id: `amazon-${j.id_icims || j.id}`, source: 'Amazon', title: j.title, company: 'Amazon',
        location: j.normalized_location || j.location || '', url: `https://www.amazon.jobs${j.job_path}`,
        description: htmlToText([j.description, j.basic_qualifications && `Basic qualifications<br>${j.basic_qualifications}`, j.preferred_qualifications && `Preferred qualifications<br>${j.preferred_qualifications}`].filter(Boolean).join('<br><br>')),
        tags: [j.job_category, j.business_category].filter(Boolean), salary: '', job_type: j.job_schedule_type || '', posted_at: iso(j.posted_date),
      }, places.length ? places : [j.normalized_location], { country: 'US' }));
    }
    if (page.length < 100 || (page.at(-1) && Date.parse(page.at(-1).posted_date) < cutoff)) break;
  }
  return jobs;
}

export const ATS = { greenhouse, lever, ashby, workday, smartrecruiters, workable };

// ---------------------------------------------------------------------------------------------
// Job details that list endpoints leave out (Workday and SmartRecruiters), fetched when a job is opened.
// ---------------------------------------------------------------------------------------------

export async function fetchJobDetails(j) {
  const url = new URL(j.url);
  if (j.source === 'Workday') {
    const [, site, ...rest] = url.pathname.split('/');
    const tenant = url.hostname.split('.')[0];
    const info = (await fetchJson(`${url.origin}/wday/cxs/${tenant}/${site}/${rest.join('/')}`)).jobPostingInfo || {};
    const places = [info.location, ...(info.additionalLocations || [])].map((p) => workdayPlace(p));
    const loc = parseLocation(places, { defaultUS: true });
    return { description: htmlToText(info.jobDescription).slice(0, 5000), job_type: info.timeType || '', ...(loc.states.length ? { states: loc.states, city: loc.city } : {}), url: info.externalUrl || j.url };
  }
  if (j.source === 'SmartRecruiters') {
    const [, company, id] = url.pathname.split('/');
    const d = await fetchJson(`https://api.smartrecruiters.com/v1/companies/${company}/postings/${id}`);
    const sections = Object.values(d.jobAd?.sections || {}).map((s) => (s?.text ? `${s.title || ''}\n${htmlToText(s.text)}` : '')).filter(Boolean);
    return { description: sections.join('\n\n').slice(0, 5000), url: d.postingUrl || j.url };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Adding companies: from a careers-page link, or by guessing a company's board from its name.
// ---------------------------------------------------------------------------------------------

/** Recognises a career-site link and returns { ats, token }, or null. */
export function parseBoardUrl(input) {
  let u;
  try { u = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const seg = u.pathname.split('/').filter(Boolean);
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    const t = u.searchParams.get('for') || (seg[0] === 'embed' ? null : seg[0]);
    return t ? { ats: 'greenhouse', token: t.toLowerCase() } : null;
  }
  if (host === 'jobs.lever.co' && seg[0]) return { ats: 'lever', token: seg[0].toLowerCase() };
  if (host === 'jobs.ashbyhq.com' && seg[0]) return { ats: 'ashby', token: seg[0] };
  if (/^(jobs|careers)\.smartrecruiters\.com$/.test(host) && seg[0]) return { ats: 'smartrecruiters', token: seg[0] };
  if (host === 'apply.workable.com' && seg[0]) return { ats: 'workable', token: seg[0].toLowerCase() };
  const wd = host.match(/^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/);
  if (wd) {
    const site = seg.find((s) => !/^[a-z]{2}-[A-Z]{2}$/.test(s) && s !== 'job' && s !== 'details');
    return site ? { ats: 'workday', token: `${wd[1]}|${wd[2]}|${site}` } : null;
  }
  return null;
}

/** Board name guesses for a company name: "JPMorgan Chase & Co." → jpmorganchase, jpmorgan-chase, jpmorgan… */
function slugGuesses(name) {
  const clean = name.toLowerCase().replace(/&/g, ' and ').replace(/\b(inc|llc|ltd|corp|corporation|co|company|technologies|technology|group|holdings)\b\.?/g, ' ').replace(/[^a-z0-9 ]/g, ' ').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  const joined = words.join('');
  return [...new Set([joined, words.join('-'), words[0], `${joined}jobs`, `${joined}careers`, `${joined}hq`, `${joined}inc`].filter((s) => s && s.length > 1))].slice(0, 7);
}

/**
 * Looks for a company's job board on Greenhouse, Lever, Ashby, SmartRecruiters and Workable.
 * Returns the boards that exist and have US jobs, as [{ ats, token, name, jobs }].
 */
export async function discoverBoards(companyName) {
  const name = companyName.trim().replace(/\s+/g, ' ');
  const guesses = slugGuesses(name);
  const pascal = name.replace(/[^A-Za-z0-9]/g, '');
  const candidates = [
    ...guesses.flatMap((t) => [['greenhouse', t], ['lever', t], ['ashby', t], ['workable', t]]),
    ['smartrecruiters', pascal], ['smartrecruiters', guesses[0]],
  ];
  const found = [];
  await Promise.all(candidates.map(async ([ats, token]) => {
    try {
      const jobs = (await ATS[ats]({ token, name })).filter((j) => j.us);
      if (jobs.length && !found.some((f) => f.ats === ats)) found.push({ ats, token, name, jobs: jobs.length, recent: jobs.filter(isRecent).length });
    } catch { /* not on this platform */ }
  }));
  return found;
}

const isRecent = (j) => j.posted_at && Date.parse(j.posted_at) >= Date.now() - MAX_AGE_DAYS * 864e5;

/** Checks a board works; returns { jobs: US jobs, recent: US jobs from the last MAX_AGE_DAYS days }. */
export async function verifyBoard({ ats, token, name }) {
  const jobs = (await ATS[ats]({ token, name })).filter((j) => j.us);
  return { jobs: jobs.length, recent: jobs.filter(isRecent).length };
}

// ---- Aggregators (no key needed) ---------------------------------------------------------------

async function remotive() {
  const data = await fetchJson('https://remotive.com/api/remote-jobs', { timeout: 60_000 });
  return (data.jobs || []).map((j) => job({
    external_id: `remotive-${j.id}`, source: 'Remotive', title: j.title, company: j.company_name,
    location: `Remote (${j.candidate_required_location || 'Anywhere'})`, url: j.url, description: htmlToText(j.description),
    tags: j.tags || [], salary: j.salary || '', job_type: (j.job_type || '').replace('_', '-'),
    posted_at: iso(j.publication_date && !/[zZ+]/.test(j.publication_date.slice(10)) ? `${j.publication_date}Z` : j.publication_date),
  }, j.candidate_required_location, { remote: true }));
}

async function remoteok() {
  // Remote OK's API terms ask for a link back and credit: postings link to remoteok.com and show "Remote OK" as the source.
  const data = await fetchJson('https://remoteok.com/api', { timeout: 60_000 });
  return (Array.isArray(data) ? data : []).filter((j) => j.id && j.position).map((j) => job({
    external_id: `remoteok-${j.id}`, source: 'Remote OK', title: j.position, company: j.company,
    location: j.location ? `Remote (${j.location})` : 'Remote', url: j.url, description: htmlToText(j.description),
    tags: j.tags || [], salary: range(j.salary_min, j.salary_max, '/yr'), job_type: '', posted_at: iso(j.date) || iso(j.epoch),
  }, j.location, { remote: true }));
}

async function themuse() {
  const pages = Number(process.env.THE_MUSE_PAGES) || 20;
  const key = process.env.THE_MUSE_API_KEY ? `&api_key=${encodeURIComponent(process.env.THE_MUSE_API_KEY)}` : '';
  const jobs = [];
  for (let page = 1; page <= pages; page++) {
    const data = await fetchJson(`https://www.themuse.com/api/public/jobs?page=${page}&location=United%20States${key}`);
    for (const j of data.results || []) {
      const locations = (j.locations || []).map((l) => l.name);
      jobs.push(job({
        external_id: `themuse-${j.id}`, source: 'The Muse', title: j.name, company: j.company?.name || '',
        location: locations.join('; '), url: j.refs?.landing_page, description: htmlToText(j.contents),
        tags: (j.categories || []).map((c) => c.name), salary: '', job_type: (j.levels || []).map((l) => l.name).join(', '),
        posted_at: iso(j.publication_date),
      }, locations, {}));
    }
    if (page >= (data.page_count || 0)) break;
  }
  return jobs;
}

// ---- Aggregators that need a free API key (enabled when the key is set) ------------------------

/** Search terms: users' target job titles, so keyword-based aggregators return relevant postings. */
const termsOf = (searchTerms) => (searchTerms.length ? searchTerms : ['software engineer', 'data analyst', 'product manager']).slice(0, 8);

async function adzuna(searchTerms) {
  // https://developer.adzuna.com/docs/search — aggregates postings from thousands of US job boards and employer sites.
  const { ADZUNA_APP_ID: id, ADZUNA_APP_KEY: key } = process.env;
  const pages = Number(process.env.ADZUNA_PAGES) || 2;
  const jobs = [];
  for (const what of termsOf(searchTerms)) {
    for (let page = 1; page <= pages; page++) {
      const q = new URLSearchParams({ app_id: id, app_key: key, results_per_page: '50', what, max_days_old: '30', sort_by: 'date', 'content-type': 'application/json' });
      const data = await fetchJson(`https://api.adzuna.com/v1/api/jobs/us/search/${page}?${q}`);
      for (const j of data.results || []) {
        const area = j.location?.area || [];
        jobs.push(job({
          external_id: `adzuna-${j.id}`, source: 'Adzuna', title: htmlToText(j.title), company: j.company?.display_name || '',
          location: j.location?.display_name || '', url: j.redirect_url, description: htmlToText(j.description),
          tags: [j.category?.label].filter(Boolean), salary: j.salary_is_predicted === '1' ? '' : range(j.salary_min, j.salary_max, '/yr'),
          job_type: (j.contract_time || '').replace('_', '-'), posted_at: iso(j.created),
        }, [area.slice(1, 2).join(''), j.location?.display_name].filter(Boolean), { country: area[0] === 'US' ? 'US' : area[0] }));
      }
      if ((data.results || []).length < 50) break;
    }
  }
  return jobs;
}

async function usajobs(searchTerms) {
  // https://developer.usajobs.gov/api-reference/get-api-search — official US federal government jobs.
  const headers = { Host: 'data.usajobs.gov', 'User-Agent': process.env.USAJOBS_EMAIL, 'Authorization-Key': process.env.USAJOBS_API_KEY };
  const jobs = [];
  for (const keyword of termsOf(searchTerms)) {
    const q = new URLSearchParams({ Keyword: keyword, DatePosted: '30', ResultsPerPage: '250', SortField: 'opendate', SortDirection: 'desc' });
    const data = await fetchJson(`https://data.usajobs.gov/api/search?${q}`, { headers });
    for (const item of data.SearchResult?.SearchResultItems || []) {
      const d = item.MatchedObjectDescriptor || {};
      const places = [].concat(d.PositionLocation || []);
      const pay = [].concat(d.PositionRemuneration || [])[0];
      jobs.push(job({
        external_id: `usajobs-${d.PositionID || item.MatchedObjectId}`, source: 'USAJOBS', title: d.PositionTitle, company: d.OrganizationName || d.DepartmentName || 'US Government',
        location: d.PositionLocationDisplay || places.map((p) => p.LocationName).join('; '), url: [].concat(d.ApplyURI || [])[0] || d.PositionURI,
        description: [d.UserArea?.Details?.JobSummary, d.QualificationSummary].filter(Boolean).join('\n\n'),
        tags: [].concat(d.JobCategory || []).map((c) => c.Name).filter(Boolean),
        salary: pay ? range(Number(pay.MinimumRange), Number(pay.MaximumRange), pay.RateIntervalCode === 'PH' ? '/hr' : '/yr') : '',
        job_type: [].concat(d.PositionSchedule || []).map((s) => s.Name).join(', '), posted_at: iso(d.PublicationStartDate),
      }, places.map((p) => [p.CityName, p.CountrySubDivisionCode, p.CountryCode].filter(Boolean).join(', ')), { defaultUS: true }));
    }
  }
  return jobs;
}

async function jsearch(searchTerms) {
  // JSearch (RapidAPI / OpenWeb Ninja) searches Google for Jobs, which includes LinkedIn, Indeed, Glassdoor and ZipRecruiter.
  // Field names follow JSearch's published response format; read defensively since they couldn't be verified without a key.
  const headers = { 'X-RapidAPI-Key': process.env.JSEARCH_API_KEY, 'X-RapidAPI-Host': 'jsearch.p.rapidapi.com' };
  const pages = Number(process.env.JSEARCH_PAGES) || 3;
  const jobs = [];
  for (const term of termsOf(searchTerms)) {
    const q = new URLSearchParams({ query: `${term} in USA`, page: '1', num_pages: String(pages), date_posted: 'month', country: 'us' });
    const data = await fetchJson(`https://jsearch.p.rapidapi.com/search?${q}`, { headers, timeout: 45_000 });
    for (const j of data.data || []) {
      if (!j.job_id || !j.job_title) continue;
      const per = j.job_salary_period === 'HOUR' ? '/hr' : '/yr';
      jobs.push(job({
        external_id: `jsearch-${j.job_id}`, source: j.job_publisher || 'JSearch', title: j.job_title, company: j.employer_name || '',
        location: [j.job_city, j.job_state].filter(Boolean).join(', ') || (j.job_is_remote ? 'Remote' : ''), url: j.job_apply_link || j.job_google_link,
        description: j.job_description || '', tags: [], salary: range(j.job_min_salary, j.job_max_salary, per),
        job_type: (j.job_employment_type || '').toLowerCase().replace('_', '-'), posted_at: iso(j.job_posted_at_datetime_utc) || iso(j.job_posted_at_timestamp),
      }, [[j.job_city, j.job_state].filter(Boolean).join(', ')], { country: j.job_country, remote: !!j.job_is_remote }));
    }
  }
  return jobs;
}

/**
 * Every enabled source as { key, label, full, run }.
 * extraBoards: companies users added in the app (company_boards table), on top of the built-in list.
 */
export function sourceList(searchTerms = [], extraBoards = []) {
  const boards = [...builtInBoards()];
  for (const b of extraBoards) if (ATS[b.ats] && !boards.some((x) => x.ats === b.ats && x.token === b.token)) boards.push(b);
  const list = boards.map((b) => ({ key: `${b.ats}:${b.token}`, label: b.name, full: true, run: () => ATS[b.ats](b) }));
  list.push(
    { key: 'amazon', label: 'Amazon', full: false, run: amazon },
    { key: 'remotive', label: 'Remotive', full: true, run: remotive },
    { key: 'remoteok', label: 'Remote OK', full: true, run: remoteok },
    { key: 'themuse', label: 'The Muse', full: false, run: themuse },
  );
  if (process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY) list.push({ key: 'adzuna', label: 'Adzuna', full: false, run: () => adzuna(searchTerms) });
  if (process.env.USAJOBS_API_KEY && process.env.USAJOBS_EMAIL) list.push({ key: 'usajobs', label: 'USAJOBS', full: false, run: () => usajobs(searchTerms) });
  if (process.env.JSEARCH_API_KEY) list.push({ key: 'jsearch', label: 'JSearch (LinkedIn, Indeed, Glassdoor…)', full: false, run: () => jsearch(searchTerms) });
  return list;
}
