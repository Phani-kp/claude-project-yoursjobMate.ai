// Fictional demo listings used only when the public job APIs can't be reached (e.g. offline dev).
const companies = ['Acme Cloud', 'Nimbus Labs', 'BrightPath Health', 'Orbit Fintech', 'Lumen Analytics', 'Northwind Retail', 'Quanta AI', 'Bluefin Logistics'];
const roles = [
  ['Frontend Engineer', ['react', 'typescript', 'css', 'javascript']],
  ['Full Stack Developer', ['node.js', 'react', 'postgresql', 'javascript']],
  ['Backend Engineer', ['python', 'django', 'aws', 'sql']],
  ['Data Analyst', ['sql', 'python', 'tableau', 'excel']],
  ['DevOps Engineer', ['kubernetes', 'docker', 'aws', 'terraform']],
  ['Machine Learning Engineer', ['python', 'pytorch', 'ml', 'llm']],
  ['Product Manager', ['roadmap', 'agile', 'analytics', 'stakeholder']],
  ['QA Automation Engineer', ['selenium', 'playwright', 'javascript', 'ci']],
  ['Java Developer', ['java', 'spring', 'microservices', 'sql']],
];
const locations = [['Remote', true], ['New York, NY', false], ['Austin, TX', false], ['Remote (US)', true], ['San Francisco, CA', false], ['Hyderabad, India', false], ['Bengaluru, India', false], ['London, UK', false]];

export const SAMPLE_JOBS = roles.flatMap(([title, tags], i) =>
  [0, 1, 2].map((k) => {
    const company = companies[(i + k * 3) % companies.length];
    const [location, remote] = locations[(i * 2 + k) % locations.length];
    const level = ['', 'Senior ', 'Junior '][k];
    return {
      external_id: `sample-${i}-${k}`,
      source: 'sample',
      title: `${level}${title}`,
      company,
      location,
      remote,
      salary: `$${90 + i * 10 + k * 15}k - $${120 + i * 10 + k * 15}k`,
      job_type: 'Full-time',
      url: '',
      description: `${company} is hiring a ${level}${title}. You will work with ${tags.join(', ')} to ship features for our customers. We value ownership, clear communication and continuous learning.`,
      tags,
      posted_at: new Date(Date.now() - (i * 3 + k) * 36e5).toISOString(),
    };
  }),
);
