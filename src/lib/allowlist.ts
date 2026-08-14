// Team allow-list for the "email only" sign-in.
//
// NOTE: this is a lightweight gate, not hard security — the directory data is readable
// by anyone with the public API key once anonymous sign-in is on. It exists so only
// recognised team emails get into the UI. This dataset is smaller/more sensitive than
// the sibling Campus Directory, so it's an explicit per-email list — no domain-wide allow.

const ALLOWED_EMAILS = [
  'alex@yventures.com.sg',
  'adam@yventures.com.sg',
  'florentina@yventures.com.sg',
];

export function isAllowed(rawEmail: string): boolean {
  const email = rawEmail.trim().toLowerCase();
  if (!email.includes('@')) return false;
  return ALLOWED_EMAILS.includes(email);
}
