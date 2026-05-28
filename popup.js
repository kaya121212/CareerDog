// ─────────────────────────────────────────────────────────────────────────────
// CareerDog – popup.js
// ─────────────────────────────────────────────────────────────────────────────

const FIELDS = ['firstName', 'lastName', 'email', 'phone', 'linkedin', 'location', 'zipCode', 'address'];

// ── Job source detection ──────────────────────────────────────────────────────

/**
 * Returns { script, label } for supported job pages, or null for others.
 *   LinkedIn  → linkedin.js
 *   Greenhouse → greenhouse.js
 */
function getJobSource(url) {
  if (url?.includes('linkedin.com/jobs')) return { script: 'linkedin.js',   label: 'LinkedIn'   };
  if (url?.includes('greenhouse.io'))     return { script: 'greenhouse.js', label: 'Greenhouse' };
  if (url?.includes('indeed.com'))        return { script: 'indeed.js',     label: 'Indeed'     };
  if (url?.includes('glassdoor.com'))     return { script: 'glassdoor.js',  label: 'Glassdoor'  };
  return null;
}

// ── Utility ───────────────────────────────────────────────────────────────────

/** Show a brief status message, then fade it out. */
function setStatus(elId, msg, isError = false) {
  const el = document.getElementById(elId);
  el.textContent = msg;
  el.className = 'status' + (isError ? ' error' : '');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.textContent = ''; el.className = 'status'; }, 2500);
}

// ── Page navigation ───────────────────────────────────────────────────────────

const backBtn = document.getElementById('backBtn');

/** Switch to a named page ('home' | 'profile'). */
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  backBtn.style.display = name === 'home' ? 'none' : 'block';
}

backBtn.addEventListener('click', () => showPage('home'));

// ── Detect LinkedIn on load ───────────────────────────────────────────────────

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  const isLinkedIn = tab?.url?.includes('linkedin.com') ?? false;

  if (isLinkedIn) {
    // Autofill is not useful on LinkedIn (no job application form)
    const autofillBtn = document.getElementById('btn-autofill');
    autofillBtn.disabled = true;
    document.getElementById('autofillHint').style.display = 'block';
  }
});

// ── Home: Profile button ──────────────────────────────────────────────────────

document.getElementById('btn-profile').addEventListener('click', () => {
  // Load saved values before showing the page
  chrome.storage.sync.get(FIELDS, data => {
    FIELDS.forEach(id => {
      const el = document.getElementById(id);
      if (el && data[id]) el.value = data[id];
    });
  });
  showPage('profile');
});

// ── Home: Autofill button ─────────────────────────────────────────────────────

document.getElementById('btn-autofill').addEventListener('click', () => {
  chrome.storage.sync.get(FIELDS, data => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      chrome.scripting.executeScript(
        // allFrames: true catches forms embedded inside iframes (e.g. Ashby)
        { target: { tabId: tab.id, allFrames: true }, func: fillPageWithData, args: [data] },
        results => {
          if (chrome.runtime.lastError) {
            return setStatus('homeStatus', 'Cannot fill this page.', true);
          }
          const count = (results || []).reduce((sum, r) => sum + (r?.result ?? 0), 0);
          setStatus('homeStatus', count > 0 ? `Filled ${count} field(s)` : 'No matching fields found.');
        }
      );
    });
  });
});

// ── Home: Save job button ─────────────────────────────────────────────────────
// Copies: Job Title / Company / URL (no description)

document.getElementById('btn-save').addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    const source = getJobSource(tab?.url);
    if (!source) {
      return setStatus('homeStatus', 'Open a LinkedIn, Greenhouse, Indeed, or Glassdoor jobs page first.', true);
    }

    setStatus('homeStatus', 'Saving job…');

    chrome.scripting.executeScript(
      { target: { tabId: tab.id }, files: [source.script] },
      () => {
        if (chrome.runtime.lastError) return setStatus('homeStatus', 'Cannot read this page.', true);
        chrome.tabs.sendMessage(tab.id, { type: 'GET_JOB' }, res => {
          if (!res || res.error) return setStatus('homeStatus', 'Could not read job.', true);

          // Tab-separated → pastes into 3 adjacent cells in Google Sheets
          const text = [res.company, res.title, res.url].join('\t');

          navigator.clipboard.writeText(text)
            .then(() => setStatus('homeStatus', 'Job saved to clipboard!'))
            .catch(() => setStatus('homeStatus', 'Clipboard write failed.', true));
        });
      }
    );
  });
});

