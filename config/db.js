const mysql = require("mysql2/promise");
require("dotenv").config();

const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: Math.max(Number(process.env.DB_CONNECTION_LIMIT) || 10, 1),
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  timezone: "+05:30",
  decimalNumbers: true,
});

// MySQL TIMESTAMP values are stored in UTC and converted using the connection
// session timezone when selected. The mysql2 `timezone` option controls its
// JavaScript date conversion, but does not reliably set MySQL's @@time_zone.
// Set it explicitly so DATE_FORMAT values (including chat message times) are
// consistently returned in the plant's India timezone.
db.on("connection", (connection) => {
  connection.query("SET time_zone = '+05:30'", (error) => {
    if (error) console.error("Could not set MySQL session timezone:", error);
  });
});

module.exports = db;
