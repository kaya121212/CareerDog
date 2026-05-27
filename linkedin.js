// ─────────────────────────────────────────────────────────────────────────────
// linkedin.js – CareerDog content script
//
// KEY FINDING: LinkedIn's logged-in page uses CSS module hashed class names
// (_482149db, _46c4903e …) — no semantic class names exist and there is no h1.
//
// Strategy:
//   Title + Company → og:title meta (server-rendered, never obfuscated)
//   Description     → find <h2> whose text is "About the job", grab sibling content
//   Fallback        → public-page CSS selectors (work when not logged in)
// ─────────────────────────────────────────────────────────────────────────────

if (!window.__careerDogLinkedIn) {
  window.__careerDogLinkedIn = true;

  const LOG = (...a) => console.log('[CareerDog]', ...a);

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Poll until an <h2> (or any selector) whose trimmed text matches `text`
   * appears on the page. Resolves with the element.
   */
  function waitForHeading(text, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      (function poll() {
        const el = [...document.querySelectorAll('h1, h2, h3')].find(
          e => e.textContent.trim() === text
        );
        if (el) { LOG(`✅ Found heading: "${text}"`); return resolve(el); }
        if (Date.now() - started >= timeout) {
          LOG(`❌ Heading not found: "${text}"`);
          return reject('TIMEOUT');
        }
        setTimeout(poll, 400);
      })();
    });
  }

  /** Return the first element with text from a CSS selector list (no waiting). */
  function queryFirst(selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) {
          LOG(`✅ queryFirst: "${sel}"`);
          return el;
        }
      } catch (_) {}
    }
    return null;
  }

  /**
   * Parse LinkedIn og:title / document.title → { title, company }
   *
   * Known formats:
   *   "OpenAI hiring Software Engineer in United States | LinkedIn"
   *   "Software Engineer at OpenAI | LinkedIn"
   *   "Software Engineer | OpenAI | LinkedIn"
   */
  function parseLinkedInMeta(raw) {
    const s = (raw || '').replace(/\s*\|\s*LinkedIn\s*$/i, '').trim();

    // "Company hiring Job in Location"  ← logged-in format
    const hiringM = s.match(/^(.+?)\s+hiring\s+(.+?)(?:\s+in\s+.+)?$/i);
    if (hiringM) return { title: hiringM[2].trim(), company: hiringM[1].trim() };

    // "Job at Company"
    const atM = s.match(/^(.+?)\s+at\s+(.+)$/i);
    if (atM) return { title: atM[1].trim(), company: atM[2].trim() };

    // "Job | Company"
    const parts = s.split(/\s*\|\s*/);
    if (parts.length >= 2) return { title: parts[0].trim(), company: parts[1].trim() };

    return { title: s, company: '' };
  }

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
      .reduce((acc, l) => { if (l === '' && acc[acc.length - 1] === '') return acc; acc.push(l); return acc; }, [])
      .join('\n').trim();
  }

  // ── Main extractor ─────────────────────────────────────────────────────────

  async function extractJob() {
    LOG('── extractJob ──', location.href);

    // ── Job ID + canonical URL ───────────────────────────────────────────────
    // On direct job page : /jobs/view/1234/  → ID from pathname
    // On search/collections: /jobs/search/?currentJobId=1234 → ID from query
    let jobId = location.pathname.match(/\/jobs\/view\/(\d+)/)?.[1]
             || new URLSearchParams(location.search).get('currentJobId');

    const jobUrl = jobId
      ? `${location.origin}/jobs/view/${jobId}/`
      : location.origin + location.pathname;

    LOG('jobId:', jobId, '| jobUrl:', jobUrl);

    // ── Title + Company ──────────────────────────────────────────────────────
    let title = '', company = '';
    const onDirectPage = location.pathname.includes('/jobs/view/');

    // Strategy 1 – Job card link (search/collections panel view)
    // On the search page, og:title belongs to the search results, not the job.
    // The left-panel job card always has an <a href="/jobs/view/{id}"> whose
    // text content IS the job title — no class names needed.
    if (jobId && !onDirectPage) {
      const links = [...document.querySelectorAll(`a[href*="/jobs/view/${jobId}"]`)];
      const titleLink = links.find(a => {
        const t = a.textContent.trim();
        return t.length > 2 && t.length < 200;
      });
      if (titleLink) {
        title = titleLink.textContent.trim();
        LOG('✅ Title from job card link:', title);

        // Company is usually a leaf-node sibling element inside the same card
        const card = titleLink.closest('li, article, div[data-job-id], div[data-occludable-job-id]')
                  || titleLink.parentElement?.parentElement;
        if (card) {
          const leaf = [...card.querySelectorAll('span, div')].find(el =>
            !el.contains(titleLink) &&
            el.children.length === 0 &&
            el.textContent.trim().length > 1 &&
            el.textContent.trim().length < 100
          );
          if (leaf) { company = leaf.textContent.trim(); LOG('✅ Company from card:', company); }
        }
      }
    }

    // Strategy 2 – og:title parse (direct job view page, public page, logged-in job view)
    // og:title format: "Company hiring Job in Location | LinkedIn"
    if (!title) {
      const ogRaw = document.querySelector('meta[property="og:title"]')?.content
                 || document.title || '';
      LOG('og:title raw:', ogRaw);
      ({ title, company } = parseLinkedInMeta(ogRaw));
      LOG('Parsed → title:', title, '| company:', company);
    }

    if (!title) {
      LOG('❌ Could not determine title');
      return Promise.reject('NOT_FOUND');
    }

    // ── Description ──────────────────────────────────────────────────────────
    let description = '';

    // Strategy A – "About the job" heading (logged-in, hashed class names)
    try {
      const aboutHeading = await waitForHeading('About the job', 10000);
      const descEl =
        aboutHeading.nextElementSibling ||
        aboutHeading.parentElement?.nextElementSibling ||
        aboutHeading.closest('section, article, [class]')?.querySelector('div + div, p, ul');
      if (descEl) {
        description = toText(descEl);
        LOG('✅ Description via "About the job" heading, length:', description.length);
      }
    } catch (_) {
      LOG('ℹ️ "About the job" heading not found, trying CSS fallbacks');
    }

    // Strategy B – CSS class selectors (public page)
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
        description = toText(descEl);
        LOG('✅ Description via CSS selector, length:', description.length);
      }
    }

    // Strategy C – meta description fallback
    if (!description) {
      description =
        document.querySelector('meta[property="og:description"]')?.content?.trim() ||
        document.querySelector('meta[name="description"]')?.content?.trim() || '';
      if (description) LOG('ℹ️ Description via meta tag');
    }

    LOG('── result ──', { title, company, descLen: description.length, jobUrl });
    return { title, company, description, url: jobUrl };
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
