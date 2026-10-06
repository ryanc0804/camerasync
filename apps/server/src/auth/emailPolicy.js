// Who may sign up (SCRUM-43): this version of 8kount is for UCF only, so an
// address must be well-formed and on an allowed domain. The list comes from
// ALLOWED_EMAIL_DOMAINS (comma-separated) so a future release can open up
// without a code change.

const DEFAULT_DOMAINS = ["ucf.edu", "knights.ucf.edu"];

// Deliberately loose: one @, no spaces, a dot in the domain. Real
// deliverability is proven by the confirmation email, not by a regex.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function allowedDomains() {
  const configured = (process.env.ALLOWED_EMAIL_DOMAINS ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_DOMAINS;
}

/// Why `email` can't be used to sign up, or null if it can. Expects an
/// already trimmed, lower-cased address.
export function signupEmailError(email) {
  if (!EMAIL_PATTERN.test(email)) {
    return "Enter a valid email address.";
  }
  const domains = allowedDomains();
  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (!domains.includes(domain)) {
    return `Sign up with your UCF email (${domains.map((d) => `@${d}`).join(" or ")}).`;
  }
  return null;
}
