const express = require("express");
const router = express.Router();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const crypto = require("crypto");
const ffmpegPath = require("ffmpeg-static");
// Set your FFmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

console.log("Path:", ffmpegPath);
console.log("Exists:", fs.existsSync(ffmpegPath));

router.post("/trim", async (req, res) => {
  const requestId = crypto.randomBytes(8).toString("hex");
  const baseTemp = process.env.RENDER ? "/tmp" : path.join(__dirname, "temp");
  const tempDir = path.join(baseTemp, requestId);

  try {
    const { start, end, chunks } = req.body;

    // Create the specific ID folder (recursive: true ensures 'temp' exists too)
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // 2. Download Chunks
    const downloadedFiles = await Promise.all(
      chunks.map(async (chunk, i) => {
        const url = chunk.filePath;
        const filePath = path.join(tempDir, `chunk${i}.mp4`);
        const response = await axios({
          method: "GET",
          url,
          responseType: "stream",
        });

        await new Promise((resolve, reject) => {
          const writer = fs.createWriteStream(filePath);
          response.data.pipe(writer);
          writer.on("finish", resolve);
          writer.on("error", reject);
        });

        return filePath;
      }),
    );

    // 3. Create concat file for FFmpeg
    const concatFilePath = path.join(tempDir, "concat.txt");
    const concatContent = downloadedFiles
      .map((file) => `file '${file.replace(/\\/g, "/")}'`)
      .join("\n");

    fs.writeFileSync(concatFilePath, concatContent);

    const mergedPath = path.join(tempDir, "merged.mp4");

    // 4. Merge chunks
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatFilePath)
        .inputOptions(["-f concat", "-safe 0"])
        .outputOptions("-c copy")
        .save(mergedPath)
        .on("end", resolve)
        .on("error", reject);
    });

    const outputPath = path.join(tempDir, "trimmed.mp4");

    // 5. Trim merged video
    await new Promise((resolve, reject) => {
      ffmpeg(mergedPath)
        .setStartTime(start)
        .setDuration(end - start)
        .outputOptions("-c copy")
        .save(outputPath)
        .on("end", resolve)
        .on("error", reject);
    });

    // 6. Send file and Cleanup specific folder
    res.download(outputPath, "trimmed.mp4", (err) => {
      if (err) {
        console.error(`Download error for ${requestId}:`, err);
      }

      setTimeout(() => {
        try {
          if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
            console.log(`Successfully deleted session folder: ${requestId}`);
          }
        } catch (cleanupErr) {
          console.error(
            `Manual cleanup needed for ${tempDir}:`,
            cleanupErr.message,
          );
        }
      }, 500);
    });
  } catch (error) {
    console.error("Trim process error:", error);

    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (e) {
        console.error("Initial catch cleanup failed:", e.message);
      }
    }

    res.status(500).send("Failed to trim video");
  }
});

module.exports = router;
