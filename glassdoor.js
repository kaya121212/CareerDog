// ─────────────────────────────────────────────────────────────────────────────
// glassdoor.js – CareerDog content script for Glassdoor job pages
//
// Supports:
//   https://www.glassdoor.com/job-listing/*
//   https://www.glassdoor.com/Jobs/*
//   https://www.glassdoor.com/partner/jobListing.htm*
//
// Strategy:
//   Title       → data-test selectors → heading text → og:title parse
//   Company     → data-test selectors → employer link → og:title parse
//   Description → data-test="jobDescriptionContent" → class fallbacks
//   URL         → canonical link → location.href
// ─────────────────────────────────────────────────────────────────────────────

if (!window.__careerDogGlassdoor) {
  window.__careerDogGlassdoor = true;

  const LOG = (...a) => console.log('[CareerDog Glassdoor]', ...a);

  function toText(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('[aria-hidden="true"], button, svg, img, style, script').forEach(n => n.remove());
    clone.querySelectorAll('p, div, br, h1, h2, h3, h4, h5').forEach(n => n.after(document.createTextNode('\n')));
    clone.querySelectorAll('li').forEach(n => {
      n.prepend(document.createTextNode('• '));
      n.after(document.createTextNode('\n'));
    });
    return clone.textContent
      .split('\n').map(l => l.trim())
      .reduce((acc, l) => {
        if (l === '' && acc[acc.length - 1] === '') return acc;
        acc.push(l);
        return acc;
      }, [])
      .join('\n').trim();
  }

  /**
   * Parse Glassdoor og:title / document.title → { title, company }
   *
   * Known formats:
   *   "Job Title at Company | Glassdoor"
   *   "Job Title - Company | Glassdoor"
   *   "Company Job Title Jobs | Glassdoor"
   */
  function parseMeta(raw) {
    const s = (raw || '').replace(/\s*\|\s*Glassdoor.*$/i, '').trim();

    // "Job Title at Company"
    const atMatch = s.match(/^(.+?)\s+at\s+(.+)$/i);
    if (atMatch) return { title: atMatch[1].trim(), company: atMatch[2].trim() };

    // "Job Title - Company"
    const parts = s.split(/\s+-\s+/);
    if (parts.length >= 2) return { title: parts[0].trim(), company: parts[1].trim() };

    return { title: s, company: '' };
  }

  function extractJob() {
    LOG('── extractJob ──', location.href);

    // ── Scope to the right-side detail panel to avoid matching left-list cards ─
    const panel =
      document.querySelector('[class*="TwoColumnLayout_columnRight"]') ||
      document.querySelector('[class*="JobDetails_jobDetailsContainer"]') ||
      document;

    // ── URL ───────────────────────────────────────────────────────────────────
    const canonical = document.querySelector('link[rel="canonical"]')?.href;
    const jobUrl = canonical || location.href;
    LOG('jobUrl:', jobUrl);

    // ── Title ─────────────────────────────────────────────────────────────────
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
      const ogRaw = document.querySelector('meta[property="og:title"]')?.content
                 || document.title || '';
      LOG('og:title raw:', ogRaw);
      ({ title } = parseMeta(ogRaw));
      LOG('title from meta:', title);
    }

    if (!title) {
      LOG('❌ No title found');
      return Promise.reject('NOT_FOUND');
    }

    // ── Company ───────────────────────────────────────────────────────────────
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
      const ogRaw = document.querySelector('meta[property="og:title"]')?.content
                 || document.title || '';
      ({ company } = parseMeta(ogRaw));
      if (company) LOG('✅ company from meta:', company);
    }

    // ── Description ───────────────────────────────────────────────────────────
    let description = '';

    const descEl = panel.querySelector(
      '[class*="JobDetails_jobDescription"], ' +
      '[data-test="jobDescriptionContent"], ' +
      '[class*="jobDescriptionContent"], ' +
      '[class*="JobDescriptionContent"], ' +
      '#JobDescriptionContainer'
    );

    if (descEl) {
      description = toText(descEl);
      LOG('✅ description via selector, length:', description.length);
    }

    if (!description) {
      description =
        document.querySelector('meta[property="og:description"]')?.content?.trim() ||
        document.querySelector('meta[name="description"]')?.content?.trim() || '';
      if (description) LOG('ℹ️ description from meta');
    }

    LOG('── result ──', { title, company, descLen: description.length, jobUrl });
    return Promise.resolve({ title, company, description, url: jobUrl });
  }

  chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
    if (req.type !== 'GET_JOB') return;
    LOG('GET_JOB received');
    extractJob()
      .then(sendResponse)
      .catch(err => {
        LOG('❌ error:', err);
        sendResponse({ error: err === 'NOT_FOUND' ? 'NOT_FOUND' : 'EXTRACT_FAILED' });
      });
    return true;
  });

  LOG('loaded on', location.href);
}
