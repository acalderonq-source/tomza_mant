// Calculadora de las fórmulas que usan las capturas: referencias (también a otros
// libros), rangos, SUM y aritmética básica. Si aparece algo distinto se informa
// como error en lugar de inventar un resultado.
const { colNumber, addrOf } = require('./xlsxLibro');

const isError = v => v !== null && typeof v === 'object' && 'error' in v;
const ERR = code => ({ error: code });

function tokenize(text) {
  const tokens = [];
  let i = 0;
  const s = text.trim().replace(/^=/, '');
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    // Prefijo de hoja: 'Hoja'! , [1]Hoja! , Hoja!
    let m = /^(?:'((?:[^']|'')+)'|(\[\d+\][^!'(),+\-*/^&=<>\s:]*|[A-Za-z_][\w.]*))!/.exec(s.slice(i));
    let sheet = null;
    let start = i;
    if (m) { sheet = (m[1] ?? m[2]).replace(/''/g, "'"); i += m[0].length; }
    m = /^\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?(?![\w(])/.exec(s.slice(i));
    if (m) {
      tokens.push({ type: 'ref', sheet, c1: colNumber(m[1]), r1: +m[2], c2: m[3] ? colNumber(m[3]) : null, r2: m[4] ? +m[4] : null });
      i += m[0].length; continue;
    }
    if (sheet !== null) { if (/^#REF!/.test(s.slice(i))) { tokens.push({ type: 'error', value: '#REF!' }); i += 5; continue; } throw new Error(`Referencia no soportada: ${s.slice(start, start + 30)}`); }
    m = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|^\.\d+/.exec(s.slice(i));
    if (m) { tokens.push({ type: 'num', value: Number(m[0]) }); i += m[0].length; continue; }
    m = /^#(?:REF!|DIV\/0!|VALUE!|N\/A|NAME\?|NUM!|NULL!)/.exec(s.slice(i));
    if (m) { tokens.push({ type: 'error', value: m[0] }); i += m[0].length; continue; }
    m = /^"((?:[^"]|"")*)"/.exec(s.slice(i));
    if (m) { tokens.push({ type: 'str', value: m[1].replace(/""/g, '"') }); i += m[0].length; continue; }
    m = /^([A-Z][A-Z0-9.]*)\(/.exec(s.slice(i));
    if (m) { tokens.push({ type: 'func', name: m[1] }); i += m[0].length; continue; }
    if ('+-*/^(),&'.includes(ch)) { tokens.push({ type: 'op', value: ch }); i++; continue; }
    throw new Error(`Símbolo no soportado en fórmula: ${s.slice(i, i + 20)}`);
  }
  return tokens;
}

function parse(text) {
  const tokens = tokenize(text);
  let p = 0;
  const peek = () => tokens[p];
  const take = () => tokens[p++];
  const isOp = v => peek()?.type === 'op' && peek().value === v;
  function primary() {
    const t = take();
    if (!t) throw new Error('Fórmula incompleta');
    if (t.type === 'num' || t.type === 'str') return { k: 'lit', v: t.value };
    if (t.type === 'error') return { k: 'lit', v: ERR(t.value) };
    if (t.type === 'ref') return { k: 'ref', ...t };
    if (t.type === 'func') {
      const args = [];
      if (!isOp(')')) { do { args.push(expr()); } while (isOp(',') && take()); }
      if (!isOp(')')) throw new Error('Falta cerrar paréntesis'); take();
      return { k: 'func', name: t.name, args };
    }
    if (t.type === 'op' && t.value === '(') { const e = expr(); if (!isOp(')')) throw new Error('Falta cerrar paréntesis'); take(); return e; }
    if (t.type === 'op' && (t.value === '+' || t.value === '-')) return { k: 'unary', op: t.value, e: power() };
    throw new Error(`Token inesperado ${JSON.stringify(t)}`);
  }
  function power() { let l = primary(); while (isOp('^')) { take(); l = { k: 'bin', op: '^', l, r: primary() }; } return l; }
  function term() { let l = power(); while (isOp('*') || isOp('/')) { const op = take().value; l = { k: 'bin', op, l, r: power() }; } return l; }
  function sum() { let l = term(); while (isOp('+') || isOp('-')) { const op = take().value; l = { k: 'bin', op, l, r: term() }; } return l; }
  function expr() { let l = sum(); while (isOp('&')) { take(); l = { k: 'bin', op: '&', l, r: sum() }; } return l; }
  const ast = expr();
  if (p !== tokens.length) throw new Error('Sobran símbolos en la fórmula');
  return ast;
}

const toNumber = v => {
  if (isError(v)) return v;
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(String(v).trim());
  return Number.isFinite(n) && String(v).trim() !== '' ? n : ERR('#VALUE!');
};

