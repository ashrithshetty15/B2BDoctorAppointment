import type { Doctor, Language } from '@prisma/client';
import { t } from '../../i18n/templates';
import { MAX_REPLY_BUTTONS, type ListRow, type ReplyButton } from '../../messaging/types';
import { numericChoice } from '../intent';
import { Steps } from '../steps';
import { reply, replyWithList, type Reply, type StepResult } from '../types';

/**
 * "Which doctor?", asked once per conversation at a clinic with more than one.
 *
 * Deliberately not a ConversationFlow: it runs in the engine before a doctor
 * exists, and every flow's context requires one. Keeping it separate is what
 * lets a solo clinic skip this entirely — the engine picks the only doctor and
 * this code never runs.
 *
 * Doctors are carried by id rather than by position: the list is rebuilt from
 * the database on the next turn, and a doctor going on leave in between would
 * otherwise silently shift everyone else's number.
 */

/** Meta truncates a button at ~20 characters and a list row title at ~24. */
function label(doctor: Doctor, max: number): string {
  const name = `Dr. ${doctor.name}`;
  return name.length <= max ? name : `${name.slice(0, max - 1)}…`;
}

export function askWhichDoctor(
  doctors: Doctor[],
  language: Language,
  extraFirst: Reply[] = [],
): StepResult {
  const body = t(language, 'selectDoctor');

  // Three or fewer fits WhatsApp's reply buttons, which are one tap. Beyond
  // that it has to be a list, which also gives room to show the specialty.
  const replies: Reply[] =
    doctors.length <= MAX_REPLY_BUTTONS
      ? [
          reply(
            'selectDoctor',
            body,
            doctors.map(
              (d, i): ReplyButton => ({ id: String(i + 1), title: label(d, 20) }),
            ),
          ),
        ]
      : [
          replyWithList(
            'selectDoctor',
            body,
            t(language, 'btnChooseDoctor'),
            doctors.map(
              (d, i): ListRow => ({
                id: String(i + 1),
                title: label(d, 24),
                ...(d.specialty ? { description: d.specialty } : {}),
              }),
            ),
          ),
        ];

  return {
    nextStep: Steps.SELECT_DOCTOR,
    replies: [...extraFirst, ...replies],
    data: { doctorIds: doctors.map((d) => d.id) },
  };
}

export type DoctorChoice =
  | { chosen: Doctor }
  | { chosen: null; result: StepResult };

/**
 * Read the patient's answer. Returns the doctor, or the prompt to re-ask.
 *
 * The offered ids come from the session rather than from a fresh query, so a
 * patient who answers "2" gets the doctor who was second when they were asked.
 */
export function readDoctorChoice(
  input: string,
  offeredIds: string[],
  doctors: Doctor[],
  language: Language,
): DoctorChoice {
  const choice = numericChoice(input);
  const id = choice !== null && choice >= 1 && choice <= offeredIds.length
    ? offeredIds[choice - 1]
    : undefined;

  const chosen = id ? doctors.find((d) => d.id === id) : undefined;
  if (chosen) return { chosen };

  // Either nonsense, or a doctor who stopped being bookable since we asked.
  // Re-offering the current list is right in both cases.
  return {
    chosen: null,
    result: askWhichDoctor(doctors, language, [
      reply('selectDoctorInvalid', t(language, 'selectDoctorInvalid')),
    ]),
  };
}
