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

  /**
   * Poll until a heading whose trimmed text matches `text` appears.
   * Resolves with the element, or rejects on timeout.
   */
  function waitForHeading(text, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      (function poll() {
        const el = [...document.querySelectorAll('h1, h2, h3')]
          .find(e => e.textContent.trim() === text);
        if (el) { LOG(`✅ found heading: "${text}"`); return resolve(el); }
        if (Date.now() - started >= timeout) return reject('TIMEOUT');
        setTimeout(poll, 400);
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

    // Strategy 1 – job card link (search / collections panel view)
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

    // Strategy 2 – og:title parse
    if (!title) {
      const ogRaw =
        document.querySelector('meta[property="og:title"]')?.content ||
        document.title || '';
      LOG('og:title raw:', ogRaw);
      ({ title, company } = parseMeta(ogRaw));
      LOG('parsed → title:', title, '| company:', company);
    }

    if (!title) return Promise.reject('NOT_FOUND');

    // ── Description ──────────────────────────────────────────────────────────
    let description = '';

    // Strategy A – "About the job" heading (logged-in, hashed class names)
    try {
      const heading = await waitForHeading('About the job', 10000);
      const descEl =
        heading.nextElementSibling ||
        heading.parentElement?.nextElementSibling ||
        heading.closest('section, article, [class]')?.querySelector('div + div, p, ul');
      if (descEl) {
        description = CareerDog.toText(descEl);
        LOG('✅ description via heading, length:', description.length);
      }
    } catch (_) {
      LOG('ℹ️ "About the job" not found, trying CSS fallbacks');
    }

    // Strategy B – CSS selectors (public / logged-out page)
    if (!description) {
      const descEl = queryFirst([
        '.description__text--rich',
        '[class*="description__text--rich"]',
        '#job-details',
        '.jobs-description-content__text',
        '.jobs-description__content',
        '[class*="jobs-description"]',
      ]);
      if (descEl) {
        description = CareerDog.toText(descEl);
        LOG('✅ description via CSS, length:', description.length);
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
