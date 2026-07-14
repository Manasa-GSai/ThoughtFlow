const fs = require('fs');
const path = require('path');

const buf = Buffer.alloc(1024);
buf.write('RIFF', 0);
buf.writeUInt32LE(1016, 4);
buf.write('WAVE', 8);
buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(1, 22);
buf.writeUInt32LE(16000, 24);
buf.writeUInt32LE(32000, 28);
buf.writeUInt16LE(2, 32);
buf.writeUInt16LE(16, 34);
buf.write('data', 36);
buf.writeUInt32LE(980, 40);

fs.writeFileSync(path.join(__dirname, 'sample.wav'), buf);
console.log('Created sample.wav');
