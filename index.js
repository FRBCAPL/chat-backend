// DEBUG: Added logging for verify-pin errors
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const { StreamChat } = require('stream-chat');

const app = express(); // must be before any app.use

// --- CORS setup: allow local dev and GitHub Pages frontend ---
const allowedOrigins = [
  'http://localhost:5173',
  'https://frbcapl.github.io'
];

// Use a function for origin to avoid trailing slash issues and for flexibility
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

// Enable preflight for all routes
app.options('*', cors());

app.use(express.json());

const SHEET_ID = '1tvMgMHsRwQxsR6lMNlSnztmwpK7fhZeNEyqjTqmRFRc';
const STREAM_API_KEY = 'emnbag2b9jt4';
const STREAM_API_SECRET = 't8ehrbr2yz5uv84u952mkud9bnjd42zcggwny8at2e9qmvyc5aahsfqexrjtxa5g';

// --------- Google Sheets Auth (works locally and on Render) ---------
let auth;
if (process.env.GOOGLE_SERVICE_ACCOUNT) {
  // On Render or if env var is set
  const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
} else {
  // Local development: use the file
  auth = new google.auth.GoogleAuth({
    keyFile: 'service-account.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

const sheets = google.sheets({ version: 'v4', auth });

const serverClient = StreamChat.getInstance(STREAM_API_KEY, STREAM_API_SECRET);

async function getUserByPin(pin) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "'Contact Info'!A:H",
  });
  const rows = res.data.values || [];

  for (let i = 1; i < rows.length; i++) {
    const name = rows[i][0];
    const sheetPin = rows[i][7];
    if (sheetPin === pin) {
      if (!name) return null;
      const userId = `${name.toLowerCase().replace(/\s+/g, '_')}_${pin}`;
      return { id: userId, name };
    }
  }
  return null;
}

app.post('/verify-pin', async (req, res) => {
  const { pin } = req.body;
  console.log('Received POST /verify-pin with pin:', pin);

  if (!pin) {
    console.log('No PIN provided');
    return res.status(400).json({ error: 'PIN is required' });
  }

  try {
    const user = await getUserByPin(pin);
    if (!user) {
      console.log('Invalid PIN:', pin);
      return res.status(401).json({ error: 'Invalid PIN' });
    }

    await serverClient.upsertUser({ id: user.id, name: user.name });

    // Create or get the user's personal channel
    const userChannel = serverClient.channel('messaging', user.id, {
      name: user.name,
      members: [user.id],
    });
    await userChannel.create().catch((e) => {
      console.log('userChannel.create error:', e.message);
    });

    // Ensure user is member of general channel
    const generalChannel = serverClient.channel('messaging', 'general', { name: 'General' });
    await generalChannel.create().catch((e) => {
      console.log('generalChannel.create error:', e.message);
    });
    await generalChannel.addMembers([user.id]);

    const token = serverClient.createToken(user.id);

    res.json({ userId: user.id, name: user.name, token });
  } catch (error) {
    console.error('Error in /verify-pin:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
