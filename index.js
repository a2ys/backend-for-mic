import express from "express";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const app = express();

const allowedOrigins = [
  "http://localhost:5173",
  "https://mic-frontend.a2ys.dev",
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
};

app.use(cors(corsOptions));
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

let spotifyToken = null;
let tokenExpiry = 0;

async function getSpotifyToken() {
  if (spotifyToken && Date.now() < tokenExpiry) return spotifyToken;

  const resp = await axios.post(
    "https://accounts.spotify.com/api/token",
    new URLSearchParams({ grant_type: "client_credentials" }),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization:
          "Basic " +
          Buffer.from(
            process.env.SPOTIFY_CLIENT_ID +
              ":" +
              process.env.SPOTIFY_CLIENT_SECRET
          ).toString("base64"),
      },
    }
  );

  spotifyToken = resp.data.access_token;
  tokenExpiry = Date.now() + resp.data.expires_in * 1000;
  return spotifyToken;
}

app.post("/mood", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || typeof text !== "string" || text.trim() === "") {
      return res.status(400).json({
        error: "Input text is required and must be a non-empty string.",
      });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `The user gave this mood: "${text}".
  Suggest 3 genres or vibe keywords that would fit for Spotify search.
  Respond ONLY in JSON format like: {"keywords": ["chill", "lofi", "study"]}`;

    const result = await model.generateContent(prompt);

    let raw = result.response.candidates[0].content.parts[0].text;
    raw = raw.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error("Failed to parse JSON from Gemini:", raw);

      return res.status(500).json({ error: "Failed to process AI response." });
    }

    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gemini error" });
  }
});

app.get("/playlist", async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || typeof query !== "string" || query.trim() === "") {
      return res.status(400).json({ error: "A query parameter is required." });
    }

    const token = await getSpotifyToken();

    const resp = await axios.get("https://api.spotify.com/v1/search", {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        q: query,
        type: "track",
        limit: 10,
      },
    });

    const tracks = resp.data.tracks.items.map((t) => ({
      name: t.name,
      artist: t.artists.map((a) => a.name).join(", "),
      album: t.album.name,
      image: t.album.images[0]?.url,
      url: t.external_urls.spotify,
      preview_url: t.preview_url,
    }));

    // some Fisher-Yates shuffle to randomize the tracks cuz it goes in order 💀
    for (let i = tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
    }

    res.json({ tracks });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "Spotify error" });
  }
});

app.get("/health", (_, res) => {
  res.status(200).send("OK");
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () =>
  console.log(`✅ Server running on http://localhost:${PORT}`)
);
