import type { ChannelHealth, ChannelStatus } from './types';

/**
 * Reading Meta's `health_status` into something a console can show.
 *
 * Kept separate from the adapter's HTTP call so it can be tested against real
 * captured payloads rather than a hand-written approximation — the shape has
 * enough traps to be worth pinning.
 */

/**
 * Errors about WhatsApp Business *calling*, which this product does not use.
 * They appear on perfectly healthy numbers, so surfacing them would mark every
 * clinic broken and train everyone to ignore the indicator.
 */
const IGNORED_ERROR_CODES = new Set([
  138024, // SIP not enabled for WhatsApp Business calling
  138025, // app has not configured a SIP server
]);

/** Most-actionable first: an account-level fault outranks a number-level one. */
const ENTITY_PRIORITY = ['BUSINESS', 'WABA', 'APP', 'PHONE_NUMBER'];

interface RawError {
  error_code?: number;
  error_description?: string;
  possible_solution?: string;
}

interface RawEntity {
  entity_type?: string;
  id?: string;
  can_send_message?: string;
  errors?: RawError[];
  additional_info?: string[];
}

interface RawHealth {
  can_send_message?: string;
  entities?: RawEntity[];
}

function toStatus(value: unknown): ChannelStatus {
  switch (value) {
    case 'AVAILABLE':
    case 'LIMITED':
    case 'BLOCKED':
      return value;
    default:
      return 'UNKNOWN';
  }
}

function realErrors(entity: RawEntity): RawError[] {
  return (entity.errors ?? []).filter(
    (e) => e.error_code !== undefined && !IGNORED_ERROR_CODES.has(e.error_code),
  );
}

/**
 * `{ health_status: {...} }` as returned by the Graph API -> normalised health.
 *
 * The rollup alone is not enough. A number can report LIMITED while the account
 * above it is BLOCKED on billing; the rollup then says BLOCKED with no hint of
 * why, and the useful sentence is on the WABA entity. So the status comes from
 * the rollup and the explanation from whichever entity is actually at fault.
 */
export function parseChannelHealth(body: unknown): ChannelHealth {
  const raw = (body as { health_status?: RawHealth } | undefined)?.health_status;
  if (!raw) return { status: 'UNKNOWN' };

  const status = toStatus(raw.can_send_message);
  const entities = raw.entities ?? [];

  // Prefer an entity that is actually blocked or limited; fall back to any that
  // carries a real error even while reporting itself available.
  const faulted = entities
    .filter((e) => e.can_send_message === 'BLOCKED' || e.can_send_message === 'LIMITED')
    .sort(
      (a, b) =>
        ENTITY_PRIORITY.indexOf(a.entity_type ?? '') -
        ENTITY_PRIORITY.indexOf(b.entity_type ?? ''),
    );
  const withError = faulted.find((e) => realErrors(e).length > 0);
  const chosen = withError ?? faulted[0];

  if (!chosen) return { status };

  const error = realErrors(chosen)[0];
  // additional_info carries advisory notes with no code — the display-name
  // warning arrives this way, and it is the only explanation on offer.
  const note = chosen.additional_info?.[0];

  return {
    status,
    ...(chosen.entity_type ? { entity: chosen.entity_type } : {}),
    ...(error?.error_description
      ? { reason: error.error_description }
      : note
        ? { reason: note }
        : {}),
    ...(error?.error_code !== undefined ? { code: error.error_code } : {}),
    ...(error?.possible_solution ? { solution: error.possible_solution } : {}),
  };
}
