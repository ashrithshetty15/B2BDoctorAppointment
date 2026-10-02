/**
 * Which clinic is this patient talking about, when the number cannot say?
 *
 * On a clinic's own number the question never arises: Meta's `phone_number_id`
 * IS the tenant, resolved before a single character of the message is read.
 * That is still how most clinics work and this file is never consulted for them.
 *
 * On the shared platform number it is the only question that matters, and the
 * deeplink's code is the only thing that can answer it. Two properties of that
 * code make the obvious implementation wrong:
 *
 *   1. The prefilled text is editable. Patients trim it, or type their own
 *      opening line instead of sending what was handed to them.
 *   2. It exists on the FIRST message only. Every later turn, and every future
 *      visit, arrives with nothing identifying the clinic at all.
 *
 * So the code binds the conversation once and the session carries it from then
 * on. Kept as a pure decision over already-fetched inputs: this is the part
 * worth testing exhaustively, because getting it wrong hands a patient to the
 * wrong practice along with their name, their number and their history.
 */

export type ClinicResolution =
  /** A code in the message. Always wins, so a fresh link always works. */
  | { kind: 'CODE'; clinicId: string; rebound: boolean }
  /** No code, but this conversation already knows its clinic. */
  | { kind: 'SESSION'; clinicId: string }
  /** No code, no session, but they have only ever used one clinic. */
  | { kind: 'ONLY_PRIOR'; clinicId: string }
  /** Known patient, more than one clinic, nothing to disambiguate with. */
  | { kind: 'ASK'; choices: readonly string[] }
  /** Nobody we know, and no code. They need their clinic's link. */
  | { kind: 'UNKNOWN' };

export interface SharedNumberInput {
  /** Code found in the message text, already parsed. Null if none. */
  codeInText: string | null;
  /** The clinic that code belongs to. Null when it matches nothing. */
  clinicForCode: string | null;
  /** Clinic bound to the live conversation, if there is one. */
  sessionClinicId: string | null;
  /** Clinics this patient has booked with before, most recent first. */
  priorClinicIds: readonly string[];
}

export function resolveSharedNumberClinic(input: SharedNumberInput): ClinicResolution {
  const { codeInText, clinicForCode, sessionClinicId, priorClinicIds } = input;

  /**
   * A valid code wins even mid-conversation.
   *
   * Someone half-way through booking at clinic A who scans clinic B's QR means
   * clinic B. Treating the live session as more authoritative would strand them
   * in the wrong practice with no exit they could discover.
   *
   * `rebound` tells the caller this is a switch, so the half-finished
   * conversation can be dropped rather than carried into another clinic.
   */
  if (codeInText && clinicForCode) {
    return {
      kind: 'CODE',
      clinicId: clinicForCode,
      rebound: Boolean(sessionClinicId) && sessionClinicId !== clinicForCode,
    };
  }

  /**
   * A code matching nothing is NOT treated as an error, deliberately.
   *
   * It is far more likely a typo, a card from a clinic that has left the
   * platform, or a patient who happened to write something code-shaped, than an
   * attack. Falling through means a regular patient who fumbles a code still
   * reaches their usual clinic instead of a dead end.
   */

  if (sessionClinicId) return { kind: 'SESSION', clinicId: sessionClinicId };

  if (priorClinicIds.length === 1) return { kind: 'ONLY_PRIOR', clinicId: priorClinicIds[0]! };

  /**
   * More than one, so ask. Picking the most recent would book the wrong clinic
   * about as often as a coin toss for anyone who alternates between two — and
   * unlike a salon, the cost of that is a medical appointment at the wrong
   * practice.
   */
  if (priorClinicIds.length > 1) return { kind: 'ASK', choices: priorClinicIds };

  return { kind: 'UNKNOWN' };
}
