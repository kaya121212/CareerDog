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

    // ── Title + Company ─────────────────────────────────────────────────────
    // og:title is server-rendered and reliable regardless of login state or
    // CSS obfuscation. Format: "Company hiring Job in Location | LinkedIn"
    const ogRaw = document.querySelector('meta[property="og:title"]')?.content
               || document.title
               || '';
    LOG('og:title raw:', ogRaw);

    const { title, company } = parseLinkedInMeta(ogRaw);
    LOG('Parsed → title:', title, '| company:', company);

    if (!title) {
      LOG('❌ Could not determine title');
      return Promise.reject('NOT_FOUND');
    }

    // ── Description ─────────────────────────────────────────────────────────
    let description = '';

    // Strategy A (logged-in): find the "About the job" heading, grab content after it
    try {
      const aboutHeading = await waitForHeading('About the job', 10000);

      // Walk up until we find a parent that has a sibling with the description.
      // Typical structures:
      //   <section><h2>About the job</h2><div>…</div></section>  → h2.nextElementSibling
      //   <header><h2>…</h2></header><div>…</div>               → header.nextElementSibling
      const descEl =
        aboutHeading.nextElementSibling                          ||   // sibling of h2
        aboutHeading.parentElement?.nextElementSibling           ||   // sibling of h2's parent
        aboutHeading.closest('section, article, [class]')
          ?.querySelector('div + div, p, ul');                        // first content inside section

      if (descEl) {
        description = toText(descEl);
        LOG('✅ Description via "About the job" heading, length:', description.length);
      }
    } catch (_) {
      LOG('ℹ️ "About the job" heading not found, trying CSS fallbacks');
    }

    // Strategy B (public page / fallback): CSS class selectors
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

    // Strategy C: og:description (short, but better than nothing)
    if (!description) {
      description =
        document.querySelector('meta[property="og:description"]')?.content?.trim() ||
        document.querySelector('meta[name="description"]')?.content?.trim() || '';
      if (description) LOG('ℹ️ Description via meta tag');
    }

    LOG('── result ──', { title, company, descLen: description.length });
    return { title, company, description, url: location.origin + location.pathname };
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