// ── Home: Copy button ─────────────────────────────────────────────────────────

document.getElementById('btn-copy').addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    // Accept LinkedIn (/jobs/view, /jobs/search, /jobs/collections) and Greenhouse
    const source = getJobSource(tab?.url);
    if (!source) {
      return setStatus('homeStatus', 'Open a LinkedIn, Greenhouse, Indeed, or Glassdoor jobs page first.', true);
    }

    setStatus('homeStatus', 'Reading job…');

    /**
     * Always inject the site-specific content script first (handles SPA
     * navigation where the manifest content script may not have run yet).
     * The guard in each script prevents duplicate listener registration.
     */
    function requestJob() {
      chrome.scripting.executeScript(
        { target: { tabId: tab.id }, files: [source.script] },
        () => {
          if (chrome.runtime.lastError) {
            return setStatus('homeStatus', 'Cannot read this page.', true);
          }
          chrome.tabs.sendMessage(tab.id, { type: 'GET_JOB' }, handleJob);
        }
      );
    }

    function handleJob(res) {
      if (!res || res.error) {
        const MSG = {
          NOT_FOUND      : 'Could not find job details. Try refreshing the page.',
          EXTRACT_FAILED : 'Could not read page. Try refreshing the page.',
        };
        return setStatus('homeStatus', MSG[res?.error] || 'Could not read job.', true);
      }

      const { title, company, description } = res;
      const text = [
        `Job Title: ${title}`,
        `Company: ${company}`,
        '',
        description,
      ].join('\n').trim();

      navigator.clipboard.writeText(text)
        .then(() => setStatus('homeStatus', 'Copied to clipboard!'))
        .catch(() => setStatus('homeStatus', 'Clipboard write failed.', true));
    }

    requestJob();
  });
});

// ── Profile: Save button ──────────────────────────────────────────────────────

document.getElementById('saveBtn').addEventListener('click', () => {
  const data = {};
  FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) data[id] = el.value.trim();
  });
  chrome.storage.sync.set(data, () => setStatus('profileStatus', 'Saved!'));
});

// ═════════════════════════════════════════════════════════════════════════════
// INJECTED FUNCTION  (runs inside the target page – must be self-contained)
// LinkedIn job extraction now lives in linkedin.js (content script).
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Fills visible form inputs using heuristic label/attribute matching.
 * Handles React/Vue state by using native value setters + synthetic events.
 *
 * @param {Object} userData  Profile fields from chrome.storage.sync
 * @returns {number}         Number of fields filled
 */
