require('dotenv-flow').config({ silent: true });
const readline = require('readline');
const bcrypt = require('bcryptjs');
const db = require('../config/unit1Db');

const value = flag => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : '';
};
const askPassword = () => new Promise(resolve => {
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  terminal.stdoutMuted = true;
  terminal._writeToOutput = function (text) { if (!this.stdoutMuted) this.output.write(text); };
  terminal.question('Password (8 characters minimum): ', answer => { terminal.close(); process.stdout.write('\n'); resolve(answer); });
});

async function main() {
  const email = String(value('--email')).trim().toLowerCase();
  const name = String(value('--name')).trim();
  const role = String(value('--role') || 'superadmin').trim();
  if (!email || !name || !['superadmin', 'production_manager', 'plant_manager', 'admin', 'supervisor', 'labour'].includes(role)) {
    throw new Error('Usage: npm run unit1:user:create -- --email address --name "Full Name" [--role superadmin]');
  }
  const [existing] = await db.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
  if (existing.length) throw new Error('That Unit 1 email already exists.');
  const password = await askPassword();
  if (password.length < 8) throw new Error('Password must contain at least 8 characters.');
  const hash = await bcrypt.hash(password, 12);
  await db.query('INSERT INTO users (name, email, password, role, status) VALUES (?, ?, ?, ?, ?)', [name, email, hash, role, 'active']);
  console.log(`Created Unit 1 ${role} account for ${email}.`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.end());
