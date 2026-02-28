const express = require("express");
const router = express.Router();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const crypto = require("crypto");

// IMPORTANT:
// Do NOT use ffmpeg-static
// Do NOT set ffmpeg path
// Render will install system ffmpeg via apt

router.post("/trim", async (req, res) => {
  const requestId = crypto.randomBytes(8).toString("hex");

  // Render only allows writing to /tmp
  const baseTemp = process.env.RENDER ? "/tmp" : path.join(__dirname, "temp");
  const tempDir = path.join(baseTemp, requestId);

  try {
    const { start, end, chunks } = req.body;

    if (!start && start !== 0 || !end || !chunks?.length) {
      return res.status(400).json({
        message: "Invalid request data",
      });
    }

    // Create temp folder
    fs.mkdirSync(tempDir, { recursive: true });

    // 1️⃣ Download chunks
    const downloadedFiles = await Promise.all(
      chunks.map(async (chunk, i) => {
        if (!chunk.filePath) {
          throw new Error("Invalid chunk filePath");
        }

        const filePath = path.join(tempDir, `chunk${i}.mp4`);

        const response = await axios({
          method: "GET",
          url: chunk.filePath,
          responseType: "stream",
        });

        await new Promise((resolve, reject) => {
          const writer = fs.createWriteStream(filePath);
          response.data.pipe(writer);
          writer.on("finish", resolve);
          writer.on("error", reject);
        });

        return filePath;
      })
    );

    // 2️⃣ Create concat file
    const concatFilePath = path.join(tempDir, "concat.txt");

    const concatContent = downloadedFiles
      .map((file) => `file '${file}'`)
      .join("\n");

    fs.writeFileSync(concatFilePath, concatContent);

    const mergedPath = path.join(tempDir, "merged.mp4");

    // 3️⃣ Merge chunks
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

    // 4️⃣ Trim merged video
    await new Promise((resolve, reject) => {
      ffmpeg(mergedPath)
        .setStartTime(start)
        .setDuration(end - start)
        .outputOptions("-c copy")
        .save(outputPath)
        .on("end", resolve)
        .on("error", reject);
    });

    // 5️⃣ Send file
    res.download(outputPath, "trimmed.mp4", (err) => {
      if (err) {
        console.error(`Download error (${requestId}):`, err);
      }

      // Cleanup after short delay
      setTimeout(() => {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
          console.log(`Cleaned up session: ${requestId}`);
        } catch (cleanupErr) {
          console.error("Cleanup failed:", cleanupErr.message);
        }
      }, 1000);
    });

  } catch (error) {
    console.error("Trim process error FULL:", error);
    console.error("Stack:", error.stack);

    // Cleanup on failure
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (cleanupErr) {
      console.error("Cleanup after error failed:", cleanupErr.message);
    }

    res.status(500).json({
      message: "Failed to trim video",
      error: error.message,
    });
  }
});

module.exports = router;
