import { Router } from 'express';
import { env } from '../config/env';
import { html, page, type RawHtml } from './web/layout';

/**
 * Public privacy policy and terms.
 *
 * These exist because Meta will not switch an app Live without a Privacy Policy
 * URL that resolves to a real page with real content, and an unpublished app is
 * confined to Development Mode — which is why every send from the clinic's real
 * number was refused with #131005 while Meta's own test numbers worked.
 *
 * Mounted ahead of the console routers and deliberately outside every auth and
 * CSRF check: Meta's crawler fetches them anonymously, and a 302 to /app/login
 * reads as "no policy" to a reviewer.
 *
 * Everything below describes what the code actually does. Anything we do not
 * genuinely do — scheduled deletion, encryption at rest beyond what the hosting
 * provider gives — is absent on purpose. Overclaiming here is worse than saying
 * nothing, both for review and under the DPDP Act.
 */
export const legalRouter = Router();

/** Bump when the text changes materially. Shown to the reader. */
const LAST_UPDATED = '18 September 2026';

const SERVICE = 'ClinicForYou';

/**
 * Where to write about data. Falling back to the clinic rather than inventing an
 * address: a policy whose contact bounces is worse than one that points at the
 * party actually holding the records.
 */
function contact(): RawHtml {
  return env.LEGAL_CONTACT_EMAIL
    ? html`<a href="mailto:${env.LEGAL_CONTACT_EMAIL}">${env.LEGAL_CONTACT_EMAIL}</a>`
    : html`the clinic you booked with`;
}

function legalPage(title: string, body: RawHtml): string {
  return page(
    { title },
    html`
      <div class="card">
        <h2>${title}</h2>
        <p class="muted">Last updated ${LAST_UPDATED}</p>
        ${body}
        <p class="muted">
          Questions about your information: ${contact()}.
        </p>
      </div>
    `,
  );
}

export function privacyPage(): string {
  return legalPage(
    'Privacy Policy',
    html`
        <p>
          ${SERVICE} lets a clinic take appointment bookings over WhatsApp and run its
          daily queue. This page explains what the service stores, why, and who else
          sees it.
        </p>
        <p>
          Your clinic decides what to record about you and how long to keep it.
          ${SERVICE} runs the software on the clinic's behalf.
        </p>

        <h3>What we store about patients</h3>
        <ul>
          <li>
            Your WhatsApp phone number, the name you give the bot, your language
            choice, and the date you last visited.
          </li>
          <li>
            Your bookings: the date and time or token number, whether you attended or
            cancelled, and any follow-up date the clinic sets.
          </li>
          <li>
            Where you are in a conversation with the bot, so a half-finished booking
            can continue. This is discarded after a period of inactivity.
          </li>
          <li>
            When you last messaged the clinic. WhatsApp only allows a business to
            reply freely within 24 hours of your message, so the service has to know
            this to tell whether it may write to you at all.
          </li>
          <li>
            <strong>Documents the clinic uploads against your visit</strong> —
            prescriptions, reports and receipts — together with the file name, type
            and size. This is health information, and it is visible to that clinic
            only.
          </li>
        </ul>

        <h3>What we store about clinic staff</h3>
        <ul>
          <li>Name, clinic name, contact number, photograph, qualification and specialty.</li>
          <li>Working hours, leave dates, and an access key for signing in.</li>
        </ul>

        <h3>Why</h3>
        <p>
          Only to run the booking service: to place you in a queue or a slot, to send
          you your token and any change to it, to let the clinic call you forward, and
          to send a follow-up reminder if your doctor schedules one.
        </p>

        <h3>Who else sees it</h3>
        <ul>
          <li>
            <strong>Meta (WhatsApp)</strong> — delivers every message to and from you,
            and is subject to WhatsApp's own privacy policy.
          </li>
          <li>
            <strong>Railway</strong> — hosts the service and its database in the
            course of running it.
          </li>
          <li>
            <strong>Object storage</strong> — where uploaded documents are kept, when
            the clinic's deployment is configured to use it.
          </li>
        </ul>
        <p>
          Nobody else. Your information is not sold, not shared with advertisers, and
          not used to build a profile of you. There is no advertising or third-party
          analytics in this service.
        </p>

        <h3>How long it is kept</h3>
        <p>
          For as long as your clinic keeps the record. The service does not delete
          appointment history or uploaded documents automatically. Conversation state
          is the exception and expires on its own after a period of inactivity.
        </p>

        <h3>How it is protected</h3>
        <p>
          Traffic to the service is encrypted in transit. Each clinic signs in with
          its own key and can only reach its own patients and documents; staff at one
          clinic cannot see another's records. Data at rest is protected by the
          safeguards our hosting and storage providers apply. We do not claim more
          than that.
        </p>

        <h3>Your choices</h3>
        <p>
          You can ask your clinic to correct or delete what it holds about you, and
          they can do so in the console. You can stop using the service at any time by
          not messaging the number. Ask ${contact()} if you want to know what is held
          about you.
        </p>

        <h3>Children</h3>
        <p>
          A parent or guardian may book on a child's behalf. The service is not
          intended to be used directly by children.
        </p>

        <h3>Changes</h3>
        <p>
          If this policy changes materially, the date at the top of this page changes
          with it.
        </p>
    `,
  );
}

export function termsPage(): string {
  return legalPage(
    'Terms of Service',
    html`
        <p>
          ${SERVICE} is appointment booking and queue management over WhatsApp, provided
          to clinics. By messaging a clinic's number you agree to these terms.
        </p>

        <h3>This is not for emergencies</h3>
        <p>
          <strong>
            If you need urgent medical help, call your local emergency number or go to
            the nearest hospital.
          </strong>
          This service books appointments. It is not monitored continuously, messages
          may be delayed or fail to arrive, and nobody is watching for an emergency on
          the other end.
        </p>

        <h3>No medical advice</h3>
        <p>
          The bot arranges appointments and nothing more. It does not give medical
          advice, diagnose, or triage. Your care is entirely a matter between you and
          your clinic, and any clinical information you receive comes from them.
        </p>

        <h3>Using the service</h3>
        <ul>
          <li>Give accurate booking details, and cancel if you cannot attend.</li>
          <li>
            Book only for yourself or someone you are responsible for. Do not book
            under another person's number without their knowledge.
          </li>
          <li>
            Do not use the service to send unlawful, abusive or misleading content, or
            to attempt to reach records that are not yours.
          </li>
        </ul>

        <h3>Availability</h3>
        <p>
          The service is provided as it is, without a guarantee of uninterrupted
          availability. It depends on WhatsApp, which we do not control. A booking is
          confirmed only when the clinic's reply reaches you, and a clinic can cancel
          or reschedule an appointment — for example when a doctor is called away.
        </p>

        <h3>Clinic accounts</h3>
        <p>
          A clinic is responsible for keeping its access key private, for what its
          staff record about patients, and for having the right to hold it.
        </p>

        <h3>Changes</h3>
        <p>
          These terms may change; the date at the top of this page changes with them.
          Continuing to use the service means the current version applies.
        </p>
    `,
  );
}

legalRouter.get('/privacy', (_req, res) => {
  res.type('html').send(privacyPage());
});

legalRouter.get('/terms', (_req, res) => {
  res.type('html').send(termsPage());
});
