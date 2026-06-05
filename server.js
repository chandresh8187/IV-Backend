const express = require("express");
const cors = require("cors");
const http = require("http");
require("dotenv").config();

// const authRoutes = require("./routes/authRoutes");
// const shiftRoutes = require("./routes/shiftRoutes");
// const productionRoutes = require("./routes/productionRoutes");
// const dashboardRoutes = require("./routes/dashboardRoutes");
// const supervisorRoutes = require("./routes/supervisorRoutes");
// const userRoutes = require("./routes/userRoutes");
// const productionHistoryRoutes = require("./routes/productionHistoryRoutes");

const { Server } = require("socket.io");

const app = express();

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
  }),
);

app.use(express.json());

app.get("/", (req, res) => {
  res.json({ success: true, message: "IV backend running" });
});

app.get("/api", (req, res) => {
  res.json({ success: true, message: "API working" });
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  transports: ["polling", "websocket"],
});

app.set("io", io);

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.emit("socket_connected", {
    success: true,
    socketId: socket.id,
  });

  socket.on("disconnect", (reason) => {
    console.log("Socket disconnected:", reason);
  });
});

// routes below
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/productions", require("./routes/productionRoutes"));
app.use("/api/dashboard", require("./routes/dashboardRoutes"));
app.use("/api/shifts", require("./routes/shiftRoutes"));
app.use("/api/production-history", require("./routes/productionHistoryRoutes"));
app.use("/api/notifications", require("./routes/notificationRoutes"));

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
