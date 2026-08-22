import { RegexParser } from '../src/core/signal-engine/parser';

const parser = new RegexParser();
const msg = `‼️SIGNAL ALERT‼️

PAIR: BTCUSD
ORDER TYPE: BUY
ENTRY PRICE: 77000 - 76000

❌STOP LOSS: 75000

✅TAKE PROFIT 1:80000
✅TAKE PROFIT 2:83000

‼️Follow Risk Management rules‼️`;

console.log('canParse:', parser.canParse(msg));
console.log('parse:', JSON.stringify(parser.parse(msg), null, 2));