// books: Map nombreArchivo -> libro (xlsxLibro). Devuelve una función value(book, sheet, addr).
function createEngine(books) {
  const cache = new Map();
  const busy = new Set();
  const asts = new Map();
  const problems = [];
  const byFile = new Map([...books.values()].map(b => [b.name.toLowerCase(), b]));

  function resolveSheet(book, prefix) {
    if (prefix === null) return { book, sheetName: null };
    const ext = /^\[(\d+)\](.*)$/.exec(prefix);
    if (!ext) return { book, sheetName: prefix };
    const link = book.externals.find(e => e.index === +ext[1]);
    const target = link && byFile.get(link.file.toLowerCase());
    return { book: target || null, sheetName: ext[2], link };
  }

  // Libro vinculado que no está en el juego: Excel conserva sus últimos valores.
  function cachedValues(link, sheetName, node) {
    if (!link) return [ERR('#REF!')];
    const [r1, r2] = node.c2 === null ? [node.r1, node.r1] : [Math.min(node.r1, node.r2), Math.max(node.r1, node.r2)];
    const [c1, c2] = node.c2 === null ? [node.c1, node.c1] : [Math.min(node.c1, node.c2), Math.max(node.c1, node.c2)];
    if (node.c2 === null) return [link.cache.get(`${sheetName}|${addrOf(r1, c1)}`) ?? null];
    const out = [];
    for (const [key, v] of link.cache) {
      const [name, addr] = key.split('|');
      const m = /^([A-Z]+)(\d+)$/.exec(addr); const c = colNumber(m[1]), r = +m[2];
      if (name === sheetName && r >= r1 && r <= r2 && c >= c1 && c <= c2) out.push(v);
    }
    return out;
  }

  function value(book, sheetName, addr) {
    const key = `${book.name}|${sheetName}|${addr}`;
    if (cache.has(key)) return cache.get(key);
    const sheet = book.sheet(sheetName);
    if (!sheet) return ERR('#REF!');
    if (sheet.changes.has(addr) && !sheet.cells.get(addr)?.formula) return sheet.changes.get(addr).value;
    const cell = sheet.cells.get(addr);
    if (!cell) return null;
    if (!cell.formula) return cell.value;
    if (busy.has(key)) return cell.value; // referencia circular: se respeta el valor guardado
    busy.add(key);
    let result;
    try {
      let ast = asts.get(cell.formula);
      if (!ast) { ast = parse(cell.formula); asts.set(cell.formula, ast); }
      result = evaluate(ast, book, sheetName);
      if (result === null || result === undefined) result = 0;
    } catch (error) {
      problems.push(`${book.name} ${sheetName}!${addr}: ${error.message}`);
      result = cell.value;
    } finally { busy.delete(key); }
    cache.set(key, result);
    return result;
  }

  function refValues(node, book, sheetName) {
    const where = resolveSheet(book, node.sheet);
    if (!where.book) return cachedValues(where.link, where.sheetName, node);
    const target = where.sheetName ?? sheetName;
    const sheet = where.book.sheet(target);
    if (!sheet) return [ERR('#REF!')];
    if (node.c2 === null) return [value(where.book, target, addrOf(node.r1, node.c1))];
    const out = [];
    const [r1, r2] = [Math.min(node.r1, node.r2), Math.max(node.r1, node.r2)];
    const [c1, c2] = [Math.min(node.c1, node.c2), Math.max(node.c1, node.c2)];
    for (const cell of sheet.cells.values()) if (cell.r >= r1 && cell.r <= r2 && cell.c >= c1 && cell.c <= c2) out.push(value(where.book, target, cell.addr));
    for (const addr of sheet.changes.keys()) if (!sheet.cells.has(addr)) {
      const m = /^([A-Z]+)(\d+)$/.exec(addr); const c = colNumber(m[1]), r = +m[2];
      if (r >= r1 && r <= r2 && c >= c1 && c <= c2) out.push(value(where.book, target, addr));
    }
    return out;
  }

  function evaluate(node, book, sheetName) {
    switch (node.k) {
      case 'lit': return node.v;
      case 'ref': {
        if (node.c2 !== null) return ERR('#VALUE!');
        return refValues(node, book, sheetName)[0];
      }
      case 'unary': {
        const v = evaluate(node.e, book, sheetName);
        if (node.op === '+') return v === null ? 0 : v;
        const n = toNumber(v); return isError(n) ? n : -n;
      }
      case 'bin': {
        const a = evaluate(node.l, book, sheetName), b = evaluate(node.r, book, sheetName);
        if (node.op === '&') return isError(a) ? a : isError(b) ? b : `${a ?? ''}${b ?? ''}`;
        const x = toNumber(a), y = toNumber(b);
        if (isError(x)) return x; if (isError(y)) return y;
        if (node.op === '+') return x + y;
        if (node.op === '-') return x - y;
        if (node.op === '*') return x * y;
        if (node.op === '/') return y === 0 ? ERR('#DIV/0!') : x / y;
        return x ** y;
      }
      case 'func': {
        if (node.name !== 'SUM') throw new Error(`Función no soportada: ${node.name}`);
        let total = 0;
        for (const arg of node.args) {
          const values = arg.k === 'ref' ? refValues(arg, book, sheetName) : [evaluate(arg, book, sheetName)];
          for (const v of values) {
            if (isError(v)) return v;
            if (typeof v === 'number') total += v;
            else if (arg.k !== 'ref') { const n = toNumber(v); if (isError(n)) return n; total += n; }
          }
        }
        return total;
      }
      default: throw new Error('Nodo desconocido');
    }
  }

  return { value, problems };
}

module.exports = { createEngine, parse, tokenize, isError };
