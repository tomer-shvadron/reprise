import { describe, expect, it } from 'vitest';

import { buildCsp, CONTENT_SECURITY_POLICY, CSP_DIRECTIVES } from './csp';

describe('the content security policy', () => {
  it('lets scripts load from the app only, with no inline or eval escape', () => {
    expect(CSP_DIRECTIVES['script-src']).toEqual(["'self'"]);
    expect(CONTENT_SECURITY_POLICY).not.toContain("'unsafe-eval'");
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self';");
  });

  it('allows the blob worker the audio ticker starts', () => {
    expect(CSP_DIRECTIVES['worker-src']).toContain('blob:');
  });

  it('denies everything it does not name and cannot be framed', () => {
    expect(CONTENT_SECURITY_POLICY.startsWith("default-src 'none';")).toBe(true);
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
  });

  it('serializes directives separated by semicolons', () => {
    expect(buildCsp({ 'a-src': ["'self'", 'x:'], 'b-src': ["'none'"] })).toBe(
      "a-src 'self' x:; b-src 'none'",
    );
  });
});
