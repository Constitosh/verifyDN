// backend/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';
import { assignRoles } from './roleBot.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(cors({ origin: process.env.WEB_APP_ORIGIN?.split(',') || false, credentials: true }));
app.set('trust proxy', 1);
app.use(session({
  name: 'sid',
  secret: process.env.SESSION_SECRET || 'change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: 1000 * 60 * 60 * 24 * 30 // 30 days
  }
}));

// In-memory store for demo. Replace with Redis/DB in production.
const store = new Map(); // key = discordId, value = profile

/* -------------------- Discord OAuth -------------------- */
const DISCORD_OAUTH = {
  client_id: process.env.DISCORD_CLIENT_ID,
  client_secret: process.env.DISCORD_CLIENT_SECRET,
  redirect_uri: process.env.DISCORD_REDIRECT_URI, // e.g. https://api.example.com/auth/discord/callback
  scope: 'identify',
};

app.get('/auth/discord', (req, res) => {
  const state = Math.random().toString(36).slice(2);
  req.session.oauth_state = state;
  const url = new URL('https://discord.com/api/oauth2/authorize');
  url.searchParams.set('client_id', DISCORD_OAUTH.client_id);
  url.searchParams.set('redirect_uri', DISCORD_OAUTH.redirect_uri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', DISCORD_OAUTH.scope);
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  res.redirect(url.toString());
});

app.get('/auth/discord/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state || state !== req.session.oauth_state) return res.status(400).send('Invalid state');

    // Exchange code → token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_OAUTH.client_id,
        client_secret: DISCORD_OAUTH.client_secret,
        grant_type: 'authorization_code',
        code: code.toString(),
        redirect_uri: DISCORD_OAUTH.redirect_uri,
      })
    });
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok) return res.status(401).send(JSON.stringify(tokenJson));

    // Get user
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `${tokenJson.token_type} ${tokenJson.access_token}` }
    });
    const user = await userRes.json();
    if (!user || !user.id) return res.status(401).send('Discord user fetch failed');

    // Persist to session
    req.session.discord = {
      id: user.id,
      username: `${user.username}${user.discriminator && user.discriminator !== '0' ? '#' + user.discriminator : ''}`
    };

    // Optionally create empty profile
    if (!store.has(user.id)) store.set(user.id, { discordId: user.id, discordName: req.session.discord.username });

    // Close popup and notify parent
    res.send(`
      <html><body><script>
        window.opener && window.opener.postMessage({
          type: 'discord-auth',
          payload: { id: ${JSON.stringify(user.id)}, username: ${JSON.stringify(req.session.discord.username)} }
        }, '*');
        window.close();
      </script>Logged in. You can close this window.</body></html>
    `);
  } catch (e) {
    console.error(e);
    res.status(500).send('OAuth error');
  }
});

app.get('/api/me', (req, res) => {
  if (!req.session.discord) return res.status(401).json({ ok: false });
  const { id, username } = req.session.discord;
  const profile = store.get(id) || { discordId: id, discordName: username };
  res.json({ ok: true, discordId: id, discordName: username, profile });
});

/* -------------------- Save profile -------------------- */
app.post('/api/save', (req, res) => {
  if (!req.session.discord) return res.status(401).json({ ok: false, error: 'Not authenticated' });
  const { id, username } = req.session.discord;
  const { evmAddress, btcAddress, adaAddress } = req.body || {};

  const prev = store.get(id) || {};
  const profile = {
    discordId: id,
    discordName: username,
    evmAddress: evmAddress || prev.evmAddress || null,
    btcAddress: btcAddress || prev.btcAddress || null,
    adaAddress: adaAddress || prev.adaAddress || null,
    updatedAt: new Date().toISOString()
  };
  store.set(id, profile);
  res.json({ ok: true, profile });
});

/* -------------------- Assign roles -------------------- */
app.post('/api/assign-roles', async (req, res) => {
  if (!req.session.discord) return res.status(401).json({ ok: false, error: 'Not authenticated' });
  const { id } = req.session.discord;
  try {
    const profile = store.get(id);
    if (!profile) return res.status(400).json({ ok: false, error: 'No profile saved yet' });

    const result = await assignRoles(profile); // calls your bot logic
    res.json({ ok: true, result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'Role assign failed' });
  }
});

/* -------------------- Serve wagmi widget -------------------- */
app.use('/widget/evm', express.static(path.join(__dirname, 'widget-evm')));

/* -------------------- Start -------------------- */
const PORT = process.env.PORT || 8888;
app.listen(PORT, '0.0.0.0', () => console.log('API listening on', PORT));
