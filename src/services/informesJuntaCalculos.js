// Small, non-executing evaluator for the arithmetic used by the supplied template.
// Unknown expressions keep their cache only when none of their references changed.
const ERR = value => ({ error: value });
const NA = ERR('#N/A');
const isError = value => value && typeof value === 'object' && typeof value.error === 'string';
const flat = value => Array.isArray(value) ? value.flat(Infinity) : [value];
const scalar = value => Array.isArray(value) ? value.flat(Infinity)[0] ?? 0 : value;
const number = value => { value = scalar(value); return isError(value) ? value : typeof value === 'number' ? value : value == null || value === '' ? 0 : ERR('#VALUE!'); };
const colNumber = value => [...value.replace(/\$/g, '').toUpperCase()].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0);
const colName = value => { let result = ''; while (value > 0) { value--; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26); } return result; };
const REF = /^(?:(?:'((?:[^']|'')+)'|([\p{L}_][\p{L}\p{N}_ .]*))!)?(\$?[A-Z]{1,3}\$?\d+)(?::(\$?[A-Z]{1,3}\$?\d+))?/u;
function reference(text, sheet) {
  const match = text.match(REF); if (!match) throw new Error('Referencia inválida');
  return { sheet: match[1]?.replace(/''/g, "'") || match[2] || sheet, from: match[3].replace(/\$/g, ''), to: match[4]?.replace(/\$/g, '') };
}
function tokenize(formula) {
  const tokens = []; let rest = formula.replace(/^=/, '');
  while (rest.length) {
    if (/^\s/.test(rest)) { rest = rest.trimStart(); continue; }
    const ref = rest.match(REF);
    if (ref && !/[\p{L}\p{N}_]/u.test(rest[ref[0].length] || '')) { tokens.push({ type: 'ref', value: ref[0] }); rest = rest.slice(ref[0].length); continue; }
    const literal = rest.match(/^"((?:[^"]|"")*)"/);
    if (literal) { tokens.push({ type: 'literal', value: literal[1].replace(/""/g, '"') }); rest = rest.slice(literal[0].length); continue; }
    const numeric = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?/);
    if (numeric) { tokens.push({ type: 'literal', value: Number(numeric[0]) }); rest = rest.slice(numeric[0].length); continue; }
    const name = rest.match(/^[A-Z_][A-Z0-9_.]*/i);
    if (name) { tokens.push({ type: 'name', value: name[0].toUpperCase() }); rest = rest.slice(name[0].length); continue; }
    const op = rest.match(/^(>=|<=|<>|[+\-*/^%=<>&(),;])/);
    if (!op) throw new Error('Expresión no soportada');
    tokens.push({ type: 'op', value: op[0] === ';' ? ',' : op[0] }); rest = rest.slice(op[0].length);
  }
  return tokens;
}
function parse(formula) {
  const tokens = tokenize(formula); let index = 0;
  const precedence = { '=': 1, '<>': 1, '>': 1, '<': 1, '>=': 1, '<=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 };
  function expression(min = 0) {
    const token = tokens[index++]; if (!token) throw new Error('Expresión incompleta');
    let node;
    if (token.type === 'literal' || token.type === 'ref') node = token;
    else if (['+', '-'].includes(token.value)) node = { type: 'unary', op: token.value, value: expression(6) };
    else if (token.value === '(') { node = expression(); if (tokens[index++]?.value !== ')') throw new Error('Paréntesis inválido'); }
    else if (token.type === 'name') {
      if (token.value === 'TRUE' || token.value === 'FALSE') node = { type: 'literal', value: token.value === 'TRUE' };
      else {
        if (tokens[index++]?.value !== '(') throw new Error('Nombre no soportado');
        const args = [];
        if (tokens[index]?.value !== ')') do { args.push(expression()); if (tokens[index]?.value !== ',') break; index++; } while (true);
        if (tokens[index++]?.value !== ')') throw new Error('Función inválida');
        node = { type: 'call', name: token.value, args };
      }
    } else throw new Error('Expresión inválida');
    while (index < tokens.length) {
      const next = tokens[index].value;
      if (next === '%') { index++; node = { type: 'binary', op: '/', left: node, right: { type: 'literal', value: 100 } }; continue; }
      if (!(next in precedence) || precedence[next] < min) break;
      index++; node = { type: 'binary', op: next, left: node, right: expression(precedence[next] + (next === '^' ? 0 : 1)) };
    }
    return node;
  }
  const result = expression(); if (index !== tokens.length) throw new Error('Expresión adicional'); return result;
}
function evaluate(node, read) {
  if (node.type === 'literal') return node.value;
  if (node.type === 'ref') return read(node.value);
  if (node.type === 'unary') { const value = number(evaluate(node.value, read)); return isError(value) ? value : node.op === '-' ? -value : value; }
  if (node.type === 'call') {
    if (node.name === 'IF') {
      const test = scalar(evaluate(node.args[0], read));
      return isError(test) ? test : evaluate(node.args[test ? 1 : 2] || { type: 'literal', value: false }, read);
    }
    const args = node.args.map(arg => evaluate(arg, read)), values = args.flat(Infinity);
    const error = values.find(isError); if (error) return error;
    if (node.name === 'SUM') return values.reduce((sum, value) => sum + (typeof value === 'number' ? value : 0), 0);
    if (node.name === 'AVERAGE') { const numbers = values.filter(v => typeof v === 'number'); return numbers.length ? numbers.reduce((a, b) => a + b, 0) / numbers.length : ERR('#DIV/0!'); }
    if (node.name === 'SUMPRODUCT') { const arrays = args.map(flat); if (arrays.some(a => a.length !== arrays[0].length)) return ERR('#VALUE!'); return arrays[0].reduce((sum, _, i) => sum + arrays.reduce((product, a) => product * (typeof a[i] === 'number' ? a[i] : 0), 1), 0); }
    throw new Error('Función no soportada');
  }
  let left = scalar(evaluate(node.left, read)), right = scalar(evaluate(node.right, read));
  if (isError(left) || isError(right)) return isError(left) ? left : right;
  if (['=', '<>', '>', '<', '>=', '<='].includes(node.op)) {
    return { '=': () => left === right, '<>': () => left !== right, '>': () => left > right, '<': () => left < right, '>=': () => left >= right, '<=': () => left <= right }[node.op]();
  }
  if (node.op === '&') return String(left ?? '') + String(right ?? '');
  left = number(left); right = number(right); if (isError(left) || isError(right)) return isError(left) ? left : right;
  if (node.op === '/' && right === 0) return ERR('#DIV/0!');
  const value = { '+': () => left + right, '-': () => left - right, '*': () => left * right, '/': () => left / right, '^': () => left ** right }[node.op]();
  return Number.isFinite(value) ? value : ERR('#NUM!');
}
function createModel(book, overrides = new Map()) {
  const cache = new Map(), active = new Set(), ast = new Map();
  const key = (sheet, address) => `${sheet}!${address}`;
  const original = (sheet, address) => {
    const cell = book.getWorksheet(sheet)?.getCell(address); if (!cell) return null;
    if (cell.isMerged && cell.master.address !== cell.address) return null;
    const value = cell.value;
    return cell.formula ? value?.result ?? null : value?.richText ? value.richText.map(v => v.text).join('') : value?.text ?? value;
  };
  function get(sheet, address) {
    address = address.replace(/\$/g, ''); const id = key(sheet, address);
    if (cache.has(id)) return cache.get(id);
    if (overrides.has(id)) { const result = { value: overrides.get(id), touched: true }; cache.set(id, result); return result; }
    if (active.has(id)) return { value: NA, touched: false };
    const cell = book.getWorksheet(sheet)?.getCell(address), formula = cell?.isMerged && cell.master.address !== cell.address ? null : cell?.formula;
    if (!formula) { const result = { value: original(sheet, address), touched: false }; cache.set(id, result); return result; }
    active.add(id); let touched = false;
    function read(text) {
      const ref = reference(text, sheet);
      if (!ref.to) { const result = get(ref.sheet, ref.from); touched ||= result.touched; return result.value; }
      const from = ref.from.match(/([A-Z]+)(\d+)/), to = ref.to.match(/([A-Z]+)(\d+)/), values = [];
      if ((Number(to[2]) - Number(from[2]) + 1) * (colNumber(to[1]) - colNumber(from[1]) + 1) > 30000) throw new Error('Rango demasiado grande');
      for (let r = Number(from[2]); r <= Number(to[2]); r++) for (let c = colNumber(from[1]); c <= colNumber(to[1]); c++) { const result = get(ref.sheet, colName(c) + r); touched ||= result.touched; values.push(result.value); }
      return values;
    }
    let value;
    try { if (!ast.has(formula)) ast.set(formula, parse(formula)); value = evaluate(ast.get(formula), read); }
    catch (_) {
      const refs = formula.match(/(?:'(?:[^']|'')+'!|[\p{L}_][\p{L}\p{N}_ .]*!)?\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?/gu) || [];
      for (const ref of refs) { try { read(ref); } catch (_) { /* An unchanged unsupported formula retains its original cache. */ } }
      value = touched ? NA : original(sheet, address);
    }
    active.delete(id);
    const result = { value: touched ? value : original(sheet, address), touched }; cache.set(id, result); return result;
  }
  return { book, overrides, get, original, entries() {
    const result = [];
    for (const sheet of book.worksheets) sheet.eachRow(row => row.eachCell(cell => { if (cell.isMerged && cell.master.address !== cell.address) return; const value = get(sheet.name, cell.address); if (value.touched) result.push({ sheet: sheet.name, address: cell.address, ...value }); }));
    for (const [id, value] of overrides) {
      const split = id.lastIndexOf('!'), sheet = id.slice(0, split), address = id.slice(split + 1);
      if (!result.some(item => item.sheet === sheet && item.address === address)) result.push({ sheet, address, value, touched: true });
    }
    return result;
  } };
}
module.exports = { createModel, parse, NA, isError, colName };
