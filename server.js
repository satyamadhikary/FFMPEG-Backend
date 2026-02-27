const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));

const trimRoutes = require("./routes/trim");
app.use("/api", trimRoutes);

app.get("/api/trim", (req, res) => {
  res.send("FFMPEG Backend is running");
});

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});