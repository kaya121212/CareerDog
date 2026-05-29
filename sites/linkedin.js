// ─────────────────────────────────────────────────────────────────────────────
// sites/linkedin.js – CareerDog extractor for LinkedIn job pages
//
// Supports:
//   https://www.linkedin.com/jobs/view/{id}/
//   https://www.linkedin.com/jobs/search/?currentJobId={id}
//   https://www.linkedin.com/jobs/collections/*
//
// Strategy:
//   Title + Company → og:title meta (server-rendered, never obfuscated)
//                   → job card <a> link on search/collections pages
//   Description     → "About the job" heading sibling (logged-in)
//                   → CSS class selectors (public page)
//                   → og:description fallback
//
// Depends on: shared/utils.js (CareerDog.toText, CareerDog.register)
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  const LOG = (...a) => console.log('[CareerDog LinkedIn]', ...a);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const DESCRIPTION_HEADINGS = [
    'about the job',
    'job description',
    'about this role',
    'description',
    'job details',
    'role description',
    'about the role',
  ];

  /**
   * Poll until a heading whose trimmed lowercase text matches any of the
   * known description heading variants. Resolves with the element, or
   * rejects on timeout.
   */
  function waitForHeading(timeout = 4000) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      (function poll() {
        const el = [...document.querySelectorAll('h1, h2, h3, h4')]
          .find(e => DESCRIPTION_HEADINGS.includes(e.textContent.trim().toLowerCase()));
        if (el) { LOG(`✅ found heading: "${el.textContent.trim()}"`); return resolve(el); }
        if (Date.now() - started >= timeout) return reject('TIMEOUT');
        setTimeout(poll, 300);
      })();
    });
  }

  /** Try each selector in order; return the first element with text. */
  function queryFirst(selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el?.textContent.trim()) return el;
      } catch (_) {}
    }
    return null;
  }

  /**
   * Parse LinkedIn og:title → { title, company }
   *
   * Formats:
   *   "OpenAI hiring Software Engineer in United States | LinkedIn"
   *   "Software Engineer at OpenAI | LinkedIn"
   *   "Software Engineer | OpenAI | LinkedIn"
   */
  function parseMeta(raw) {
    const s = (raw || '').replace(/\s*\|\s*LinkedIn\s*$/i, '').trim();
    const hiringM = s.match(/^(.+?)\s+hiring\s+(.+?)(?:\s+in\s+.+)?$/i);
    if (hiringM) return { title: hiringM[2].trim(), company: hiringM[1].trim() };
    const atM = s.match(/^(.+?)\s+at\s+(.+)$/i);
    if (atM) return { title: atM[1].trim(), company: atM[2].trim() };
    const parts = s.split(/\s*\|\s*/);
    if (parts.length >= 2) return { title: parts[0].trim(), company: parts[1].trim() };
    return { title: s, company: '' };
  }

  // ── Extractor ─────────────────────────────────────────────────────────────

  async function extractJob() {
    LOG('── extractJob ──', location.href);

    // ── Canonical URL ────────────────────────────────────────────────────────
    const jobId =
      location.pathname.match(/\/jobs\/view\/(\d+)/)?.[1] ||
      new URLSearchParams(location.search).get('currentJobId');
    const jobUrl = jobId
      ? `${location.origin}/jobs/view/${jobId}/`
      : location.origin + location.pathname;
    LOG('jobId:', jobId);

    // ── Title + Company ──────────────────────────────────────────────────────
    let title = '', company = '';
    const onDirectPage = location.pathname.includes('/jobs/view/');

    // Strategy 1 – card link (search / collections panel view)
    // On search pages the h1 belongs to the search UI, not the job — use the
    // job card anchor whose href contains the job ID instead.
    if (jobId && !onDirectPage) {
      const links = [...document.querySelectorAll(`a[href*="/jobs/view/${jobId}"]`)];
      const titleLink = links.find(a => {
        const t = a.textContent.trim();
        return t.length > 2 && t.length < 200;
      });
      if (titleLink) {
        title = titleLink.textContent.trim();
        LOG('✅ title from card link:', title);
        const card =
          titleLink.closest('li, article, [data-job-id], [data-occludable-job-id]') ||
          titleLink.parentElement?.parentElement;
        if (card) {
          const leaf = [...card.querySelectorAll('span, div')].find(el =>
            !el.contains(titleLink) &&
            el.children.length === 0 &&
            el.textContent.trim().length > 1 &&
            el.textContent.trim().length < 100
          );
          if (leaf) { company = leaf.textContent.trim(); LOG('✅ company from card:', company); }
        }
      }
    }

    // Strategy 2 – DOM h1 (direct job view page only)
    if (!title && onDirectPage) {
      const h1 = document.querySelector('h1');
      if (h1?.textContent.trim()) {
        title = h1.textContent.trim();
        LOG('✅ title from h1:', title);
      }
    }

    // Strategy 3 – company from top-card selectors (direct page or search panel)
    if (!company) {
      const companyEl = queryFirst([
        '.job-details-jobs-unified-top-card__company-name a',
        '.jobs-unified-top-card__company-name a',
        '.topcard__org-name-link',
        '[class*="company-name"] a',
        '[class*="companyName"] a',
        'a[href*="/company/"][data-tracking-control-name]',
        'a[href*="/company/"]',
      ]);
      if (companyEl) {
        company = companyEl.textContent.trim();
        LOG('✅ company from DOM:', company);
      }
    }

    // Strategy 4 – og:title parse (fallback for both page types)
    if (!title) {
      const ogRaw =
        document.querySelector('meta[property="og:title"]')?.content ||
        document.title || '';
      LOG('og:title raw:', ogRaw);
      const parsed = parseMeta(ogRaw);
      if (parsed.title && parsed.title.toLowerCase() !== 'linkedin' && parsed.title.toLowerCase() !== 'jobs') {
        title = parsed.title;
        if (!company) company = parsed.company;
        LOG('parsed → title:', title, '| company:', company);
      }
    }

    if (!title) return Promise.reject('NOT_FOUND');

    // ── Description ──────────────────────────────────────────────────────────
    let description = '';

    // Strategy A – run heading-wait and CSS selectors in parallel; first wins
    const cssDescEl = queryFirst([
      '#job-details',
      '.jobs-description__content',
      '.jobs-description-content__text',
      '.description__text--rich',
      '[class*="description__text--rich"]',
      '[class*="jobs-description__content"]',
      '[class*="job-description"]',
      '[class*="jobDescription"]',
      'article[class*="job"]',
      '[data-test-id="job-description"]',
      '[data-test="job-detail-description"]',
    ]);

    if (cssDescEl) {
      description = CareerDog.toText(cssDescEl);
      LOG('✅ description via CSS, length:', description.length);
    }

    if (!description) {
      try {
        const heading = await waitForHeading(4000);
        const descEl =
          heading.nextElementSibling ||
          heading.parentElement?.nextElementSibling ||
          heading.closest('section, article, [class]')?.querySelector('div + div, p, ul');
        if (descEl) {
          description = CareerDog.toText(descEl);
          LOG('✅ description via heading, length:', description.length);
        }
      } catch (_) {
        LOG('ℹ️ description heading not found');
      }
    }

    // Strategy C – meta fallback
    if (!description) {
      description =
        document.querySelector('meta[property="og:description"]')?.content?.trim() ||
        document.querySelector('meta[name="description"]')?.content?.trim() || '';
      if (description) LOG('ℹ️ description from meta');
    }

    LOG('── result ──', { title, company, descLen: description.length });
    return { title, company, description, url: jobUrl };
  }

  CareerDog.register('__careerDogLinkedIn', extractJob, 'LinkedIn');
})();
