import 'reflect-metadata';
import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Inject,
  Module,
  HttpException,
  Catch,
  type ExceptionFilter,
  type ArgumentsHost,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import { json, type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { AgentService } from './service.js';
import { PolicyError } from './safety.js';

@Controller('api')
class ApiController {
  constructor(@Inject('AGENT') private readonly service: AgentService) {}
  @Get('config') config() {
    return { aiEnabled: this.service.aiEnabled, mode: 'read-only', maxTestsPerRun: 20 };
  }
  @Get('projects') projects() {
    return this.service.projects();
  }
  @Post('projects') create(@Body() body: unknown) {
    return this.service.createProject(body);
  }
  @Get('projects/:id/discoveries') discoveries(@Param('id') id: string) {
    return this.service.listDiscoveries(id);
  }
  @Post('projects/:id/discoveries') discover(@Param('id') id: string, @Body() body: unknown) {
    if (body && Object.keys(body as object).length)
      throw new HttpException('Unexpected discovery options', 400);
    return this.service.discover(id);
  }
  @Post('discoveries/:id/generate') generate(@Param('id') id: string, @Body() body: unknown) {
    return this.service.generate(id, body);
  }
  @Post('discoveries/:id/cancel') cancelDiscovery(@Param('id') id: string) {
    return this.service.cancel('DISCOVER', id);
  }
  @Post('runs/:id/cancel') cancelRun(@Param('id') id: string) {
    return this.service.cancel('RUN', id);
  }
  @Get('projects/:id/tests') tests(@Param('id') id: string) {
    return this.service.tests(id);
  }
  @Post('tests/:id/decision') decide(@Param('id') id: string, @Body() body: unknown) {
    return this.service.decide(id, body);
  }
  @Post('projects/:id/runs') run(@Param('id') id: string, @Body() body: unknown) {
    return this.service.createRun(id, body);
  }
  @Get('projects/:id/runs') runs(@Param('id') id: string) {
    return this.service.runs(id);
  }
  @Get('runs/:id/report') report(@Param('id') id: string) {
    return this.service.report(id);
  }
  @Get('projects/:id/events') events(@Param('id') id: string) {
    return this.service.events(id);
  }
}

@Catch()
class SafeErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : error instanceof ZodError || error instanceof PolicyError
          ? 400
          : 502;
    const message =
      error instanceof HttpException || error instanceof PolicyError
        ? error.message
        : status === 400
          ? 'Invalid request'
          : 'Operation failed; verify configuration and service availability';
    response.status(status).json({ statusCode: status, message });
  }
}
function authorized(header: string | undefined, token: string) {
  const expected = Buffer.from(`Bearer ${token}`),
    actual = Buffer.from(header ?? '');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export async function createApp(
  service: AgentService,
  config: { adminToken: string; webOrigin: string },
) {
  if (config.adminToken.length < 32 || /REPLACE/i.test(config.adminToken))
    throw new Error('Set a random ADMIN_TOKEN of at least 32 characters');
  @Module({ controllers: [ApiController], providers: [{ provide: 'AGENT', useValue: service }] })
  class AppModule {}
  const app = await NestFactory.create(AppModule, { logger: false, bodyParser: false });
  app.use(helmet());
  app.enableCors({
    origin: config.webOrigin,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    credentials: false,
  });
  const buckets = new Map<string, { start: number; count: number }>();
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/health' && req.method === 'GET') {
      void service.db
        .query('SELECT 1')
        .then(() => res.json({ status: 'ok' }))
        .catch(() => res.status(503).json({ status: 'unavailable' }));
      return;
    }
    if (req.method === 'OPTIONS') {
      next();
      return;
    }
    const key = `${req.ip}:${req.method === 'GET' ? 'read' : req.path.endsWith('/generate') ? 'ai' : 'write'}`;
    const now = Date.now();
    for (const [k, b] of buckets) if (now - b.start > 60000) buckets.delete(k);
    const bucket = buckets.get(key) ?? { start: now, count: 0 };
    bucket.count++;
    buckets.set(key, bucket);
    const limit = req.method === 'GET' ? 120 : req.path.endsWith('/generate') ? 3 : 20;
    if (bucket.count > limit) {
      res.setHeader('Retry-After', '60');
      res.status(429).json({ message: 'Rate limit reached; try again in a minute' });
      return;
    }
    if (!authorized(req.headers.authorization, config.adminToken)) {
      res.status(401).json({ message: 'A valid admin token is required' });
      return;
    }
    next();
  });
  app.use(json({ limit: '32kb' }));
  app.useGlobalFilters(new SafeErrors());
  await app.init();
  return app;
}
