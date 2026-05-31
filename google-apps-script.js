// ─────────────────────────────────────────────────────────────────────────────
// CareerDog – Google Apps Script Web App
//
// Setup:
//   1. Open your existing Google Sheet
//   2. Extensions → Apps Script → paste this code
//   3. Set SHEET_NAME to your sheet tab name (bottom tab label)
//      Leave blank ("") to use the first sheet automatically
//   4. Deploy → New deployment → Web App
//      Execute as: Me
//      Who has access: Anyone
//   5. Copy the Web App URL → paste into CareerDog Profile → Google Script URL
// ─────────────────────────────────────────────────────────────────────────────

const SHEET_NAME = ''; // e.g. 'Job Applications' — leave blank for first sheet

const HEADERS = [
  'Email', 'Date', 'Company', 'Job Title', 'Job URL',
  'Platform', 'Location', 'Salary', 'Status', 'Recruiter',
];

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = SHEET_NAME
      ? ss.getSheetByName(SHEET_NAME) || ss.getActiveSheet()
      : ss.getSheets()[0];

    // Add header row only if sheet is empty
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
      sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    }

    sheet.appendRow([
      data.email     || '',
      data.date      || '',
      data.company   || '',
      data.title     || '',
      data.url       || '',
      data.platform  || '',
      data.location  || '',
      data.salary    || '',
      data.status    || 'Applied',
      data.recruiter || '',
    ]);

    return response({ success: true });
  } catch (err) {
    return response({ success: false, error: err.message });
  }
}

function doGet() {
  return response({ status: 'CareerDog API is running' });
}

function response(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
