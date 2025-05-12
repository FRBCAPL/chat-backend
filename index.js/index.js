process.on('uncaughtException', function (err) {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', function (reason, promise) {
  console.error('Unhandled Rejection:', reason);
});
console.log("Starting index.js");

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const { StreamChat } = require('stream-chat');

const app = express();

// --- CORS setup: allow local dev and GitHub Pages frontend ---
const allowedOrigins = [
  'http://localhost:5173',
  'https://frbcapl.github.io'
];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

app.use(express.json());

const SHEET_ID = '1tvMgMHsRwQxsR6lMNlSnztmwpK7fhZeNEyqjTqmRFRc';
const STREAM_API_KEY = 'emnbag2b9jt4';
const STREAM_API_SECRET = 't8ehrbr2yz5uv84u952mkud9bnjd42zcggwny8at2e9qmvyc5aahsfqexrjtxa5g';

const auth = new google.auth.GoogleAuth({
  keyFile: 'service-account.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
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
  if (!pin) return res.status(400).json({ error: 'PIN is required' });

  try {
    const user = await getUserByPin(pin);
    if (!user) return res.status(401).json({ error: 'Invalid PIN' });

    await serverClient.upsertUser({ id: user.id, name: user.name });

    // Create or get the user's personal channel
    const userChannel = serverClient.channel('messaging', user.id, {
      name: user.name,
      members: [user.id],
    });
    await userChannel.create().catch(() => {}); // ignore if already exists

    // Ensure user is member of general channel
    const generalChannel = serverClient.channel('messaging', 'general', { name: 'General' });
    await generalChannel.create().catch(() => {}); // ignore if exists
    await generalChannel.addMembers([user.id]);

    const token = serverClient.createToken(user.id);

    res.json({ userId: user.id, name: user.name, token });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
