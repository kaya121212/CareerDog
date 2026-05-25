const FIELDS = ['firstName', 'lastName', 'email', 'phone', 'linkedin', 'location'];

function setStatus(msg) {
  document.getElementById('status').textContent = msg;
  setTimeout(() => { document.getElementById('status').textContent = ''; }, 2000);
}

chrome.storage.sync.get(FIELDS, (data) => {
  FIELDS.forEach(id => {
    if (data[id]) document.getElementById(id).value = data[id];
  });
});

document.getElementById('saveBtn').addEventListener('click', () => {
  const data = {};
  FIELDS.forEach(id => { data[id] = document.getElementById(id).value.trim(); });
  chrome.storage.sync.set(data, () => setStatus('Saved!'));
});

// Runs inside the page context — must be fully self-contained (no outer references)
function fillPageWithData(userData) {
  const fullName = [userData.firstName, userData.lastName].filter(Boolean).join(' ');
  const resolved = { ...userData, fullName };

  const MATCHERS = [
    { keys: ['first_name', 'firstname', 'fname', 'given_name', 'givenname', 'first-name', 'givenname'], dataKey: 'firstName' },
    { keys: ['last_name', 'lastname', 'lname', 'family_name', 'familyname', 'surname', 'last-name'], dataKey: 'lastName' },
    { keys: ['full_name', 'fullname', 'full-name', 'your_name', 'yourname', 'name'], dataKey: 'fullName' },
    { keys: ['email', 'e-mail', 'email_address', 'emailaddress'], dataKey: 'email' },
    { keys: ['phone', 'telephone', 'tel', 'mobile', 'cell', 'phone_number', 'phonenumber', 'contactnumber'], dataKey: 'phone' },
    { keys: ['linkedin', 'linkedin_url', 'linkedinurl', 'linkedin_profile', 'linkedin-url', 'linkedinprofile'], dataKey: 'linkedin' },
    { keys: ['location', 'city', 'citystate', 'city_state', 'address', 'current_location', 'currentlocation', 'region', 'where'], dataKey: 'location' },
  ];

  function norm(str) {
    return (str || '').toLowerCase().replace(/[\s_\-]/g, '');
  }

  function matches(input, matcher) {
    const candidates = [
      input.name,
      input.id,
      input.placeholder,
      input.getAttribute('aria-label'),
      input.getAttribute('data-field'),
      input.getAttribute('data-testid'),
      input.getAttribute('autocomplete'),
    ].map(norm);

    // label[for=id]
    if (input.id) {
      try {
        const lbl = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
        if (lbl) candidates.push(norm(lbl.textContent));
      } catch (_) {}
    }
    // wrapping <label>
    const wl = input.closest('label');
    if (wl) candidates.push(norm(wl.textContent));

    // nearest label inside closest container div
    const container = input.closest('div, li, section, fieldset, p');
    if (container) {
      const lbl = container.querySelector('label, [class*="label"], [class*="Label"]');
      if (lbl) candidates.push(norm(lbl.textContent));
    }

    return matcher.keys.some(k => candidates.some(c => c.includes(norm(k))));
  }

  function fill(input, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    ['input', 'change', 'blur'].forEach(e => input.dispatchEvent(new Event(e, { bubbles: true })));
  }

  const inputs = Array.from(document.querySelectorAll(
    'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea'
  ));

  const filled = new Set();
  let count = 0;

  for (const matcher of MATCHERS) {
    const value = resolved[matcher.dataKey];
    if (!value) continue;
    for (const input of inputs) {
      if (filled.has(input)) continue;
      if (matches(input, matcher)) {
        fill(input, value);
        filled.add(input);
        count++;
      }
    }
  }

  return count;
}

document.getElementById('fillBtn').addEventListener('click', () => {
  const data = {};
  FIELDS.forEach(id => { data[id] = document.getElementById(id).value.trim(); });

  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    chrome.scripting.executeScript(
      { target: { tabId: tab.id, allFrames: true }, func: fillPageWithData, args: [data] },
      (results) => {
        if (chrome.runtime.lastError) return setStatus('Cannot fill this page.');
        const count = (results || []).reduce((sum, r) => sum + (r?.result ?? 0), 0);
        setStatus(`Filled ${count} field(s)`);
      }
    );
  });
});
