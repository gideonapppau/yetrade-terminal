const msg = `🔥 NEW SIGNAL 🔥
Symbol: XAUUSD
Action: BUY
Entry: 1500.00
SL: 1490.00
TP1: 1520.00

Use proper risk management!`;

const upperMsg = msg.toUpperCase();

const pairMatch = upperMsg.match(/(?:PAIR|SYMBOL):\s*([A-Z0-9]+)[\s\S]*?(?:ORDER TYPE|DIRECTION|ACTION):\s*(BUY|SELL)/);
console.log('pairMatch:', pairMatch ? [pairMatch[1], pairMatch[2]] : null);

const entryMatch = upperMsg.match(/ENTRY(?: PRICE)?:\s*([\d.]+)/);
console.log('entryMatch:', entryMatch ? entryMatch[1] : null);

const slMatch = upperMsg.match(/(?:STOP\s*LOSS|SL)[\s:]*([\d.]+)/);
console.log('slMatch:', slMatch ? slMatch[1] : null);

const takeProfits = [];
const tpRegex = /(?:TAKE\s*PROFIT|TP)[\s\d]*:\s*([\d.]+)/g;
let tpMatch;
while ((tpMatch = tpRegex.exec(upperMsg)) !== null) {
  takeProfits.push(parseFloat(tpMatch[1]));
}
console.log('takeProfits:', takeProfits);
