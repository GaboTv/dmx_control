import compression from 'compression';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { createServer } from 'node:http';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';

import {
  DMX_CHANNELS,
  FIXTURE_CONFIGS,
  FUNCTION_MODES,
  type DmxSnapshot,
} from '../shared/dmx.js';
import { serverConfig } from './config.js';
import { DmxController } from './dmxController.js';

type ClientMessage =
  | { immediate?: boolean; state: unknown; type: 'setState' }
  | { type: 'blackout' }
  | { type: 'reconnect' };

function asyncRoute(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<void>,
) {
  return (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response, next).catch(next);
  };
}

function sendJson(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function parseClientMessage(raw: WebSocket.RawData): ClientMessage {
  const parsed = JSON.parse(raw.toString()) as ClientMessage;

  if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) {
    throw new Error('WebSocket message must include a type.');
  }

  return parsed;
}

const controller = await DmxController.create(serverConfig);
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ path: '/ws', server });
const clients = new Set<WebSocket>();

app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        connectSrc: ["'self'", 'ws:', 'wss:'],
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
  }),
);
app.use(compression());
app.use(express.json({ limit: '64kb' }));

if (serverConfig.corsOrigin) {
  app.use((request, response, next) => {
    response.setHeader('Access-Control-Allow-Origin', serverConfig.corsOrigin ?? '');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (request.method === 'OPTIONS') {
      response.sendStatus(204);
      return;
    }
    next();
  });
}

app.get('/api/config', (_request, response) => {
  response.json({
    channels: DMX_CHANNELS,
    fixtures: FIXTURE_CONFIGS,
    functionModes: FUNCTION_MODES,
  });
});

app.get('/api/status', (_request, response) => {
  response.json(controller.snapshot());
});

app.post(
  '/api/state',
  asyncRoute(async (request, response) => {
    const snapshot = await controller.update(request.body, {
      immediate: request.query.immediate === 'true',
    });
    response.json(snapshot);
  }),
);

app.post(
  '/api/blackout',
  asyncRoute(async (_request, response) => {
    const snapshot = await controller.blackout();
    response.json(snapshot);
  }),
);

app.post(
  '/api/device/reconnect',
  asyncRoute(async (_request, response) => {
    const snapshot = await controller.reconnect();
    response.json(snapshot);
  }),
);

app.use(express.static(serverConfig.staticDir, { index: false, maxAge: '1h' }));

app.get('*', (request, response, next) => {
  if (request.path.startsWith('/api/')) {
    next();
    return;
  }

  response.sendFile(path.join(serverConfig.staticDir, 'index.html'), (error) => {
    if (error) {
      next(error);
    }
  });
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  void _next;
  const message = error instanceof Error ? error.message : 'Unexpected server error.';
  response.status(400).json({ error: message });
});

wss.on('connection', (socket) => {
  clients.add(socket);
  sendJson(socket, { snapshot: controller.snapshot(), type: 'snapshot' });

  socket.on('message', (raw) => {
    void handleSocketMessage(socket, raw);
  });

  socket.on('close', () => {
    clients.delete(socket);
  });
});

controller.onSnapshot((snapshot) => {
  broadcastSnapshot(snapshot);
});

server.listen(serverConfig.port, serverConfig.host, () => {
  const status = controller.snapshot().device;
  console.log(`DMX API listening at http://${serverConfig.host}:${serverConfig.port}`);
  console.log(`DMX driver: ${status.driver} (${status.detail})`);
});

process.on('SIGINT', () => {
  void shutdown();
});

process.on('SIGTERM', () => {
  void shutdown();
});

function broadcastSnapshot(snapshot: DmxSnapshot): void {
  for (const client of clients) {
    sendJson(client, { snapshot, type: 'snapshot' });
  }
}

async function handleSocketMessage(socket: WebSocket, raw: WebSocket.RawData): Promise<void> {
  try {
    const message = parseClientMessage(raw);
    if (message.type === 'setState') {
      sendJson(socket, {
        snapshot: await controller.update(message.state, { immediate: message.immediate }),
        type: 'snapshot',
      });
      return;
    }

    if (message.type === 'blackout') {
      sendJson(socket, { snapshot: await controller.blackout(), type: 'snapshot' });
      return;
    }

    if (message.type === 'reconnect') {
      sendJson(socket, { snapshot: await controller.reconnect(), type: 'snapshot' });
    }
  } catch (error) {
    sendJson(socket, {
      error: error instanceof Error ? error.message : 'Invalid WebSocket message.',
      type: 'error',
    });
  }
}

async function shutdown(): Promise<void> {
  wss.close();
  await controller.blackout();
  await controller.close();
  server.close(() => process.exit(0));
}
