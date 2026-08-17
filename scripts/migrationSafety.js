const DESTRUCTIVE_PATTERNS = [
  { pattern: /\bDROP\b/i, reason: "DROP operations are not allowed" },
  { pattern: /\bTRUNCATE\b/i, reason: "TRUNCATE operations are not allowed" },
  { pattern: /\bDELETE\s+FROM\b/i, reason: "DELETE operations are not allowed" },
  { pattern: /\bUPDATE\b/i, reason: "migrations cannot update existing rows" },
  { pattern: /\bREPLACE\s+INTO\b/i, reason: "REPLACE can delete existing rows" },
  { pattern: /\bRENAME\s+TABLE\b/i, reason: "table renames are not allowed" },
  { pattern: /\bALTER\s+TABLE[\s\S]*?\b(?:CHANGE|MODIFY)\b/i, reason: "CHANGE/MODIFY can rewrite existing column data" },
  { pattern: /\bSET\s+FOREIGN_KEY_CHECKS\s*=\s*0\b/i, reason: "foreign-key checks cannot be disabled" },
  { pattern: /\bLOAD\s+DATA\b/i, reason: "bulk data loading is not allowed" },
];

function splitSqlStatements(sql) {
  const statements = [];
  let current = "";
  let quote = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (lineComment) {
      current += char;
      if (char === "\n") lineComment = false;
      continue;
    }

    if (blockComment) {
      current += char;
      if (char === "*" && next === "/") {
        current += next;
        index += 1;
        blockComment = false;
      }
      continue;
    }

    if (!quote && char === "-" && next === "-") {
      current += char + next;
      index += 1;
      lineComment = true;
      continue;
    }

    if (!quote && char === "#") {
      current += char;
      lineComment = true;
      continue;
    }

    if (!quote && char === "/" && next === "*") {
      current += char + next;
      index += 1;
      blockComment = true;
      continue;
    }

    if (quote) {
      current += char;
      if (char === "\\" && next) {
        current += next;
        index += 1;
      } else if (char === quote) {
        if (next === quote) {
          current += next;
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      current += char;
      continue;
    }

    if (char === ";") {
      if (stripSqlComments(current).trim()) statements.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (stripSqlComments(current).trim()) statements.push(current.trim());
  return statements;
}

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*--.*$/gm, " ")
    .replace(/^\s*#.*$/gm, " ");
}

function maskQuotedValues(sql) {
  return sql
    .replace(/'(?:''|\\.|[^'])*'/g, "''")
    .replace(/"(?:""|\\.|[^"])*"/g, '""')
    .replace(/`(?:``|[^`])*`/g, "``");
}

function validateMigrationSql(sql) {
  const statements = splitSqlStatements(sql);

  if (statements.length === 0) {
    throw new Error("migration contains no SQL statement");
  }

  if (statements.length !== 1) {
    throw new Error(
      "each migration must contain exactly one SQL statement; split this change into separate migration files",
    );
  }

  const scannableSql = maskQuotedValues(stripSqlComments(statements[0]));
  const normalizedSql = scannableSql.replace(/\s+/g, " ").trim();
  const isApprovedLegacyFcmRemoval =
    /^ALTER TABLE `?users`? DROP COLUMN `?fcm_token`?$/i.test(normalizedSql);
  const isApprovedFcmIdRepair =
    /^ALTER TABLE `?user_fcm_tokens`? MODIFY(?: COLUMN)? `?id`? BIGINT UNSIGNED NOT NULL AUTO_INCREMENT$/i.test(
      normalizedSql,
    );
  for (const rule of DESTRUCTIVE_PATTERNS) {
    if (
      rule.pattern.test(scannableSql) &&
      !(
        isApprovedLegacyFcmRemoval &&
        rule.reason === "DROP operations are not allowed"
      ) &&
      !(
        isApprovedFcmIdRepair &&
        rule.reason === "CHANGE/MODIFY can rewrite existing column data"
      )
    ) {
      throw new Error(rule.reason);
    }
  }

  if (/\bCREATE\s+TABLE\b/i.test(scannableSql) && !/\bCREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\b/i.test(scannableSql)) {
    throw new Error("CREATE TABLE must use IF NOT EXISTS");
  }

  return statements[0];
}

module.exports = {
  splitSqlStatements,
  validateMigrationSql,
};
