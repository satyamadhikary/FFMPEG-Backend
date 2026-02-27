const express = require("express");
const router = express.Router();
const ffmpeg = require("fluent-ffmpeg");
const axios = require("axios");
const stream = require("stream");
const { PassThrough } = require("stream");

ffmpeg.setFfmpegPath("/usr/bin/ffmpeg");

router.post("/trim", async (req, res) => {
  try {
    const { start, end, chunks } = req.body;
    if (!chunks || !chunks.length) return res.status(400).send("No video chunks provided");

    // Prepare array of PassThrough streams
    const inputStreams = await Promise.all(
      chunks.map(async (chunk) => {
        const response = await axios({
          url: chunk.filePath,
          method: "GET",
          responseType: "stream",
        });
        const pass = new PassThrough();
        response.data.pipe(pass);
        return pass;
      })
    );

    // Initialize FFmpeg
    let command = ffmpeg();

    // Add each input stream
    inputStreams.forEach((s) => command = command.input(s));

    // Build concat filter string
    const n = inputStreams.length;
    const inputs = [...Array(n).keys()].map(i => `[${i}:v:0][${i}:a:0]`).join('');
    const filter = `${inputs}concat=n=${n}:v=1:a=1[outv][outa]`;

    command
      .complexFilter([filter])
      .outputOptions([`-map [outv]`, `-map [outa]`, `-ss ${start}`, `-to ${end}`, "-preset veryfast"])
      .format("mp4")
      .on("start", (cmd) => console.log("FFmpeg command:", cmd))
      .on("error", (err) => {
        console.error("Trim error:", err);
        if (!res.headersSent) res.status(500).send("Failed to trim video");
      })
      .on("end", () => console.log("Trim/merge complete"))
      .pipe(res, { end: true }); // Pipe directly to response
  } catch (err) {
    console.error("Trim error:", err);
    if (!res.headersSent) res.status(500).send("Failed to trim video");
  }
});

module.exports = router;
