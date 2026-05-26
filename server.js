const express = require("express");
const cors = require("cors");
const http = require("http");
require("dotenv").config();

const authRoutes = require("./routes/authRoutes");
const shiftRoutes = require("./routes/shiftRoutes");
const productionRoutes = require("./routes/productionRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const supervisorRoutes = require("./routes/supervisorRoutes");
const userRoutes = require("./routes/userRoutes");
const productionHistoryRoutes = require("./routes/productionHistoryRoutes");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api", (req, res) => {
  res.json({
    success: true,
    message: "API working",
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/shifts", shiftRoutes);
app.use("/api/productions", productionRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/supervisors", supervisorRoutes);
app.use("/api/users", userRoutes);
app.use("/api/production-history", productionHistoryRoutes);

const server = http.createServer(app);

const { Server } = require("socket.io");

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

app.set("io", io);

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
