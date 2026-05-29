// ─────────────────────────────────────────────────────────────────────────────
// CareerDog – popup.js
// ─────────────────────────────────────────────────────────────────────────────

const FIELDS = ['firstName', 'lastName', 'email', 'phone', 'linkedin', 'location', 'zipCode', 'address'];

// ── Job source detection ──────────────────────────────────────────────────────

/**
 * Returns { files, label } for supported job pages, or null for others.
 * `files` is injected via scripting.executeScript in order:
 *   shared/utils.js first (sets up CareerDog.*), then the site extractor.
 */
function getJobSource(url) {
  if (url?.includes('linkedin.com/jobs'))  return { files: ['shared/utils.js', 'sites/linkedin.js'],   label: 'LinkedIn',   platform: 'LinkedIn.com'   };
  if (url?.includes('greenhouse.io'))       return { files: ['shared/utils.js', 'sites/greenhouse.js'], label: 'Greenhouse', platform: 'Greenhouse.io'  };
  if (url?.includes('indeed.com'))          return { files: ['shared/utils.js', 'sites/indeed.js'],     label: 'Indeed',     platform: 'Indeed.com'     };
  if (url?.includes('glassdoor.com'))       return { files: ['shared/utils.js', 'sites/glassdoor.js'],  label: 'Glassdoor',  platform: 'Glassdoor.com'  };
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
  if (tab?.url?.includes('linkedin.com')) {
    document.getElementById('btn-autofill').disabled = true;
    document.getElementById('autofillHint').style.display = 'block';
  }
});

// ── Home: Profile button ──────────────────────────────────────────────────────

document.getElementById('btn-profile').addEventListener('click', () => {
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
// Copies tab-separated: Date, Email, Company, Title, URL, Platform, Location, Salary, Recruiter

document.getElementById('btn-save').addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    const source = getJobSource(tab?.url);
    if (!source) {
      return setStatus('homeStatus', 'Open a LinkedIn, Greenhouse, Indeed, or Glassdoor jobs page first.', true);
    }

    setStatus('homeStatus', 'Saving job…');

    chrome.storage.sync.get(['email'], (data) => {
      const email = data.email || 'unknown';
      const date = new Date().toISOString().slice(0, 10);

      chrome.scripting.executeScript(
        { target: { tabId: tab.id }, func: extractJobData },
        results => {
          if (chrome.runtime.lastError) return setStatus('homeStatus', 'Cannot read this page.', true);
          const res = results?.[0]?.result;
          if (!res) return setStatus('homeStatus', 'Could not read job.', true);
          const text = [
            email,
            date,
            res.company,
            res.title,
            res.url,
            source.platform,
            res.location  || '',
            res.salary    || '',
            'Applied',
            res.recruiter || '',
          ].join('\t');
          navigator.clipboard.writeText(text)
            .then(() => setStatus('homeStatus', 'Job saved to clipboard!'))
            .catch(() => setStatus('homeStatus', 'Clipboard write failed.', true));
        }
      );
    });
  });
});

// ── Home: Copy button ─────────────────────────────────────────────────────────
// Copies: Job Title / Company / Description

document.getElementById('btn-copy').addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    const source = getJobSource(tab?.url);
    if (!source) {
      return setStatus('homeStatus', 'Open a LinkedIn, Greenhouse, Indeed, or Glassdoor jobs page first.', true);
    }

    setStatus('homeStatus', 'Reading job…');

    chrome.scripting.executeScript(
      { target: { tabId: tab.id }, func: extractJobData },
      results => {
        if (chrome.runtime.lastError) return setStatus('homeStatus', 'Cannot read this page.', true);
        const res = results?.[0]?.result;
        if (!res) return setStatus('homeStatus', 'Could not read job.', true);
        const text = [
          `Job Title: ${res.title}`,
          `Company: ${res.company}`,
          '',
          res.description,
        ].join('\n').trim();
        navigator.clipboard.writeText(text)
          .then(() => setStatus('homeStatus', 'Copied to clipboard!'))
          .catch(() => setStatus('homeStatus', 'Clipboard write failed.', true));
      }
    );
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
// Fills visible form inputs using heuristic label/attribute matching.
// Handles React/Vue state via native value setters + synthetic events.
// ═════════════════════════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════════════════════════
// INJECTED FUNCTION – extractJobData
// Runs inside the target page. Fully self-contained (no external dependencies).
// Returns { title, company, url, description, location, salary, recruiter }
// ═════════════════════════════════════════════════════════════════════════════

