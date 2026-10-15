import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../dist/app.js';
import { AgentService } from '../dist/service.js';
import { TestGenerator } from '../dist/generator.js';
import { testDatabase } from './helpers.js';
import type { Database } from '../src/db.js';
import type { INestApplication } from '@nestjs/common';
const token = 'unit-test-admin-token-'.repeat(3);
describe('NestJS HTTP boundary', () => {
  let db: Database, app: INestApplication, service: AgentService;
  beforeEach(async () => {
    db = await testDatabase();
    service = new AgentService(
      db,
      new TestGenerator(),
      {
        discover: async () => ({
          pages: [{ path: '/', title: 'Demo', headings: ['Home'], links: [] }],
          blocked: 0,
        }),
        execute: async () => [],
      },
      async () => {},
    );
    app = await createApp(service, { adminToken: token, webOrigin: 'http://127.0.0.1:5173' });
  });
  afterEach(async () => {
    await app.close();
    await db.close();
  });
  it('allows only the minimal health check without authentication', async () => {
    await request(app.getHttpServer()).get('/health').expect(200, { status: 'ok' });
    await request(app.getHttpServer()).get('/api/projects').expect(401);
    await request(app.getHttpServer())
      .get('/api/projects')
      .set('Authorization', 'Bearer wrong')
      .expect(401);
  });
  it('accepts authenticated requests and fails closed on malformed inputs', async () => {
    const http = request(app.getHttpServer());
    const created = await http
      .post('/api/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'API Demo',
        baseUrl: 'https://example.com',
        paths: ['/'],
        ownershipConfirmed: true,
      })
      .expect(201);
    expect(created.body.baseUrl).toBe('https://example.com');
    await http
      .get('/api/projects')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((r) => expect(r.body).toHaveLength(1));
    await http
      .post('/api/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'bad', baseUrl: 'file:///etc/passwd', paths: ['/'], ownershipConfirmed: true })
      .expect(400);
    await http
      .get('/api/projects/not-a-uuid/tests')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    await http
      .post(`/api/projects/${created.body.id}/runs`)
      .set('Authorization', `Bearer ${token}`)
      .send({ testIds: [] })
      .expect(400);
  });
  it('does not grant CORS access to arbitrary origins', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/config')
      .set('Authorization', `Bearer ${token}`)
      .set('Origin', 'https://evil.example')
      .expect(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173');
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });
  it('does not expose internal exception details', async () => {
    const original = db.query.bind(db);
    db.query = async () => {
      throw new Error('secret-database-password');
    };
    const response = await request(app.getHttpServer())
      .get('/api/projects')
      .set('Authorization', `Bearer ${token}`)
      .expect(502);
    expect(response.text).not.toContain('secret-database-password');
    db.query = original;
  });
  it('limits expensive generation requests', async () => {
    for (let i = 0; i < 3; i++)
      await request(app.getHttpServer())
        .post('/api/discoveries/not-a-uuid/generate')
        .set('Authorization', `Bearer ${token}`)
        .send({ allowExternalAi: false })
        .expect(400);
    await request(app.getHttpServer())
      .post('/api/discoveries/not-a-uuid/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ allowExternalAi: false })
      .expect(429);
  });
});
