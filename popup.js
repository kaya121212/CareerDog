const FIELDS = ['firstName', 'lastName', 'email', 'phone', 'linkedin', 'location'];

function setStatus(msg) {
  document.getElementById('status').textContent = msg;
  setTimeout(() => { document.getElementById('status').textContent = ''; }, 2000);
}

// Load saved values into inputs
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

document.getElementById('fillBtn').addEventListener('click', () => {
  const data = {};
  FIELDS.forEach(id => { data[id] = document.getElementById(id).value.trim(); });
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    chrome.tabs.sendMessage(tab.id, { type: 'FILL', data }, (res) => {
      if (chrome.runtime.lastError) return setStatus('Could not reach page.');
      setStatus(`Filled ${res?.count ?? 0} field(s)`);
    });
  });
});
