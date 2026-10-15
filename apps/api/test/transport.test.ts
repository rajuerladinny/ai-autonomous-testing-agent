import { afterEach, describe, it, expect, vi } from 'vitest';
import dns from 'node:dns/promises';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { fetchPinned } from '../src/safety.js';
const scope = { baseUrl: 'https://example.com', paths: ['/docs'] };
afterEach(() => vi.restoreAllMocks());
function network(status = 200, type = 'text/html', body = '<h1>Hello</h1>') {
  vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never);
  let options: Record<string, unknown> = {};
  const request = vi.spyOn(https, 'request').mockImplementation(((
    opts: Record<string, unknown>,
    callback: (res: EventEmitter) => void,
  ) => {
    options = opts;
    const req = new EventEmitter() as EventEmitter & {
      end: () => void;
      destroy: (e: Error) => void;
    };
    req.destroy = (e) => {
      req.emit('error', e);
      req.emit('close');
    };
    req.end = () =>
      queueMicrotask(() => {
        const res = new EventEmitter() as EventEmitter & {
          headers: unknown;
          statusCode: number;
          destroy: () => void;
        };
        res.headers = {
          'content-type': type,
          location: 'http://127.0.0.1/',
          'set-cookie': 'private=secret',
        };
        res.statusCode = status;
        res.destroy = () => {
          req.emit('close');
        };
        callback(res);
        res.emit('data', Buffer.from(body));
        res.emit('end');
        req.emit('close');
      });
    return req;
  }) as never);
  return { request, options: () => options };
}
describe('pinned transport', () => {
  it('connects directly to a validated IP with the original TLS identity and no credentials', async () => {
    const n = network();
    const out = await fetchPinned(new URL('https://example.com/docs'), scope);
    expect(n.options().hostname).toBe('8.8.8.8');
    expect(n.options().servername).toBe('example.com');
    expect(n.options().rejectUnauthorized).toBe(true);
    const headers = n.options().headers as Record<string, string>;
    expect(headers.Host).toBe('example.com');
    expect(headers.Authorization).toBeUndefined();
    expect(headers.Cookie).toBeUndefined();
    expect(out.headers['set-cookie']).toBeUndefined();
    expect(out.headers['content-security-policy']).toContain("form-action 'none'");
  });
  it('rejects a private DNS result before opening a connection', async () => {
    const n = network();
    vi.mocked(dns.lookup).mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
    await expect(fetchPinned(new URL('https://example.com/docs'), scope)).rejects.toThrow(
      'non-public',
    );
    expect(n.request).not.toHaveBeenCalled();
  });
  it('does not follow redirects or preserve redirect headers', async () => {
    const n = network(302);
    await expect(fetchPinned(new URL('https://example.com/docs'), scope)).rejects.toThrow(
      'Redirects',
    );
    expect(n.request).toHaveBeenCalledTimes(1);
  });
  it('rejects non-HTML responses', async () => {
    network(200, 'application/octet-stream');
    await expect(fetchPinned(new URL('https://example.com/docs'), scope)).rejects.toThrow('HTML');
  });
  it('caps response body size', async () => {
    network(200, 'text/html', 'a'.repeat(1_000_001));
    await expect(fetchPinned(new URL('https://example.com/docs'), scope)).rejects.toThrow('size');
  });
});
