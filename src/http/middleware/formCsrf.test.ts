import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { requireFormCsrf } from './auth';

function run(req: Partial<Request>): { status: number | null; body: string | null; passed: boolean } {
  let status: number | null = null;
  let body: string | null = null;
  let passed = false;

  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    send(payload: string) {
      body = payload;
      return this;
    },
  } as unknown as Response;

  const next: NextFunction = () => {
    passed = true;
  };

  requireFormCsrf(
    { method: 'POST', header: () => undefined, get: () => 'localhost', protocol: 'http', ...req } as Request,
    res,
    next,
  );

  return { status, body, passed };
}

describe('requireFormCsrf', () => {
  it('accepts an operator token', () => {
    const r = run({ adminCsrfToken: 'tok-admin', body: { _csrf: 'tok-admin' } });
    expect(r.passed).toBe(true);
  });

  /**
   * The doctor console posts real forms, and a doctor session populates
   * req.csrfToken rather than req.adminCsrfToken. Before this was handled,
   * every doctor form post 403'd.
   */
  it('accepts a doctor token', () => {
    const r = run({ csrfToken: 'tok-doctor', body: { _csrf: 'tok-doctor' } });
    expect(r.passed).toBe(true);
  });

  it('rejects a mismatched token for either audience', () => {
    expect(run({ adminCsrfToken: 'a', body: { _csrf: 'b' } }).status).toBe(403);
    expect(run({ csrfToken: 'a', body: { _csrf: 'b' } }).status).toBe(403);
  });

  it('rejects when the form carries no token at all', () => {
    expect(run({ csrfToken: 'tok', body: {} }).status).toBe(403);
    expect(run({ csrfToken: 'tok', body: undefined }).status).toBe(403);
  });

  /** No session ran before this, so there is nothing to compare against. */
  it('rejects when neither audience established a token', () => {
    const r = run({ body: { _csrf: 'anything' } });
    expect(r.passed).toBe(false);
    expect(r.status).toBe(403);
  });

  it('does not let a doctor token satisfy a request claiming an admin one', () => {
    // Only csrfToken is set; a body echoing some other value must still fail.
    expect(run({ csrfToken: 'doctor-tok', body: { _csrf: 'admin-tok' } }).status).toBe(403);
  });

  it('rejects a cross-site post even with a correct token', () => {
    const r = run({
      csrfToken: 'tok',
      body: { _csrf: 'tok' },
      header: ((name: string) => (name === 'sec-fetch-site' ? 'cross-site' : undefined)) as never,
    });
    expect(r.status).toBe(403);
    expect(r.body).toContain('Cross-site');
  });

  it('rejects a mismatched Origin even with a correct token', () => {
    const r = run({
      csrfToken: 'tok',
      body: { _csrf: 'tok' },
      header: ((name: string) => (name === 'origin' ? 'https://evil.example' : undefined)) as never,
    });
    expect(r.status).toBe(403);
    expect(r.body).toContain('Cross-origin');
  });

  it('lets safe methods through untouched', () => {
    const next = vi.fn();
    requireFormCsrf({ method: 'GET' } as Request, {} as Response, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
