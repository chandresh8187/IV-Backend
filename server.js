const http = require("http");

require("dotenv-flow").config({ silent: true });

const cors = require("cors");
const express = require("express");
const helmet = require("helmet");
const path = require("path");
const jwt = require("jsonwebtoken");
const { rateLimit } = require("express-rate-limit");
const { Server } = require("socket.io");

const db = require("./config/db");
const maintenanceModeMiddleware = require("./middleware/maintenanceModeMiddleware");

const requiredEnvironment = ["DB_HOST", "DB_USER", "DB_NAME", "JWT_SECRET"];
const missingEnvironment = requiredEnvironment.filter(
  (key) => !String(process.env[key] || "").trim(),
);

if (missingEnvironment.length) {
  throw new Error(
    `Missing required environment variables: ${missingEnvironment.join(", ")}`,
  );
}

const allowedOrigins = String(process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const isOriginAllowed = (origin) =>
  !origin ||
  allowedOrigins.includes(origin) ||
  (process.env.NODE_ENV !== "production" &&
    /^https?:\/\/localhost(?::\d+)?$/.test(origin));

const corsOptions = {
  origin(origin, callback) {
    if (isOriginAllowed(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type"],
  maxAge: 86400,
};

const app = express();
const server = http.createServer(app);

app.disable("x-powered-by");
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS) || 1);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors(corsOptions));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use("/downloads/apks", express.static(path.join(__dirname, "uploads/apks"), {
  dotfiles: "deny",
  index: false,
  immutable: true,
  maxAge: "365d",
}));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.API_RATE_LIMIT) || 600,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please try again shortly.",
  },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LOGIN_RATE_LIMIT) || 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    message: "Too many sign-in attempts. Please try again later.",
  },
});

app.get("/", (req, res) => {
  res.json({ success: true, message: "IV backend running" });
});

app.get("/health", async (req, res) => {
  try {
    await db.query("SELECT 1");
    return res.json({ success: true, status: "healthy" });
  } catch (error) {
    console.error("Health check failed:", error);
    return res.status(503).json({ success: false, status: "unhealthy" });
  }
});

app.use("/api", apiLimiter);
app.use("/api/auth/login", loginLimiter);
app.use("/api", maintenanceModeMiddleware);

app.get("/api", (req, res) => {
  res.json({ success: true, message: "API working" });
});

const io = new Server(server, {
  cors: corsOptions,
  transports: ["polling", "websocket"],
  maxHttpBufferSize: 1e6,
  pingTimeout: 20000,
  pingInterval: 25000,
});

app.set("io", io);

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  // Keep global events working during a rolling mobile-app deployment. New
  // clients authenticate and join a user room; older builds can temporarily
  // remain connected but cannot receive user-targeted events.
  if (!token) return next();

  try {
    socket.user = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: "iv-api",
      audience: "iv-app",
    });
  } catch {
    return next(new Error("Invalid socket authentication"));
  }

  db.query(
    "SELECT id FROM users WHERE id = ? AND status = 'active' LIMIT 1",
    [socket.user.id],
  )
    .then(([users]) =>
      users.length
        ? next()
        : next(new Error("Socket user is not active")),
    )
    .catch(() => next(new Error("Socket authentication unavailable")));
});

io.on("connection", (socket) => {
  if (socket.user?.id) socket.join(`user:${socket.user.id}`);
  socket.emit("socket_connected", {
    success: true,
    user_id: socket.user?.id || null,
  });
});

app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/productions", require("./routes/productionRoutes"));
app.use("/api/dashboard", require("./routes/dashboardRoutes"));
app.use("/api/shifts", require("./routes/shiftRoutes"));
app.use("/api/plant", require("./routes/plantStatusRoutes"));
app.use("/api/production-history", require("./routes/productionHistoryRoutes"));
app.use("/api/notifications", require("./routes/notificationRoutes"));
app.use("/api/users", require("./routes/userRoutes"));
app.use("/api/supervisors", require("./routes/supervisorRoutes"));
app.use("/api/app-update", require("./routes/appUpdateRoutes"));
app.use("/api/settings", require("./routes/settingsRoutes"));
app.use(
  "/api/production-planning",
  require("./routes/productionPlanningRoutes"),
);
app.use("/api/certificates", require("./routes/productionCertificateRoutes"));

app.use((req, res) => {
  res.status(404).json({ success: false, message: "API endpoint not found" });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  const isUploadError =
    error.name === "MulterError" ||
    error.message === "Only PDF files are allowed";
  if (isUploadError) {
    return res.status(400).json({ success: false, message: error.message });
  }

  if (error.message === "Origin is not allowed by CORS") {
    return res.status(403).json({ success: false, message: error.message });
  }

  console.error("Unhandled request error:", error);
  return res.status(500).json({
    success: false,
    message: "An unexpected server error occurred",
  });
});

const port = Number(process.env.PORT) || 5000;
server.listen(port, () => {
  console.log(`IV API listening on port ${port}`);
});

const shutdown = (signal) => {
  console.log(`${signal} received; closing server`);
  server.close(async () => {
    await db.end();
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 10000).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

module.exports = { app, server };
