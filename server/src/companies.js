/**
 * Company career sites pulled directly from the employer's applicant tracking system (ATS). Every board here was
 * checked to exist and list jobs. Postings come from the employer itself, so they're the freshest source, and
 * "Apply" goes straight to the company's own application page.
 *
 * More companies can be added three ways, none needing a code change:
 *  - In the app: search for a company on Job Matches and click "Find jobs on <company>'s career site", or paste
 *    a careers-page link (Greenhouse, Lever, Ashby, Workday, SmartRecruiters or Workable).
 *  - EXTRA_COMPANY_BOARDS=greenhouse:acme:Acme Inc,workday:acme|wd5|External:Acme
 *  - Adding them below.
 * Workday tokens are "tenant|wdN|site", from https://<tenant>.<wdN>.myworkdayjobs.com/<site>.
 */
export const COMPANY_BOARDS = {
  greenhouse: {
    airbnb: 'Airbnb', stripe: 'Stripe', figma: 'Figma', discord: 'Discord', robinhood: 'Robinhood', coinbase: 'Coinbase',
    doordashusa: 'DoorDash', lyft: 'Lyft', pinterest: 'Pinterest', reddit: 'Reddit', dropbox: 'Dropbox', instacart: 'Instacart',
    gitlab: 'GitLab', cloudflare: 'Cloudflare', databricks: 'Databricks', datadog: 'Datadog', mongodb: 'MongoDB', okta: 'Okta',
    twilio: 'Twilio', asana: 'Asana', airtable: 'Airtable', brex: 'Brex', chime: 'Chime', gusto: 'Gusto', scaleai: 'Scale AI',
    anthropic: 'Anthropic', duolingo: 'Duolingo', squarespace: 'Squarespace', flexport: 'Flexport', samsara: 'Samsara',
    affirm: 'Affirm', sofi: 'SoFi', carta: 'Carta', elastic: 'Elastic', nuro: 'Nuro', waymo: 'Waymo', roblox: 'Roblox',
    peloton: 'Peloton', betterment: 'Betterment', calendly: 'Calendly', vercel: 'Vercel', netlify: 'Netlify', lattice: 'Lattice',
    block: 'Block', relativity: 'Relativity Space', verkada: 'Verkada', faire: 'Faire', nextdoor: 'Nextdoor', klaviyo: 'Klaviyo',
    mixpanel: 'Mixpanel', spacex: 'SpaceX', gemini: 'Gemini', epicgames: 'Epic Games', twitch: 'Twitch', zocdoc: 'Zocdoc',
    applovin: 'AppLovin', udemy: 'Udemy', coursera: 'Coursera', oscar: 'Oscar Health', khanacademy: 'Khan Academy',
    riotgames: 'Riot Games', lucidmotors: 'Lucid Motors', offerup: 'OfferUp', hubspotjobs: 'HubSpot', toast: 'Toast',
    godaddy: 'GoDaddy', hootsuite: 'Hootsuite', sproutsocial: 'Sprout Social', pandadoc: 'PandaDoc', wrike: 'Wrike',
    smartsheet: 'Smartsheet', intercom: 'Intercom', salesloft: 'Salesloft', fivetran: 'Fivetran', pendo: 'Pendo',
    zoominfo: 'ZoomInfo', launchdarkly: 'LaunchDarkly', honeycomb: 'Honeycomb', newrelic: 'New Relic', sumologic: 'Sumo Logic',
    circleci: 'CircleCI', buildkite: 'Buildkite', pagerduty: 'PagerDuty', jfrog: 'JFrog', dashlane: 'Dashlane',
    abnormalsecurity: 'Abnormal Security', netskope: 'Netskope', zscaler: 'Zscaler', lastpass: 'LastPass', bitwarden: 'Bitwarden',
    adyen: 'Adyen', wise: 'Wise', mercury: 'Mercury', payoneer: 'Payoneer', billcom: 'BILL', tripactions: 'Navan',
    justworks: 'Justworks', greenhouse: 'Greenhouse', glossier: 'Glossier', everlane: 'Everlane', stitchfix: 'Stitch Fix',
    kodiak: 'Kodiak Robotics', motional: 'Motional', stockx: 'StockX', astranis: 'Astranis', veracyte: 'Veracyte',
    rocketlab: 'Rocket Lab', axiom: 'Axiom Space', talkspace: 'Talkspace', cloverhealth: 'Clover Health', doximity: 'Doximity',
    onemedical: 'One Medical', current: 'Current', earnin: 'EarnIn', upstart: 'Upstart', oportun: 'Oportun', sezzle: 'Sezzle',
    axios: 'Axios', xai: 'xAI', masterclass: 'MasterClass', dialpad: 'Dialpad', vonage: 'Vonage', bandwidth: 'Bandwidth',
    cockroachlabs: 'Cockroach Labs', yugabyte: 'Yugabyte', planetscale: 'PlanetScale', dremio: 'Dremio', imply: 'Imply',
    singlestore: 'SingleStore', coupang: 'Coupang', starburst: 'Starburst', lightmatter: 'Lightmatter', tenstorrent: 'Tenstorrent',
    chargepoint: 'ChargePoint',
  },
  lever: {
    zoox: 'Zoox', spotify: 'Spotify', aledade: 'Aledade', jumpcloud: 'JumpCloud', wealthfront: 'Wealthfront',
    outreach: 'Outreach', rover: 'Rover', palantir: 'Palantir', matchgroup: 'Match Group', fly: 'Fly.io', houzz: 'Houzz',
    gopuff: 'Gopuff', anchorage: 'Anchorage Digital', jamcity: 'Jam City',
  },
  ashby: {
    openai: 'OpenAI', ramp: 'Ramp', notion: 'Notion', linear: 'Linear', replit: 'Replit', perplexity: 'Perplexity', vanta: 'Vanta',
    posthog: 'PostHog', supabase: 'Supabase', clerk: 'Clerk', modal: 'Modal', elevenlabs: 'ElevenLabs', pinecone: 'Pinecone',
    cohere: 'Cohere', weaviate: 'Weaviate', runway: 'Runway', zapier: 'Zapier', harvey: 'Harvey', cursor: 'Cursor', airbyte: 'Airbyte',
    hex: 'Hex', character: 'Character.AI', baseten: 'Baseten', decagon: 'Decagon', sierra: 'Sierra', plaid: 'Plaid',
    webflow: 'Webflow', warp: 'Warp', miro: 'Miro', pika: 'Pika', snowflake: 'Snowflake', suno: 'Suno', synthesia: 'Synthesia',
    benchling: 'Benchling', ashby: 'Ashby', eightsleep: 'Eight Sleep', oyster: 'Oyster', whoop: 'WHOOP', render: 'Render',
    railway: 'Railway', drata: 'Drata', semgrep: 'Semgrep', secureframe: 'Secureframe', snyk: 'Snyk', socket: 'Socket',
    kalshi: 'Kalshi', polymarket: 'Polymarket', clickup: 'ClickUp', sentry: 'Sentry', prefect: 'Prefect', cartesia: 'Cartesia',
    astronomer: 'Astronomer', temporal: 'Temporal', deepgram: 'Deepgram', abridge: 'Abridge', nabla: 'Nabla', legora: 'Legora',
    saronic: 'Saronic', shieldai: 'Shield AI',
  },
  smartrecruiters: {
    ServiceNow: 'ServiceNow', BoschGroup: 'Bosch', AbbVie: 'AbbVie', Experian: 'Experian', WesternDigital: 'Western Digital',
    Equinox: 'Equinox', Canva: 'Canva',
  },
  workday: {
    'nvidia|wd5|NVIDIAExternalCareerSite': 'NVIDIA', 'salesforce|wd12|External_Career_Site': 'Salesforce', 'adobe|wd5|external_experienced': 'Adobe',
    'capitalone|wd12|Capital_One': 'Capital One', 'cisco|wd5|Cisco_Careers': 'Cisco', 'ghr|wd1|lateral-us': 'Bank of America',
    'ngc|wd1|Northrop_Grumman_External_Site': 'Northrop Grumman', 'intel|wd1|External': 'Intel', 'hp|wd5|ExternalCareerSite': 'HP',
    'paypal|wd1|jobs': 'PayPal', 'broadcom|wd1|External_Career': 'Broadcom', 'mastercard|wd1|CorporateCareers': 'Mastercard',
    'micron|wd1|External': 'Micron', 'boeing|wd1|EXTERNAL_CAREERS': 'Boeing', 'jj|wd5|JJ': 'Johnson & Johnson', 'target|wd5|targetcareers': 'Target',
    'disney|wd5|disneycareer': 'Disney', 'wf|wd1|WellsFargoJobs': 'Wells Fargo', 'nike|wd1|nke': 'Nike', 'cvshealth|wd1|CVS_Health_Careers': 'CVS Health',
    'generalmotors|wd5|Careers_GM': 'General Motors', 'pfizer|wd1|PfizerCareers': 'Pfizer', 'fmr|wd1|FidelityCareers': 'Fidelity Investments',
    'humana|wd5|Humana_External_Career_Site': 'Humana', 'crowdstrike|wd5|crowdstrikecareers': 'CrowdStrike', '3m|wd1|Search': '3M',
    'zoom|wd5|Zoom': 'Zoom', 'autodesk|wd1|Ext': 'Autodesk', 'gilead|wd1|gileadcareers': 'Gilead Sciences', 'blackrock|wd1|BlackRock_Professional': 'BlackRock',
    'pwc|wd3|Global_Experienced_Careers': 'PwC', 'amgen|wd1|Careers': 'Amgen', 'workday|wd5|Workday': 'Workday', 'lowes|wd5|LWS_External_CS': "Lowe's",
    'statestreet|wd1|Global': 'State Street', 'att|wd1|ATTGeneral': 'AT&T', 'tmobile|wd1|External': 'T-Mobile', 'usbank|wd1|US_Bank_Careers': 'U.S. Bank',
    'accenture|wd103|AccentureCareers': 'Accenture', 'sonyglobal|wd1|SonyGlobalCareers': 'Sony', 'ebay|wd5|apply': 'eBay',
    'medtronic|wd1|MedtronicCareers': 'Medtronic', 'redhat|wd5|jobs': 'Red Hat', 'homedepot|wd5|CareerDepot': 'The Home Depot', 'pnc|wd5|External': 'PNC',
    'analogdevices|wd1|External': 'Analog Devices', 'geaerospace|wd5|GE_ExternalSite': 'GE Aerospace', 'abbott|wd5|abbottcareers': 'Abbott',
    'motorolasolutions|wd5|Careers': 'Motorola Solutions', 'citi|wd5|2': 'Citi', 'kla|wd1|Search': 'KLA', 'bah|wd1|BAH_Jobs': 'Booz Allen Hamilton',
    'leidos|wd5|External': 'Leidos',
  },
};

export const ATS_LABELS = { greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', smartrecruiters: 'SmartRecruiters', workday: 'Workday', workable: 'Workable' };

/** Built-in boards plus EXTRA_COMPANY_BOARDS, as { ats, token, name }. */
export function builtInBoards() {
  const boards = Object.entries(COMPANY_BOARDS).flatMap(([ats, list]) => Object.entries(list).map(([token, name]) => ({ ats, token, name })));
  for (const entry of (process.env.EXTRA_COMPANY_BOARDS || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const [ats, token, ...name] = entry.split(':');
    if (ATS_LABELS[ats] && token && !boards.some((b) => b.ats === ats && b.token === token)) boards.push({ ats, token, name: name.join(':') || token });
  }
  return boards;
}
