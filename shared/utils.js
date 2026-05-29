// ─────────────────────────────────────────────────────────────────────────────
// shared/utils.js – CareerDog shared utilities
//
// Injected before every site-specific content script via manifest.json
// and via popup.js scripting.executeScript.
//
// Exposes: window.CareerDog.toText(el)
//          window.CareerDog.register(guardKey, extractFn, site)
// ─────────────────────────────────────────────────────────────────────────────

window.CareerDog = window.CareerDog || {};

/**
 * Convert an HTML element to readable plain text.
 * Preserves bullet points and paragraph breaks; strips UI noise.
 *
 * @param  {Element} el
 * @returns {string}
 */
CareerDog.toText = function toText(el) {
  if (!el) return '';
  const clone = el.cloneNode(true);
  clone.querySelectorAll('[aria-hidden="true"], button, svg, img, style, script')
       .forEach(n => n.remove());
  clone.querySelectorAll('p, div, br, h1, h2, h3, h4, h5')
       .forEach(n => n.after(document.createTextNode('\n')));
  clone.querySelectorAll('li').forEach(n => {
    n.prepend(document.createTextNode('• '));
    n.after(document.createTextNode('\n'));
  });
  return clone.textContent
    .split('\n')
    .map(l => l.trim())
    .reduce((acc, l) => {
      if (l === '' && acc[acc.length - 1] === '') return acc;
      acc.push(l);
      return acc;
    }, [])
    .join('\n')
    .trim();
};

/**
 * Register a site extractor. Handles the one-time guard and GET_JOB listener.
 *
 * @param {string}   guardKey  window property used as a run-once flag
 * @param {Function} extractFn async () => { title, company, description, url }
 * @param {string}   site      short name shown in console logs
 */
CareerDog.register = function register(guardKey, extractFn, site) {
  const LOG = (...a) => console.log(`[CareerDog ${site}]`, ...a);

  // Remove any previously registered handler so re-injection always gets a
  // fresh listener (avoids the guard blocking re-registration after SPA nav).
  if (window[guardKey + '_handler']) {
    chrome.runtime.onMessage.removeListener(window[guardKey + '_handler']);
  }

  const handler = (req, _sender, sendResponse) => {
    if (req.type !== 'GET_JOB') return;
    LOG('GET_JOB received');
    extractFn()
      .then(sendResponse)
      .catch(err => {
        LOG('❌ error:', err);
        sendResponse({ error: err === 'NOT_FOUND' ? 'NOT_FOUND' : 'EXTRACT_FAILED' });
      });
    return true;
  };

  window[guardKey + '_handler'] = handler;
  window[guardKey] = true;
  chrome.runtime.onMessage.addListener(handler);

  LOG('loaded on', location.href);
};
