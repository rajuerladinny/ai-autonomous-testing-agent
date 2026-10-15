import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  isPublicAddress,
  resolvePublic,
  scopedUrl,
  validateProject,
  safePath,
  digest,
  validateEvidence,
  sanitizeText,
} from '../src/safety.js';
import { TestSpec } from '@agent/contracts';
const scope = { baseUrl: 'https://example.com', paths: ['/docs'] };

describe('network scope and SSRF controls', () => {
  it.each([
    '127.0.0.1',
    '0.0.0.0',
    '10.1.2.3',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '100.64.0.1',
    '224.0.0.1',
    '::1',
    '::',
    'fc00::1',
    'fe80::1',
    '::ffff:8.8.8.8',
    '2001:db8::1',
    '64:ff9b::808:808',
  ])('blocks non-public address %s', (address) => expect(isPublicAddress(address)).toBe(false));
  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('accepts public address %s', (address) =>
    expect(isPublicAddress(address)).toBe(true),
  );
  it('rejects mixed public/private DNS answers', async () => {
    await expect(
      resolvePublic('example.com', async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]),
    ).rejects.toThrow('non-public');
  });
  it('rejects empty DNS answers', async () => {
    await expect(resolvePublic('example.com', async () => [])).rejects.toThrow();
  });
  it('returns the exact validated address for transport pinning', async () => {
    expect(
      await resolvePublic('example.com', async () => [{ address: '8.8.8.8', family: 4 }]),
    ).toEqual({ address: '8.8.8.8', family: 4 });
  });
  it.each([
    'https://evil.example/docs',
    'https://example.com.evil.test/docs',
    'http://example.com/docs',
    'https://user:secret@example.com/docs',
    '/docs?delete=1',
    '/docs#x',
    '/docs/delete',
    '/docs/logout',
    '/docs/pay',
    '/docs/%2fadmin',
    '/docs/%252e%252e',
    '/documentation',
    'file:///etc/passwd',
    'javascript:alert(1)',
  ])('rejects out-of-scope URL %s', (url) => expect(() => scopedUrl(url, scope)).toThrow());
  it('allows segment-bounded paths', () => {
    expect(scopedUrl('/docs/intro', scope).pathname).toBe('/docs/intro');
  });
  it('rejects encoded traversal before URL normalization, even in root scope', () => {
    for (const path of ['/docs/%2e%2e/admin', '/docs/../admin', ' /docs', '/docs\\admin'])
      expect(() => scopedUrl(path, { ...scope, paths: ['/'] })).toThrow();
  });
  it.each([
    '/delete',
    '/logout',
    '/checkout',
    '/confirm',
    '/a/../b',
    '/a%2fb',
    '//example.com',
    '/reset-password',
    '/transfer',
    '/subscribe?x=1',
  ])('rejects unsafe path %s', (path) => expect(safePath(path)).toBe(false));
  it('requires ownership and a plain origin', () => {
    const good = {
      name: 'Demo',
      baseUrl: 'https://example.com',
      paths: ['/docs'],
      maxPages: 5,
      ownershipConfirmed: true,
    };
    expect(validateProject(good).baseUrl).toBe('https://example.com');
    for (const bad of [
      { ownershipConfirmed: false },
      { baseUrl: 'https://example.com/app' },
      { baseUrl: 'https://example.com:8080' },
      { paths: ['/delete'] },
      { maxPages: 21 },
      { secret: 'x' },
    ])
      expect(() => validateProject({ ...good, ...bad })).toThrow();
  });
});

describe('test language and provenance', () => {
  const pages = [{ path: '/docs', title: 'Docs', headings: ['Welcome'], links: [] }];
  const spec = {
    title: 'Docs smoke',
    path: '/docs',
    assertions: [{ kind: 'title' as const, expected: 'Docs' }],
  };
  it('accepts evidence-backed assertions', () =>
    expect(validateEvidence(spec, pages)).toEqual(spec));
  it('rejects fabricated pages and assertions', () => {
    expect(() => validateEvidence({ ...spec, path: '/other' }, pages)).toThrow();
    expect(() =>
      validateEvidence({ ...spec, assertions: [{ kind: 'heading', expected: 'Injected' }] }, pages),
    ).toThrow();
  });
  it('has no click, script, request or arbitrary selector commands', () => {
    for (const kind of ['click', 'evaluate', 'request', 'fill', 'submit'])
      expect(() => TestSpec.parse({ ...spec, assertions: [{ kind, expected: 'x' }] })).toThrow();
    expect(() => TestSpec.parse({ ...spec, code: 'process.env' })).toThrow();
  });
  it('binds approvals to the exact specification and discovery', () => {
    const id = randomUUID(),
      hash = digest(spec, id);
    expect(digest(spec, id)).toBe(hash);
    expect(digest({ ...spec, title: 'Changed' }, id)).not.toBe(hash);
    expect(digest(spec, randomUUID())).not.toBe(hash);
  });
  it('redacts common personal data patterns before storage', () => {
    expect(sanitizeText('Contact a@example.com 9876543210')).toBe('Contact [email] [number]');
  });
});
