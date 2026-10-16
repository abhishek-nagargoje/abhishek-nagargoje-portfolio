import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { csrfProtection, requireAuth, sessionLoader } from './auth/middleware.js';
import { config, packageRoot } from './config.js';
import { HttpError } from './lib/errors.js';
import { logger } from './lib/logger.js';
import { adminRouter } from './routes/admin.js';
import { authRouter } from './routes/auth.js';
import { commentsRouter } from './routes/comments.js';
import { companiesRouter } from './routes/companies.js';
import { dashboardRouter } from './routes/dashboard.js';
import { defectsRouter } from './routes/defects.js';
import { deploymentsRouter } from './routes/deployments.js';
import {
  activityRouter, notificationsRouter, processesRouter, projectsRouter, searchRouter, settingsRouter, usersRouter,
} from './routes/directory.js';
import { documentsRouter } from './routes/documents.js';
import { inventoryRouter, materialsRouter, plantsRouter } from './routes/inventory.js';
import { monitoringRouter } from './routes/monitoring.js';
import { mrpRouter } from './routes/mrp.js';
import {
  goodsReceiptsRouter, procurementRouter, purchaseOrdersRouter, requisitionsRouter,
} from './routes/procurement.js';
import { requirementsRouter } from './routes/requirements.js';
import { deliveriesRouter, invoicesRouter, salesOrdersRouter } from './routes/sales.js';
import { tasksRouter } from './routes/tasks.js';
import { testCasesRouter, testExecutionsRouter } from './routes/tests.js';

const PG_ERRORS: Record<string, [number, string, string]> = {
  '23505': [409, 'CONFLICT', 'A record with the same unique value already exists.'],
  '23503': [422, 'BUSINESS_RULE', 'A referenced record does not exist.'],
  '23514': [422, 'BUSINESS_RULE', 'The change violates a data integrity rule.'],
  '40001': [409, 'CONFLICT', 'The record was changed concurrently. Please retry.'],
  '40P01': [409, 'CONFLICT', 'The record was changed concurrently. Please retry.'],
};

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: config.isProduction ? [] : null,
        },
      },
      strictTransportSecurity: config.isProduction,
    }),
  );

  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    const start = Date.now();
    res.on('finish', () => {
      if (req.path.startsWith('/api')) {
        logger.info('request', { id: req.requestId, method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start });
      }
    });
    next();
  });

  const api = express.Router();
  api.use(express.json({ limit: '200kb' }));
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(sessionLoader);
  api.use(csrfProtection);

  api.get('/health', (_req, res) => void res.json({ status: 'ok' }));
  api.get('/openapi.yaml', (_req, res) => res.sendFile(path.join(packageRoot, 'openapi.yaml')));
  api.use('/auth', authRouter);

  // Everything below requires an authenticated session.
  api.use(requireAuth);
  api.use('/dashboard', dashboardRouter);
  api.use('/users', usersRouter);
  api.use('/projects', projectsRouter);
  api.use('/processes', processesRouter);
  api.use('/requirements', requirementsRouter);
  api.use('/tasks', tasksRouter);
  api.use('/test-cases', testCasesRouter);
  api.use('/test-executions', testExecutionsRouter);
  api.use('/defects', defectsRouter);
  api.use('/comments', commentsRouter);
  api.use('/deployments', deploymentsRouter);
  api.use('/monitoring', monitoringRouter);
  api.use('/notifications', notificationsRouter);
  api.use('/activity', activityRouter);
  api.use('/settings', settingsRouter);
  api.use('/search', searchRouter);
  api.use('/plants', plantsRouter);
  api.use('/materials', materialsRouter);
  api.use('/inventory', inventoryRouter);
  api.use('/mrp', mrpRouter);
  api.use('/purchase-requisitions', requisitionsRouter);
  api.use('/purchase-orders', purchaseOrdersRouter);
  api.use('/goods-receipts', goodsReceiptsRouter);
  api.use('/procurement', procurementRouter);
  api.use('/sales-orders', salesOrdersRouter);
  api.use('/deliveries', deliveriesRouter);
  api.use('/invoices', invoicesRouter);
  api.use('/companies', companiesRouter);
  api.use('/documents', documentsRouter);
  api.use('/admin', adminRouter);
  api.use((_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'API endpoint not found.')));

  app.use('/api', api);

  if (config.serveWeb && existsSync(config.webDist)) {
    app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(config.webDist, 'index.html')));
  }

  // Central error handler: consistent JSON, no internal details leaked to clients.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    void _next;
    let status = 500, code = 'INTERNAL', message = 'An unexpected error occurred. Please try again.';
    let details: unknown;
    if (err instanceof HttpError) {
      ({ status, code, message } = err);
      details = err.details;
    } else if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
      status = 400; code = 'BAD_REQUEST'; message = 'Malformed JSON body.';
    } else if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.too.large') {
      status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'Request body is too large.';
    } else if (err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string' && PG_ERRORS[(err as { code: string }).code]) {
      [status, code, message] = PG_ERRORS[(err as { code: string }).code];
      logger.warn('database constraint', { id: req.requestId, pg: (err as { code: string }).code, detail: (err as { detail?: string }).detail });
    }
    if (status >= 500) logger.error(`unhandled error (request ${req.requestId})`, err);
    res.status(status).json({ error: { code, message, details, requestId: req.requestId } });
  });

  return app;
}
