/**
 * A send that the provider refused, carrying enough to tell *why* apart from
 * *try again later*.
 *
 * The distinction earns its keep. A 429 or a 503 is noise that BullMQ's backoff
 * absorbs on its own. "This app may not send from this number" is a standing
 * condition that no amount of retrying will clear, and the only signal that it
 * is happening at all — Meta's health endpoint cheerfully reported this clinic's
 * account AVAILABLE throughout, while refusing every send with #131005.
 */

export class SendError extends Error {
  /** HTTP status from the provider. */
  readonly status: number;
  /** Provider error code, e.g. 131005. Absent when the body was not the usual shape. */
  readonly code: number | undefined;
  /** The phone_number_id we tried to send from, so the failure can be attributed. */
  readonly channelAddress: string;

  constructor(opts: {
    message: string;
    status: number;
    code?: number | undefined;
    channelAddress: string;
  }) {
    super(opts.message);
    this.name = 'SendError';
    this.status = opts.status;
    this.code = opts.code;
    this.channelAddress = opts.channelAddress;
  }
}

/**
 * Codes that mean the app is not permitted to send from this number.
 *
 * Deliberately narrow. Every code here must be a standing permission problem
 * rather than anything transient, because a match parks the clinic's channel as
 * BLOCKED in the console until a real send succeeds — a false positive there is
 * a clinic told it is broken when it is not.
 */
const AUTHORIZATION_CODES = new Set([
  10, //     Application does not have permission for this action
  190, //    Access token invalid or expired
  200, //    Permissions error
  131005, // Access denied
]);

export function isAuthorizationFailure(err: unknown): err is SendError {
  return err instanceof SendError && err.code !== undefined && AUTHORIZATION_CODES.has(err.code);
}

/**
 * Codes that mean this template cannot be sent from this number, ever, as
 * written.
 *
 * Separate from AUTHORIZATION_CODES because the remedy is different: the number
 * is fine, the template is not. Templates are per-WABA assets, so the usual
 * cause is a template approved on one clinic's account and absent from another's
 * — and retrying that is 200 doomed Graph calls a sweep, every ten minutes,
 * until the row ages out of the 30-day window.
 */
const PERMANENT_TEMPLATE_CODES = new Set([
  132000, // Number of parameters does not match the expected number
  132001, // Template does not exist in this language, or is not approved
  132005, // Translated text too long
  132007, // Template format character policy violated
  132012, // Template parameter format mismatch
  132015, // Template is paused
  132016, // Template is disabled
]);

export function isPermanentTemplateFailure(err: unknown): err is SendError {
  return (
    err instanceof SendError && err.code !== undefined && PERMANENT_TEMPLATE_CODES.has(err.code)
  );
}

/** Pull `{ error: { message, code } }` out of a provider error body. */
export function parseProviderError(bodyText: string): { message?: string; code?: number } {
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: { message?: string; code?: number; error_user_msg?: string };
    };
    const e = parsed.error;
    if (!e) return {};
    return {
      ...(e.error_user_msg ?? e.message ? { message: e.error_user_msg ?? e.message } : {}),
      ...(e.code !== undefined ? { code: e.code } : {}),
    };
  } catch {
    // Non-JSON body (an HTML error page from a proxy, say) — nothing to extract.
    return {};
  }
}
