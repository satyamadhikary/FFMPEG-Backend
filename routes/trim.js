const express = require("express");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const crypto = require("crypto");

ffmpeg.setFfmpegPath(ffmpegPath);

const router = express.Router();

router.post("/trim", async (req, res) => {
  try {
    const { start, end, chunks } = req.body;

    if (!start && !end) {
      return res.status(400).json({ message: "Invalid trim range" });
    }

    const jobId = crypto.randomUUID();
    const tempDir = path.join(__dirname, "../temp", jobId);

    await fs.ensureDir(tempDir);

    let accumulated = 0;
    let segmentFiles = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkStart = accumulated;
      const chunkEnd = accumulated + chunk.duration;

      const overlapStart = Math.max(start, chunkStart);
      const overlapEnd = Math.min(end, chunkEnd);

      if (overlapStart < overlapEnd) {
        const localStart = overlapStart - chunkStart;
        const localDuration = overlapEnd - overlapStart;

        const inputPath = path.join(tempDir, `input${i}.mp4`);
        const outputPath = path.join(tempDir, `segment${i}.mp4`);

        // Download chunk
        const response = await axios({
          method: "GET",
          url: chunk.filePath,
          responseType: "stream",
        });

        const writer = fs.createWriteStream(inputPath);
        response.data.pipe(writer);

        await new Promise((resolve) => writer.on("finish", resolve));

        // Trim
        await new Promise((resolve, reject) => {
          ffmpeg(inputPath)
            .setStartTime(localStart)
            .setDuration(localDuration)
            .outputOptions("-c copy")
            .save(outputPath)
            .on("end", resolve)
            .on("error", reject);
        });

        segmentFiles.push(outputPath);
      }

      accumulated += chunk.duration;
    }

    if (!segmentFiles.length) {
      return res.status(400).json({ message: "No overlapping chunks" });
    }

    // Create concat file
    const concatPath = path.join(tempDir, "concat.txt");

    const concatContent = segmentFiles
      .map((file) => `file '${file}'`)
      .join("\n");

    await fs.writeFile(concatPath, concatContent);

    const finalOutput = path.join(tempDir, "final.mp4");

    // Merge segments
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatPath)
        .inputOptions(["-f concat", "-safe 0"])
        .outputOptions("-c copy")
        .save(finalOutput)
        .on("end", resolve)
        .on("error", reject);
    });

    // Stream file to client
    res.download(finalOutput, "trimmed-video.mp4", async () => {
      await fs.remove(tempDir); // cleanup after download
    });
  } catch (error) {
    console.error("Trim error:", error);
    res.status(500).json({ message: "Server error", error });
  }
});

module.exports = router;
