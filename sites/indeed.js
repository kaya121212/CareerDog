// ─────────────────────────────────────────────────────────────────────────────
// sites/indeed.js – CareerDog extractor for Indeed job pages
//
// Supports:
//   https://www.indeed.com/viewjob?jk={id}
//   https://www.indeed.com/jobs?...&vjk={id}
//
// Strategy:
//   Title       → data-testid / class selectors → og:title parse
//   Company     → data-testid / class selectors → og:title parse
//   Description → #jobDescriptionText → class fallbacks → og:description
//   URL         → canonical /viewjob?jk= from jk/vjk param → location.href
//
// Depends on: shared/utils.js (CareerDog.toText, CareerDog.register)
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  const LOG = (...a) => console.log('[CareerDog Indeed]', ...a);

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Parse Indeed og:title → { title, company }
   *
   * Formats:
   *   "Job Title - Company - City, State | Indeed.com"
   *   "Job Title - Company | Indeed.com"
   *   "Company is hiring Job Title in City | Indeed"
   */
  function parseMeta(raw) {
    const s = (raw || '').replace(/\s*\|\s*Indeed.*$/i, '').trim();
    const hiringM = s.match(/^(.+?)\s+is hiring\s+(.+?)(?:\s+in\s+.+)?$/i);
    if (hiringM) return { title: hiringM[2].trim(), company: hiringM[1].trim() };
    const parts = s.split(/\s+-\s+/);
    if (parts.length >= 2) return { title: parts[0].trim(), company: parts[1].trim() };
    return { title: s, company: '' };
  }

  // ── Extractor ─────────────────────────────────────────────────────────────

  function extractJob() {
    LOG('── extractJob ──', location.href);

    // ── Canonical URL ────────────────────────────────────────────────────────
    const params = new URLSearchParams(location.search);
    const jobKey = params.get('jk') || params.get('vjk');
    const jobUrl = jobKey
      ? `https://www.indeed.com/viewjob?jk=${jobKey}`
      : location.href;

    // ── Title ────────────────────────────────────────────────────────────────
    let title = '';
    const titleEl = document.querySelector(
      '.jobsearch-JobInfoHeader-title, ' +
      '[data-testid*="jobsearch-JobInfoHeader-title"], ' +
      '[class*="JobInfoHeader-title"]'
    );
    if (titleEl) {
      title = titleEl.textContent.trim().replace(/\s*-\s*job post\s*$/i, '').trim();
      LOG('✅ title from DOM:', title);
    }
    if (!title) {
      const ogRaw =
        document.querySelector('meta[property="og:title"]')?.content ||
        document.title || '';
      ({ title } = parseMeta(ogRaw));
      LOG('title from meta:', title);
    }
    if (!title) return Promise.reject('NOT_FOUND');

    // ── Company ──────────────────────────────────────────────────────────────
    let company = '';
    const companyEl = document.querySelector(
      '[data-testid="inlineHeader-companyName"], ' +
      '[data-testid="jobsearch-JobInfoHeader-companyName"], ' +
      '[data-company-name], ' +
      '[class*="companyName"], ' +
      '[class*="CompanyName"]'
    );
    if (companyEl) {
      company = companyEl.textContent.trim();
      LOG('✅ company from DOM:', company);
    }
    if (!company) {
      const ogRaw =
        document.querySelector('meta[property="og:title"]')?.content ||
        document.title || '';
      ({ company } = parseMeta(ogRaw));
      if (company) LOG('✅ company from meta:', company);
    }

    // ── Description ──────────────────────────────────────────────────────────
    let description = '';
    const descEl = document.querySelector(
      '#jobDescriptionText, ' +
      '[class*="jobDescriptionText"], ' +
      '[data-testid="jobDescriptionText"]'
    );
    if (descEl) {
      description = CareerDog.toText(descEl);
      LOG('✅ description, length:', description.length);
    }
    if (!description) {
      description =
        document.querySelector('meta[property="og:description"]')?.content?.trim() ||
        document.querySelector('meta[name="description"]')?.content?.trim() || '';
      if (description) LOG('ℹ️ description from meta');
    }

    LOG('── result ──', { title, company, descLen: description.length });
    return Promise.resolve({ title, company, description, url: jobUrl });
  }

  CareerDog.register('__careerDogIndeed', extractJob, 'Indeed');
})();
