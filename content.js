// Heuristic patterns for common field names
const MATCHERS = [
  {
    keys: ['first_name', 'firstname', 'first-name', 'fname', 'given_name', 'givenname'],
    dataKey: 'firstName',
  },
  {
    keys: ['last_name', 'lastname', 'last-name', 'lname', 'family_name', 'surname'],
    dataKey: 'lastName',
  },
  {
    // "name" alone — fill with full name; skip if already matched first/last
    keys: ['full_name', 'fullname', 'full-name', 'your_name', 'yourname', 'name'],
    dataKey: 'fullName',
  },
  {
    keys: ['email', 'e-mail', 'email_address', 'emailaddress'],
    dataKey: 'email',
  },
  {
    keys: ['phone', 'telephone', 'tel', 'mobile', 'cell', 'phone_number', 'phonenumber'],
    dataKey: 'phone',
  },
  {
    keys: ['linkedin', 'linkedin_url', 'linkedinurl', 'linkedin_profile', 'linkedin-url'],
    dataKey: 'linkedin',
  },
  {
    keys: ['location', 'city', 'city_state', 'citystate', 'address', 'current_location', 'currentlocation', 'region'],
    dataKey: 'location',
  },
];

function normalize(str) {
  return (str || '').toLowerCase().replace(/[\s_\-]/g, '');
}

function scoreInput(input, matcher) {
  const attrs = [
    input.name,
    input.id,
    input.placeholder,
    input.getAttribute('aria-label'),
    input.getAttribute('data-field'),
    input.getAttribute('autocomplete'),
  ].map(normalize);

  // Check label element text
  if (input.id) {
    const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
    if (label) attrs.push(normalize(label.textContent));
  }
  // Closest wrapping label
  const wrappingLabel = input.closest('label');
  if (wrappingLabel) attrs.push(normalize(wrappingLabel.textContent));

  return matcher.keys.some(k => attrs.some(a => a.includes(normalize(k))));
}

function fillInput(input, value) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  )?.set;
  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'FILL') return;

  const { data } = msg;
  const fullName = [data.firstName, data.lastName].filter(Boolean).join(' ');
  const resolved = { ...data, fullName };

  const inputs = Array.from(document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]), textarea'));
  const filled = new Set();
  let count = 0;

  for (const matcher of MATCHERS) {
    const value = resolved[matcher.dataKey];
    if (!value) continue;
    for (const input of inputs) {
      if (filled.has(input)) continue;
      if (scoreInput(input, matcher)) {
        fillInput(input, value);
        filled.add(input);
        count++;
      }
    }
  }

  sendResponse({ count });
});
