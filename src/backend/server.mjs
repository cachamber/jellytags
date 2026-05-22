import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { Jellyfin } from '@jellyfin/sdk';
import { getItemsApi } from '@jellyfin/sdk/lib/utils/api/items-api.js';
import { getItemUpdateApi } from '@jellyfin/sdk/lib/utils/api/item-update-api.js';
import { getSystemApi } from '@jellyfin/sdk/lib/utils/api/system-api.js';
import { getUserApi } from '@jellyfin/sdk/lib/utils/api/user-api.js';
import { getUserViewsApi } from '@jellyfin/sdk/lib/utils/api/user-views-api.js';

const jellyfinUrl = process.env.JELLYFIN_URL;
const jellyfinToken = process.env.JELLYFIN_TOKEN;
const port = Number(process.env.PORT || 80);

if (!jellyfinUrl || !jellyfinToken) {
  console.error('Missing required env vars: JELLYFIN_URL and JELLYFIN_TOKEN');
  process.exit(1);
}

const jellyfin = new Jellyfin({
  clientInfo: { name: 'JellyTagsProxy', version: '1.0.0' },
  deviceInfo: { name: 'JellyTagsProxy', id: 'jellytags-proxy' }
});

const api = jellyfin.createApi(jellyfinUrl);
api.accessToken = jellyfinToken;

const itemsApi = getItemsApi(api);
const updateApi = getItemUpdateApi(api);
const systemApi = getSystemApi(api);
const userApi = getUserApi(api);
const userViewsApi = getUserViewsApi(api);

const app = express();
app.disable('x-powered-by');

app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

function parseList(value) {
  if (!value) return undefined;
  const raw = Array.isArray(value) ? value.join(',') : String(value);
  const parsed = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : undefined;
}

function parseBoolean(value) {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  return String(value).toLowerCase() === 'true';
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/system/public-info', async (_req, res, next) => {
  try {
    const response = await systemApi.getPublicSystemInfo();
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

app.get('/api/users', async (_req, res, next) => {
  try {
    const response = await userApi.getUsers();
    res.json(response.data || []);
  } catch (error) {
    next(error);
  }
});

app.get('/api/users/:userId/views', async (req, res, next) => {
  try {
    const response = await userViewsApi.getUserViews({ userId: req.params.userId });
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

app.get('/api/items', async (req, res, next) => {
  try {
    const response = await itemsApi.getItems({
      userId: req.query.userId ? String(req.query.userId) : undefined,
      parentId: req.query.parentId ? String(req.query.parentId) : undefined,
      recursive: parseBoolean(req.query.recursive),
      includeItemTypes: parseList(req.query.includeItemTypes),
      fields: parseList(req.query.fields),
      ids: parseList(req.query.ids)
    });

    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

app.put('/api/items/:itemId', async (req, res, next) => {
  try {
    await updateApi.updateItem({
      itemId: req.params.itemId,
      baseItemDto: req.body
    });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.get('/api/items/:itemId/images/primary', async (req, res, next) => {
  try {
    const upstreamUrl = new URL(`/Items/${req.params.itemId}/Images/Primary`, jellyfinUrl);
    if (req.query.tag) upstreamUrl.searchParams.set('tag', String(req.query.tag));
    if (req.query.maxWidth) upstreamUrl.searchParams.set('maxWidth', String(req.query.maxWidth));

    const upstream = await fetch(upstreamUrl, {
      headers: {
        'X-Emby-Token': jellyfinToken
      }
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      res.status(upstream.status).send(text || 'Image request failed');
      return;
    }

    const contentType = upstream.headers.get('content-type');
    const cacheControl = upstream.headers.get('cache-control');
    if (contentType) res.setHeader('Content-Type', contentType);
    if (cacheControl) res.setHeader('Cache-Control', cacheControl);

    const body = Buffer.from(await upstream.arrayBuffer());
    res.send(body);
  } catch (error) {
    next(error);
  }
});

const distPath = path.resolve(process.cwd(), 'dist');
if (existsSync(distPath)) {
  app.use(express.static(distPath));

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.use((error, _req, res, _next) => {
  const status = error?.response?.status || 500;
  const detail = error?.response?.data || error?.message || 'Proxy request failed';
  console.error('Proxy error', status, detail);
  res.status(status).json({ error: typeof detail === 'string' ? detail : 'Proxy request failed' });
});

app.listen(port, () => {
  console.log(`JellyTags proxy listening on port ${port}`);
});
