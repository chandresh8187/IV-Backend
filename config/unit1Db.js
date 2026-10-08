const mysql = require('mysql2/promise');

const unit1Db = mysql.createPool({
  host: process.env.UNIT1_DB_HOST || process.env.DB_HOST,
  port: Number(process.env.UNIT1_DB_PORT || process.env.DB_PORT) || 3306,
  user: process.env.UNIT1_DB_USER || process.env.DB_USER,
  password: process.env.UNIT1_DB_PASSWORD ?? process.env.DB_PASSWORD,
  database: process.env.UNIT1_DB_NAME || 'ivs1_production',
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true,
  timezone: 'Z',
});

module.exports = unit1Db;