function fillPageWithData(userData) {
  const fullName = [userData.firstName, userData.lastName].filter(Boolean).join(' ');
  const resolved = { ...userData, fullName };

  const MATCHERS = [
    { keys: ['first_name', 'firstname', 'fname', 'given_name', 'givenname', 'first-name'], dataKey: 'firstName' },
    { keys: ['last_name', 'lastname', 'lname', 'family_name', 'familyname', 'surname', 'last-name'], dataKey: 'lastName' },
    { keys: ['full_name', 'fullname', 'full-name', 'your_name', 'yourname', 'name'], dataKey: 'fullName' },
    { keys: ['email', 'e-mail', 'email_address', 'emailaddress'], dataKey: 'email' },
    { keys: ['phone', 'telephone', 'tel', 'mobile', 'cell', 'phone_number', 'phonenumber'], dataKey: 'phone' },
    { keys: ['linkedin', 'linkedin_url', 'linkedinurl', 'linkedin_profile', 'linkedin-url'], dataKey: 'linkedin' },
    { keys: ['location', 'city', 'citystate', 'city_state', 'current_location', 'region'], dataKey: 'location' },
    { keys: ['zip', 'zipcode', 'zip_code', 'postal', 'postalcode', 'postal_code'], dataKey: 'zipCode' },
    { keys: ['address', 'street', 'street_address', 'streetaddress', 'addr'], dataKey: 'address' },
  ];

  function norm(str) {
    return (str || '').toLowerCase().replace(/[\s_-]/g, '');
  }

  function matches(input, matcher) {
    const candidates = [
      input.name, input.id, input.placeholder,
      input.getAttribute('aria-label'),
      input.getAttribute('data-field'),
      input.getAttribute('data-testid'),
      input.getAttribute('autocomplete'),
    ].map(norm);

    // <label for="id">
    if (input.id) {
      try {
        const lbl = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
        if (lbl) candidates.push(norm(lbl.textContent));
      } catch (_) {}
    }
    // Wrapping <label>
    const wl = input.closest('label');
    if (wl) candidates.push(norm(wl.textContent));
    // Nearest label in parent container
    const container = input.closest('div, li, section, fieldset, p');
    if (container) {
      const lbl = container.querySelector('label, [class*="label"], [class*="Label"]');
      if (lbl) candidates.push(norm(lbl.textContent));
    }

    return matcher.keys.some(k => candidates.some(c => c.includes(norm(k))));
  }

  /**
   * Returns true if the input is the number-only field inside a phone-library
   * widget (react-tel-input, react-international-phone, intl-tel-input, etc.)
   * that already shows a country-code selector/flag.
   */
  function isPhoneLibraryInput(input) {
    const container = input.closest(
      '.react-tel-input, .react-international-phone, .intl-tel-input, ' +
      '[class*="PhoneInput"], [class*="phone-input"], [class*="phoneInput"]'
    );
    if (container) return true;
    // Look for a sibling/nearby flag or country selector
    const parent = input.parentElement;
    if (parent) {
      const hasFlagSibling = parent.querySelector(
        '.flag-dropdown, .country-selector, [class*="flag"], ' +
        '[class*="country-code"], [class*="countryCode"], ' +
        '[class*="dial-code"], [class*="dialCode"]'
      );
      if (hasFlagSibling) return true;
    }
    return false;
  }

  /**
   * Strip a leading country code (+1, +44, etc.) from a phone string.
   * Returns the local portion, digits/spaces/dashes/parens only.
   */
  function stripCountryCode(phone) {
    const stripped = phone.replace(/^\+\d{1,3}[\s\-.(]?/, '').trim();
    return stripped || phone;
  }

  function fill(input, value) {
    // Focus first so React's synthetic event system is primed
    input.focus();

    const proto = input.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

    // For phone library inputs, clear existing value and use insertText
    if (isPhoneLibraryInput(input)) {
      const localNumber = stripCountryCode(value);
      // Select all existing content then replace via execCommand
      input.select?.();
      const inserted = document.execCommand('insertText', false, localNumber);
      if (!inserted) {
        // execCommand not available — use setter + events
        if (setter) setter.call(input, localNumber);
        else input.value = localNumber;
      }
    } else {
      if (setter) setter.call(input, value);
      else input.value = value;
    }

    ['input', 'change', 'blur'].forEach(e =>
      input.dispatchEvent(new Event(e, { bubbles: true }))
    );
  }

  const inputs = Array.from(document.querySelectorAll(
    'input:not([type=hidden]):not([type=submit]):not([type=button])' +
    ':not([type=checkbox]):not([type=radio]):not([type=file]), textarea'
  ));

  const filled = new Set();
  let count = 0;

  for (const matcher of MATCHERS) {
    const value = resolved[matcher.dataKey];
    if (!value) continue;
    for (const input of inputs) {
      if (filled.has(input)) continue;
      if (matches(input, matcher)) {
        if (input.value.trim()) {
          // Field already has a value — preserve it, mark as handled
          filled.add(input);
        } else {
          fill(input, value);
          filled.add(input);
          count++;
        }
      }
    }
  }

  return count;
}
