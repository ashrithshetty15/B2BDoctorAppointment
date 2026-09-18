import { describe, expect, it } from 'vitest';
import { SendError, isAuthorizationFailure, parseProviderError } from './sendError';

const make = (code?: number, status = 400) =>
  new SendError({ message: 'nope', status, code, channelAddress: '1404728522723325' });

describe('isAuthorizationFailure', () => {
  /**
   * The four codes that mean "this app may not send from this number". A match
   * parks the clinic as BLOCKED until a real send succeeds, so the set has to
   * stay narrow — a false positive tells a working clinic it is broken.
   */
  it.each([
    [131005, 'Access denied'],
    [10, 'Application does not have permission'],
    [200, 'Permissions error'],
    [190, 'token invalid or expired'],
  ])('treats #%i as a standing permission failure (%s)', (code) => {
    expect(isAuthorizationFailure(make(code))).toBe(true);
  });

  /** Backoff already handles these; marking a clinic broken over one would be wrong. */
  it.each([
    [4, 'rate limited'],
    [131026, 'undeliverable recipient'],
    [131047, 'outside the 24-hour window'],
    [500, 'transient server error'],
  ])('leaves #%i to the retry policy (%s)', (code) => {
    expect(isAuthorizationFailure(make(code))).toBe(false);
  });

  it('does not guess when the provider returned no code', () => {
    expect(isAuthorizationFailure(make(undefined))).toBe(false);
  });

  it('ignores errors that are not send failures at all', () => {
    expect(isAuthorizationFailure(new Error('(#131005) Access denied'))).toBe(false);
    expect(isAuthorizationFailure(undefined)).toBe(false);
  });
});

describe('parseProviderError', () => {
  /** The real body from the refusal that prompted all of this. */
  it('pulls the code and message out of a Graph error body', () => {
    const body = JSON.stringify({
      error: {
        message: '(#131005) Access denied',
        type: 'OAuthException',
        code: 131005,
        fbtrace_id: 'Ax1',
      },
    });
    expect(parseProviderError(body)).toEqual({ message: '(#131005) Access denied', code: 131005 });
  });

  it('prefers the user-facing message when Meta supplies one', () => {
    const body = JSON.stringify({
      error: { message: 'generic', error_user_msg: 'Add a payment method', code: 141006 },
    });
    expect(parseProviderError(body).message).toBe('Add a payment method');
  });

  it('returns nothing rather than throwing on a non-JSON body', () => {
    expect(parseProviderError('<html>502 Bad Gateway</html>')).toEqual({});
    expect(parseProviderError('')).toEqual({});
  });

  it('returns nothing when the body is JSON but carries no error', () => {
    expect(parseProviderError(JSON.stringify({ messages: [{ id: 'wamid.X' }] }))).toEqual({});
  });
});
