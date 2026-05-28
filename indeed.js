// ─────────────────────────────────────────────────────────────────────────────
// indeed.js – CareerDog content script for Indeed job pages
//
// Supports:
//   https://www.indeed.com/viewjob?jk={id}          (direct job view)
//   https://www.indeed.com/jobs?...&vjk={id}         (search panel)
//
// Strategy:
//   Title       → h1 with data-testid / class / og:title parse
//   Company     → data-testid selectors → class selectors → og:title parse
//   Description → #jobDescriptionText (very stable) → class fallbacks
//   URL         → canonical /viewjob?jk= from jk/vjk param → location.href
// ─────────────────────────────────────────────────────────────────────────────

if (!window.__careerDogIndeed) {
  window.__careerDogIndeed = true;

  const LOG = (...a) => console.log('[CareerDog Indeed]', ...a);

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Convert an HTML element to readable plain text (bullets + paragraphs). */
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
   * Parse Indeed og:title / document.title → { title, company }
   *
   * Known formats:
   *   "Job Title - Company - City, State | Indeed.com"
   *   "Job Title - Company | Indeed.com"
   *   "Company is hiring Job Title in City | Indeed"
   */
  function parseMeta(raw) {
    // Strip trailing "| Indeed.com" or "| Indeed"
    const s = (raw || '').replace(/\s*\|\s*Indeed.*$/i, '').trim();

    // "Company is hiring Job Title in Location"
    const hiringM = s.match(/^(.+?)\s+is hiring\s+(.+?)(?:\s+in\s+.+)?$/i);
    if (hiringM) return { title: hiringM[2].trim(), company: hiringM[1].trim() };

    // "Job Title - Company - Location"  or  "Job Title - Company"
    const parts = s.split(/\s+-\s+/);
    if (parts.length >= 2) return { title: parts[0].trim(), company: parts[1].trim() };

    return { title: s, company: '' };
  }

  // ── Main extractor ─────────────────────────────────────────────────────────

  function extractJob() {
    LOG('── extractJob ──', location.href);

    // ── Canonical job ID + URL ────────────────────────────────────────────────
    const params = new URLSearchParams(location.search);
    const jobKey = params.get('jk') || params.get('vjk');
    const jobUrl = jobKey
      ? `https://www.indeed.com/viewjob?jk=${jobKey}`
      : location.href;
    LOG('jobKey:', jobKey, '| jobUrl:', jobUrl);

    // ── Title ─────────────────────────────────────────────────────────────────
    let title = '';

    const titleEl = document.querySelector(
      '[data-testid="jobsearch-JobInfoHeader-title"], ' +
      'h1.jobsearch-JobInfoHeader-title, ' +
      '[class*="JobInfoHeader-title"], ' +
      '[class*="jobTitle"] h1, ' +
      'h1'
    );
    if (titleEl) {
      title = titleEl.textContent.trim();
      LOG('✅ title from DOM:', title);
    }

    // Fallback: og:title parse
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

    // Fallback: og:title parse
    if (!company) {
      const ogRaw = document.querySelector('meta[property="og:title"]')?.content
                 || document.title || '';
      ({ company } = parseMeta(ogRaw));
      if (company) LOG('✅ company from meta:', company);
    }

    // ── Description ───────────────────────────────────────────────────────────
    let description = '';

    const descEl = document.querySelector(
      '#jobDescriptionText, ' +               // most stable Indeed selector
      '[id*="jobDescription"], ' +
      '[class*="jobDescriptionText"], ' +
      '[class*="jobDescription"], ' +
      '[data-testid="jobDescriptionText"]'
    );

    if (descEl) {
      description = toText(descEl);
      LOG('✅ description via selector, length:', description.length);
    }

    // Fallback: og:description
    if (!description) {
      description =
        document.querySelector('meta[property="og:description"]')?.content?.trim() ||
        document.querySelector('meta[name="description"]')?.content?.trim() || '';
      if (description) LOG('ℹ️ description from meta');
    }

    LOG('── result ──', { title, company, descLen: description.length, jobUrl });
    return Promise.resolve({ title, company, description, url: jobUrl });
  }

  // ── Message listener ────────────────────────────────────────────────────────

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
