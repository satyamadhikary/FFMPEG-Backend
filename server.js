const express = require("express");
const trimRoute = require("./routes/trim");

const app = express();

app.use(express.json({ limit: "50mb" }));
app.use("/api", trimRoute);

app.get("/api/trim", (req, res) => {
    res.send("FFMPEG Backend is running");
});

app.listen(5000, () => {
  console.log("Server running on port 5000");
});
