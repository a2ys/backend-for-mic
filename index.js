import express from "express";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const app = express();
app.use(cors());
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
      console.error("JSON parse error:", raw);
      parsed = { keywords: [] };
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
    }));

    res.json({ tracks });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "Spotify error" });
  }
});

app.listen(process.env.PORT, () =>
  console.log(`✅ Server running on http://localhost:${process.env.PORT}`)
);
