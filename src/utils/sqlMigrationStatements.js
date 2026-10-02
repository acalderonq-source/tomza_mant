const IGNORABLE_CODES = new Set([
  "ER_DUP_FIELDNAME",
  "ER_DUP_KEYNAME",
  "ER_TABLE_EXISTS_ERROR"
]);

function splitTopLevelCommas(value) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        if (value[index + 1] === quote) {
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth = Math.max(0, depth - 1);
    } else if (character === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }

  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function splitAlterTableStatement(statement) {
  const match = statement.match(/^(\s*ALTER\s+TABLE\s+(?:`(?:``|[^`])+`|[^\s]+))\s+([\s\S]+)$/i);
  if (!match) return [statement];

  const actions = splitTopLevelCommas(match[2]);
  if (actions.length <= 1) return [statement];
  return actions.map(action => `${match[1]} ${action}`);
}

async function executeMigrationStatement(query, statement) {
  for (const action of splitAlterTableStatement(statement)) {
    try {
      await query(action);
    } catch (error) {
      if (!IGNORABLE_CODES.has(error.code)) throw error;
    }
  }
}

module.exports = { splitAlterTableStatement, executeMigrationStatement };
