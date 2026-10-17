import { Link } from "react-router-dom";

// The privacy policy, at /privacy: both app stores link to it, so it works
// signed out. Written from what the app actually stores; update it (and the
// date) when that changes.
const UPDATED = "October 17, 2026";
const CONTACT_EMAIL = "camerasync36@gmail.com";

export function PrivacyScreen() {
  return (
    <main className="privacy-page">
      <style>{css}</style>
      <Link to="/" className="privacy-home">8kount</Link>
      <h1>Privacy Policy</h1>
      <p className="privacy-updated">Last updated {UPDATED}</p>

      <p>
        8kount lets teams record practices from several phones at once and
        review every angle together. This policy explains what we collect,
        why, who can see it, and how to delete it. It applies to the 8kount
        apps for iPhone and Android and the website at 8kount.app.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Your account:</strong> your name, email address and a
          securely hashed password (we never store the password itself).</li>
        <li><strong>Videos and audio you record:</strong> when you record in a
          session, your device uploads the video, with its sound, so your
          team can watch it.</li>
        <li><strong>What you add:</strong> comments on recordings, the groups
          and sessions you create or join, and your settings (like which
          notifications you want).</li>
        <li><strong>Technical data needed to run the service:</strong> a
          sign-in cookie that keeps you signed in, and timing information
          used to line up the angles of a recording.</li>
      </ul>
      <p>
        We don't collect your location or contacts, don't use advertising
        trackers, and don't sell your data.
      </p>

      <h2>Camera, microphone and notifications</h2>
      <p>
        The apps use your camera and microphone only while you're recording
        in a session, and you can join a session as a controller without
        recording. Notifications tell you about practices starting, people
        joining your groups and comments; you can turn each kind off in
        Settings.
      </p>

      <h2>Who can see your data</h2>
      <ul>
        <li>Recordings and comments are visible to the members of the group
          the session belongs to, or, for a session without a group, to the
          people in that session.</li>
        <li>Group members can see each other's names.</li>
        <li>We use service providers to run 8kount: Amazon Web Services hosts
          the app and stores videos, and an email delivery service sends
          sign-up and password reset emails. They process data only to
          provide those services to us.</li>
        <li>We may disclose data if the law requires it.</li>
      </ul>

      <h2>How long we keep it</h2>
      <p>
        We keep your account and recordings until you delete them. A group's
        admins can delete its sessions and recordings at any time.
      </p>

      <h2>Deleting your account</h2>
      <p>
        You can delete your account in Settings in the app or on the website.
        That permanently deletes your account, the videos you recorded and
        your comments, and signs you out everywhere. If you own a group,
        you'll be asked to hand it over to someone else or delete it first.
        Sessions you started stay available to your team, without your name.
      </p>

      <h2>Children</h2>
      <p>
        8kount isn't meant for children under 13, and we don't knowingly
        collect their data. If you believe a child under 13 has an account,
        contact us and we'll delete it.
      </p>

      <h2>Changes and contact</h2>
      <p>
        If this policy changes, we'll update the date above. Questions or
        requests: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </main>
  );
}

const css = `
  .privacy-page {
    max-width: 720px; margin: 0 auto; padding: 40px 20px 80px;
    background: #000; color: #e8e8e8; font-family: system-ui, sans-serif; line-height: 1.6;
  }
  body:has(.privacy-page) { background: #000; }
  .privacy-home { color: #ead217; font-weight: 800; font-size: 1.4rem; text-decoration: none; }
  .privacy-page h1 { margin: 24px 0 4px; font-size: 2rem; }
  .privacy-page h2 { margin: 28px 0 8px; font-size: 1.2rem; }
  .privacy-page p, .privacy-page li { color: #c8c8c8; }
  .privacy-page a { color: #ead217; }
  .privacy-updated { color: #888 !important; font-size: 0.9rem; }
`;
