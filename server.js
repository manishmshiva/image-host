import path from "path";
import express from "express";
import multer from "multer";
import crypto from "crypto";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const S3_BUCKET = process.env.S3_BUCKET;

// Sevalla/R2-compatible S3 client
const s3 = new S3Client({
  region: "auto",
  endpoint:process.env.ENDPOINT,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Express app
const app = express();

// Static files
app.use(express.static(path.join(__dirname, "public")));

// Multer: keep file in memory (no temp files)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// ---------- ROUTE 1: GET / (serves index.html) ----------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---------- ROUTE 2: POST /upload (upload to Sevalla S3) ----------
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "file is required" });

    const id = crypto.randomUUID().replace(/-/g, "");
    const key = id;

    const put = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
      Metadata: {
        originalname: req.file.originalname || "",
      },
    });

    await s3.send(put);

    // Build dynamic base URL from request
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const pageUrl = `${baseUrl}/i/${id}`;

    res.json({ id, pageUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "upload_failed" });
  }
});

// ---------- ROUTE 3: GET /i/:id (redirect to signed URL) ----------
app.get("/i/:id", async (req, res) => {
  const { id } = req.params;
  const key = id;

  try {
    // Check object exists
    await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));

    // Create 1-hour signed URL
    const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

    return res.redirect(302, signedUrl);
  } catch (err) {
    console.error(err);
    return res.status(404).send("Not found");
  }
});

// Boot
app.listen(process.env.PORT || 3000, () => {
  console.log(`Image host server listening for requests...`);
});