function extractJobData() {
  function queryFirst(selectors) {
    for (const sel of selectors) {
      try { const el = document.querySelector(sel); if (el?.textContent.trim()) return el; } catch (_) {}
    }
    return null;
  }

  function toText(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('[aria-hidden="true"], button, svg, img, style, script').forEach(n => n.remove());
    clone.querySelectorAll('p, div, br, h1, h2, h3, h4, h5').forEach(n => n.after(document.createTextNode('\n')));
    clone.querySelectorAll('li').forEach(n => { n.prepend(document.createTextNode('• ')); n.after(document.createTextNode('\n')); });
    return clone.textContent.split('\n').map(l => l.trim())
      .reduce((a, l) => { if (l === '' && a[a.length - 1] === '') return a; a.push(l); return a; }, [])
      .join('\n').trim();
  }

  // ── Job ID & URL ────────────────────────────────────────────────────────────
  let jobId = location.pathname.match(/\/jobs\/view\/(\d+)/)?.[1]
           || new URLSearchParams(location.search).get('currentJobId');
  if (!jobId) {
    const card = document.querySelector('[data-job-id], [data-occludable-job-id]');
    jobId = card?.dataset.jobId || card?.dataset.occludableJobId
         || card?.querySelector('a[href*="/jobs/view/"]')?.href.match(/\/jobs\/view\/(\d+)/)?.[1];
  }
  const jobUrl = jobId ? `${location.origin}/jobs/view/${jobId}/` : location.href;
  const onDirectPage = location.pathname.includes('/jobs/view/');

  // ── Title ───────────────────────────────────────────────────────────────────
  let title = '';
  if (!onDirectPage && jobId) {
    const a = document.querySelector(`a[href*="/jobs/view/${jobId}"]`);
    const t = a?.textContent.trim();
    if (t && t.length > 2 && t.length < 200) title = t;
  }
  if (!title && onDirectPage) title = document.querySelector('h1')?.textContent.trim() || '';
  if (!title) {
    const raw = document.querySelector('meta[property="og:title"]')?.content || document.title || '';
    const s = raw.replace(/\s*\|\s*LinkedIn\s*$/i, '').trim();
    const m = s.match(/^(.+?)\s+at\s+(.+)$/i) || s.match(/^(.+?)\s+hiring\s+(.+?)(?:\s+in\s+.+)?$/i);
    const t2 = m ? (m[0].includes(' at ') ? m[1] : m[2]).trim() : s.split(/\s*\|\s*/)[0].trim();
    if (t2 && t2.toLowerCase() !== 'linkedin' && t2.toLowerCase() !== 'jobs') title = t2;
  }

  // ── Company ─────────────────────────────────────────────────────────────────
  let company = '';
  const compEl = queryFirst([
    '[data-testid="job-details-company-url"]',
    '[data-testid="inlineCompanyName"]',
    '.job-details-jobs-unified-top-card__company-name a',
    '.jobs-unified-top-card__company-name a',
    '.topcard__org-name-link',
    '[class*="company-name"] a',
    '[class*="companyName"] a',
    'a[href*="/company/"]',
  ]);
  if (compEl) company = compEl.textContent.trim();

  // ── Description ─────────────────────────────────────────────────────────────
  const descEl = queryFirst([
    '[data-testid="expandable-text-box"]',
    '#job-details',
    '.jobs-description__content',
    '.jobs-description-content__text',
    '.description__text--rich',
    '[class*="jobs-description__content"]',
    '[class*="job-description"]',
  ]);
  const description = toText(descEl);

  // ── Location ────────────────────────────────────────────────────────────────
  const locEl = queryFirst([
    '.job-details-jobs-unified-top-card__bullet',
    '.jobs-unified-top-card__bullet',
    '.topcard__flavor--bullet',
    '[class*="top-card"][class*="location"]',
  ]);
  const location2 = locEl?.textContent.trim() || '';

  // ── Salary ──────────────────────────────────────────────────────────────────
  // Look for a button text that contains a currency symbol or pay pattern
  let salary = '';
  const fitBtns = document.querySelectorAll('.job-details-fit-level-preferences button strong');
  for (const el of fitBtns) {
    const t = el.textContent.trim();
    if (/\$|£|€|¥|\/hr|\/yr|k\b|salary|per hour|per year/i.test(t)) { salary = t; break; }
  }
  if (!salary) {
    const salEl = queryFirst(['[class*="salary"]', '[class*="compensation"]', '[data-test*="salary"]']);
    salary = salEl?.textContent.trim() || '';
  }

  // ── Recruiter ───────────────────────────────────────────────────────────────
  const recEl = queryFirst([
    '.hirer-card__hirer-information a',
    '[class*="hirer-card"] a',
    '[class*="hiring-team"] a',
  ]);
  const recruiter = recEl?.textContent.trim() || '';

  if (!title) return null;
  return { title, company, url: jobUrl, description, location: location2, salary, recruiter };
}

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

    if (input.id) {
      try {
        const lbl = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
        if (lbl) candidates.push(norm(lbl.textContent));
      } catch (_) {}
    }
    const wl = input.closest('label');
    if (wl) candidates.push(norm(wl.textContent));
    const container = input.closest('div, li, section, fieldset, p');
    if (container) {
      const lbl = container.querySelector('label, [class*="label"], [class*="Label"]');
      if (lbl) candidates.push(norm(lbl.textContent));
    }

    return matcher.keys.some(k => candidates.some(c => c.includes(norm(k))));
  }

  function isPhoneLibraryInput(input) {
    const container = input.closest(
      '.react-tel-input, .react-international-phone, .intl-tel-input, ' +
      '[class*="PhoneInput"], [class*="phone-input"], [class*="phoneInput"]'
    );
    if (container) return true;
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

  function stripCountryCode(phone) {
    return phone.replace(/^\+\d{1,3}[\s\-.(]?/, '').trim() || phone;
  }

  function fill(input, value) {
    input.focus();
    const proto = input.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

    if (isPhoneLibraryInput(input)) {
      const localNumber = stripCountryCode(value);
      input.select?.();
      const inserted = document.execCommand('insertText', false, localNumber);
      if (!inserted) {
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
