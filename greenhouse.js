// ─────────────────────────────────────────────────────────────────────────────
// greenhouse.js – CareerDog content script for Greenhouse job boards
//
// Supports:
//   https://job-boards.greenhouse.io/{company}/jobs/{id}   (new board)
//   https://boards.greenhouse.io/{company}/jobs/{id}       (legacy board)
//
// Strategy:
//   Title       → h1 element (single, reliable across all Greenhouse boards)
//   Company     → og:title "Job at Company" parse → img[alt] → URL slug
//   Description → #content (standard Greenhouse container) → fallbacks
// ─────────────────────────────────────────────────────────────────────────────

if (!window.__careerDogGreenhouse) {
  window.__careerDogGreenhouse = true;

  const LOG = (...a) => console.log('[CareerDog GH]', ...a);

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
   * Parse Greenhouse og:title / document.title → { title, company }
   *
   * Known formats:
   *   "Job Title at Company"
   *   "Job Title | Company | Greenhouse"
   *   "Job Title - Company | Greenhouse"
   */
  function parseMeta(raw) {
    // Strip trailing "| Greenhouse" or "- Greenhouse"
    const s = (raw || '').replace(/[\s|–-]+Greenhouse\s*$/i, '').trim();

    // "Job at Company"
    const atM = s.match(/^(.+?)\s+at\s+(.+)$/i);
    if (atM) return { title: atM[1].trim(), company: atM[2].trim() };

    // "Job | Company" (pipe separated)
    const parts = s.split(/\s*\|\s*/);
    if (parts.length >= 2 && parts[1].trim()) {
      return { title: parts[0].trim(), company: parts[1].trim() };
    }

    // "Job - Company" (dash separated)
    const dashM = s.match(/^(.+?)\s+-\s+(.+)$/);
    if (dashM) return { title: dashM[1].trim(), company: dashM[2].trim() };

    return { title: s, company: '' };
  }

  // ── Main extractor ─────────────────────────────────────────────────────────

  function extractJob() {
    LOG('── extractJob ──', location.href);

    // ── Title ────────────────────────────────────────────────────────────────
    // h1 is always the job title on Greenhouse boards
    let title = '';
    const h1 = document.querySelector('h1.app-title, h1');
    if (h1) {
      title = h1.textContent.trim();
      LOG('✅ title from h1:', title);
    }

    // Fallback: parse og:title
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

    // ── Company ──────────────────────────────────────────────────────────────
    let company = '';

    // Strategy 1: og:title parse
    const ogRaw = document.querySelector('meta[property="og:title"]')?.content
               || document.title || '';
    ({ company } = parseMeta(ogRaw));
    if (company) LOG('✅ company from meta:', company);

    // Strategy 2: company logo img alt text ("Acme Corp Logo" → "Acme Corp")
    if (!company) {
      const logoImg = document.querySelector('img[alt*="Logo"], img[alt*="logo"]');
      if (logoImg) {
        company = logoImg.alt.replace(/\s*(logo|Logo)\s*$/i, '').trim();
        if (company) LOG('✅ company from img alt:', company);
      }
    }

    // Strategy 3: URL slug (job-boards.greenhouse.io/{slug}/jobs/...)
    if (!company) {
      const m = location.pathname.match(/^\/([^/]+)\/jobs\//);
      if (m) {
        // Convert slug to title case: "ethernovia" → "Ethernovia"
        company = m[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        LOG('✅ company from URL slug:', company);
      }
    }

    // ── Description ──────────────────────────────────────────────────────────
    let description = '';

    const descEl = document.querySelector(
      '[class*="job__description"], ' +         // new board (job-boards.greenhouse.io)
      '#content, ' +                            // legacy board (boards.greenhouse.io)
      '[id*="job_description"], ' +
      '[class*="job-description"], ' +
      '[class*="description__body"]'
    );

    if (descEl) {
      description = toText(descEl);
      LOG('✅ description via selector, length:', description.length);
    }

    // Fallback: og:description meta
    if (!description) {
      description =
        document.querySelector('meta[property="og:description"]')?.content?.trim() ||
        document.querySelector('meta[name="description"]')?.content?.trim() || '';
      if (description) LOG('ℹ️ description from meta');
    }

    const jobUrl = location.href;
    LOG('── result ──', { title, company, descLen: description.length });
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
