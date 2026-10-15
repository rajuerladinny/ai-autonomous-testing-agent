import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import ipaddr from 'ipaddr.js';
import { ProjectInput, type Project, type PageSnapshot, TestSpec } from '@agent/contracts';
import { createHash } from 'node:crypto';

export class PolicyError extends Error {}

const danger =
  /(?:^|[\/_.-])(delete|remove|logout|signout|checkout|purchase|pay|submit|unsubscribe|transfer|destroy|reset|activate|confirm)(?:$|[\/_.-])/i;

export function safePath(path: string): boolean {
  return (
    path.length <= 200 &&
    /^\/(?:[a-zA-Z0-9_.-]+\/?)*$/.test(path) &&
    !path.split('/').some((p) => p === '.' || p === '..') &&
    !danger.test(path)
  );
}

export function validateProject(input: unknown): ProjectInput {
  const data = ProjectInput.parse(input);
  const u = new URL(data.baseUrl);
  if (
    !['https:', 'http:'].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.port ||
    u.search ||
    u.hash ||
    u.pathname !== '/' ||
    !u.hostname.includes('.')
  ) {
    throw new PolicyError(
      'Use a public HTTP(S) origin without credentials, query, path, or custom port.',
    );
  }
  if (!data.paths.every(safePath))
    throw new PolicyError(
      'Paths must be plain read-only paths; action routes and encoded paths are forbidden.',
    );
  return { ...data, baseUrl: u.origin, paths: [...new Set(data.paths)] };
}

export function scopedUrl(
  raw: string,
  project: Pick<Project, 'baseUrl' | 'paths'>,
  relativeTo = project.baseUrl,
): URL {
  if (/[\\%\s]/.test(raw) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(raw))
    throw new PolicyError('Blocked noncanonical URL');
  const u = new URL(raw, relativeTo);
  if (
    u.origin !== project.baseUrl ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !safePath(u.pathname) ||
    !project.paths.some(
      (p) => p === '/' || u.pathname === p || u.pathname.startsWith(p.replace(/\/$/, '') + '/'),
    )
  ) {
    throw new PolicyError('Blocked URL outside the approved read-only scope');
  }
  return u;
}

export function isPublicAddress(address: string): boolean {
  try {
    const ip = ipaddr.parse(address);
    if (ip.kind() === 'ipv6') {
      const v6 = ip as ipaddr.IPv6;
      return (
        !v6.isIPv4MappedAddress() &&
        v6.range() === 'unicast' &&
        v6.match(ipaddr.parse('2000::') as ipaddr.IPv6, 3)
      );
    }
    return ip.range() === 'unicast';
  } catch {
    return false;
  }
}

export type Resolver = (hostname: string) => Promise<{ address: string; family: number }[]>;
export async function resolvePublic(
  hostname: string,
  resolve: Resolver = (host) => dns.lookup(host, { all: true, verbatim: true }),
) {
  const addresses = await resolve(hostname.replace(/^\[|\]$/g, ''));
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    throw new PolicyError('Blocked non-public destination');
  return addresses[0];
}

// Never use route.continue()/route.fetch(): Node connects to the exact validated IP.
// Browser DNS, cookies, authorization, proxies and redirects cannot bypass this gate.
export async function fetchPinned(url: URL, project: Pick<Project, 'baseUrl' | 'paths'>) {
  scopedUrl(url.href, project);
  const address = await resolvePublic(url.hostname);
  return new Promise<{ status: number; body: Buffer; headers: Record<string, string> }>(
    (resolve, reject) => {
      const transport = url.protocol === 'https:' ? https : http;
      const req = transport.request(
        {
          protocol: url.protocol,
          hostname: address.address,
          family: address.family,
          port: url.protocol === 'https:' ? 443 : 80,
          method: 'GET',
          path: url.pathname,
          servername: url.hostname,
          rejectUnauthorized: true,
          headers: {
            Host: url.host,
            Accept: 'text/html',
            'Accept-Encoding': 'identity',
            'User-Agent': 'SafeTestingAgent/0.1 (read-only; owner-authorized)',
          },
          agent: false,
        },
        (res) => {
          const status = res.statusCode ?? 502;
          if (status >= 300 && status < 400) {
            // Fail closed on redirects instead of following a potentially mutating URL.
            res.destroy();
            reject(
              new Error('Redirects are blocked; approve the final destination URL explicitly'),
            );
            return;
          }
          if (!(res.headers['content-type'] ?? '').includes('text/html')) {
            res.destroy();
            reject(new Error('Only HTML documents are permitted'));
            return;
          }
          let bytes = 0;
          const chunks: Buffer[] = [];
          res.on('data', (b: Buffer) => {
            bytes += b.length;
            if (bytes > 1_000_000) {
              res.destroy();
              req.destroy(new Error('Response size limit exceeded'));
            } else chunks.push(b);
          });
          res.on('end', () =>
            resolve({
              status,
              body: Buffer.concat(chunks),
              headers: {
                'content-type': 'text/html; charset=utf-8',
                'content-security-policy':
                  "default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; frame-src 'none'; base-uri 'none'",
                'x-content-type-options': 'nosniff',
              },
            }),
          );
          res.on('error', reject);
        },
      );
      // A wall-clock deadline covers TLS and slow streaming responses too.
      const timer = setTimeout(() => req.destroy(new Error('Network deadline exceeded')), 8000);
      req.once('close', () => clearTimeout(timer));
      req.on('error', reject);
      req.end();
    },
  );
}

export function digest(spec: TestSpec, discoveryId: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ discoveryId, spec: TestSpec.parse(spec) }))
    .digest('hex');
}

export function validateEvidence(spec: TestSpec, pages: PageSnapshot[]): TestSpec {
  const parsed = TestSpec.parse(spec);
  const page = pages.find((p) => p.path === parsed.path);
  if (!page) throw new Error('Test references an undiscovered page');
  if (
    parsed.assertions.some((a) =>
      a.kind === 'title' ? a.expected !== page.title : !page.headings.includes(a.expected),
    )
  ) {
    throw new Error('Test assertion has no discovery evidence');
  }
  return parsed;
}

export function sanitizeText(value: string): string {
  return value
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]')
    .replace(/\b(?:\d[\s-]?){7,}\b/g, '[number]')
    .replace(/\b(?:sk-|ghp_|github_pat_)[a-zA-Z0-9_-]+\b/g, '[secret]')
    .replace(/[\u0000-\u001f]/g, ' ')
    .trim()
    .slice(0, 200);
}
