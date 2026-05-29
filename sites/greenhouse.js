// ─────────────────────────────────────────────────────────────────────────────
// sites/greenhouse.js – CareerDog extractor for Greenhouse job boards
//
// Supports:
//   https://job-boards.greenhouse.io/{company}/jobs/{id}   (new board)
//   https://boards.greenhouse.io/{company}/jobs/{id}       (legacy board)
//
// Strategy:
//   Title       → h1 element (single, reliable across all Greenhouse boards)
//   Company     → og:title parse → logo img alt → URL slug
//   Description → CSS selectors → og:description fallback
//
// Depends on: shared/utils.js (CareerDog.toText, CareerDog.register)
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  const LOG = (...a) => console.log('[CareerDog Greenhouse]', ...a);

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Parse Greenhouse og:title → { title, company }
   *
   * Formats:
   *   "Job Title at Company"
   *   "Job Title | Company | Greenhouse"
   *   "Job Title - Company | Greenhouse"
   */
  function parseMeta(raw) {
    const s = (raw || '').replace(/[\s|–-]+Greenhouse\s*$/i, '').trim();
    const atM = s.match(/^(.+?)\s+at\s+(.+)$/i);
    if (atM) return { title: atM[1].trim(), company: atM[2].trim() };
    const parts = s.split(/\s*\|\s*/);
    if (parts.length >= 2 && parts[1].trim())
      return { title: parts[0].trim(), company: parts[1].trim() };
    const dashM = s.match(/^(.+?)\s+-\s+(.+)$/);
    if (dashM) return { title: dashM[1].trim(), company: dashM[2].trim() };
    return { title: s, company: '' };
  }

  // ── Extractor ─────────────────────────────────────────────────────────────

  function extractJob() {
    LOG('── extractJob ──', location.href);

    // ── Title ────────────────────────────────────────────────────────────────
    let title = '';
    const h1 = document.querySelector('h1.app-title, h1');
    if (h1) { title = h1.textContent.trim(); LOG('✅ title from h1:', title); }
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
    const ogRaw =
      document.querySelector('meta[property="og:title"]')?.content ||
      document.title || '';
    ({ company } = parseMeta(ogRaw));
    if (company) LOG('✅ company from meta:', company);

    if (!company) {
      const logoImg = document.querySelector('img[alt*="Logo"], img[alt*="logo"]');
      if (logoImg) {
        company = logoImg.alt.replace(/\s*(logo|Logo)\s*$/i, '').trim();
        if (company) LOG('✅ company from img alt:', company);
      }
    }

    if (!company) {
      const m = location.pathname.match(/^\/([^/]+)\/jobs\//);
      if (m) {
        company = m[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        LOG('✅ company from URL slug:', company);
      }
    }

    // ── Description ──────────────────────────────────────────────────────────
    let description = '';
    const descEl = document.querySelector(
      '[class*="job__description"], ' +
      '#content, ' +
      '[id*="job_description"], ' +
      '[class*="job-description"], ' +
      '[class*="description__body"]'
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
    return Promise.resolve({ title, company, description, url: location.href });
  }

  CareerDog.register('__careerDogGreenhouse', extractJob, 'Greenhouse');
})();
