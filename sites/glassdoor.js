// ─────────────────────────────────────────────────────────────────────────────
// sites/glassdoor.js – CareerDog extractor for Glassdoor job pages
//
// Supports:
//   https://www.glassdoor.com/Job/index.htm
//   https://www.glassdoor.com/job-listing/*
//   https://www.glassdoor.com/Jobs/*
//   https://www.glassdoor.com/partner/jobListing.htm*
//
// Strategy:
//   Panel       → TwoColumnLayout_columnRight (right detail panel only —
//                 avoids matching left-side job cards on SPA pages)
//   Title       → h1[class*="heading_Level1"] in panel
//   Company     → EmployerProfile_employerNameHeading in panel
//   Description → JobDetails_jobDescription in panel
//   URL         → canonical link → location.href
//
// Depends on: shared/utils.js (CareerDog.toText, CareerDog.register)
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  const LOG = (...a) => console.log('[CareerDog Glassdoor]', ...a);

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Parse Glassdoor og:title → { title, company }
   *
   * Formats:
   *   "Job Title at Company | Glassdoor"
   *   "Job Title - Company | Glassdoor"
   */
  function parseMeta(raw) {
    const s = (raw || '').replace(/\s*\|\s*Glassdoor.*$/i, '').trim();
    const atM = s.match(/^(.+?)\s+at\s+(.+)$/i);
    if (atM) return { title: atM[1].trim(), company: atM[2].trim() };
    const parts = s.split(/\s+-\s+/);
    if (parts.length >= 2) return { title: parts[0].trim(), company: parts[1].trim() };
    return { title: s, company: '' };
  }

  // ── Extractor ─────────────────────────────────────────────────────────────

  function extractJob() {
    LOG('── extractJob ──', location.href);

    // ── Scope to the right detail panel (SPA — left list stays stale) ────────
    const panel =
      document.querySelector('[class*="TwoColumnLayout_columnRight"]') ||
      document.querySelector('[class*="JobDetails_jobDetailsContainer"]') ||
      document;

    // ── URL ──────────────────────────────────────────────────────────────────
    const jobUrl =
      document.querySelector('link[rel="canonical"]')?.href || location.href;

    // ── Title ────────────────────────────────────────────────────────────────
    let title = '';
    const titleEl =
      panel.querySelector('h1[class*="heading_Level1"]') ||
      panel.querySelector('[data-test="job-title"]') ||
      panel.querySelector('[class*="JobDetails_jobTitle"]');
    if (titleEl) {
      title = titleEl.textContent.trim();
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
    const companyEl =
      panel.querySelector('[class*="EmployerProfile_employerNameHeading"]') ||
      panel.querySelector('[data-test="employer-name"]') ||
      panel.querySelector('[class*="EmployerName"]') ||
      panel.querySelector('[class*="employerName"]');
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
    const descEl =
      panel.querySelector('[class*="JobDetails_jobDescription"]') ||
      panel.querySelector('[data-test="jobDescriptionContent"]') ||
      panel.querySelector('[class*="jobDescriptionContent"]') ||
      panel.querySelector('#JobDescriptionContainer');
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

  CareerDog.register('__careerDogGlassdoor', extractJob, 'Glassdoor');
})();
