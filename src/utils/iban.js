// ISO 13616 IBAN validation (mod-97 algorithm)
export function validateIban(raw) {
  const iban = raw.replace(/\s/g, '').toUpperCase();

  if (iban.length < 15 || iban.length > 34) return false;
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(iban)) return false;

  // Move first 4 chars to end, then replace letters with numbers (A=10..Z=35)
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.split('').map(ch => {
    const code = ch.charCodeAt(0);
    return code >= 65 ? String(code - 55) : ch; // A=10, B=11, …
  }).join('');

  // Compute mod 97 on big integer string in chunks to avoid precision loss
  let remainder = 0;
  for (const ch of numeric) {
    remainder = (remainder * 10 + parseInt(ch, 10)) % 97;
  }

  return remainder === 1;
}

export function formatIbanDisplay(iban) {
  return iban.replace(/\s/g, '').replace(/(.{4})/g, '$1 ').trim();
}

export function getSavedIban() {
  try {
    const p = JSON.parse(localStorage.getItem('packperks_user_profile') || '{}');
    return p.iban || '';
  } catch { return ''; }
}
