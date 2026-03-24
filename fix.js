const fs = require('fs');
let s = fs.readFileSync('server.js', 'utf8');
s = s.replace(/        userId, \r?\n        timeLeft, /g, '        userId, \n        email,\n        timeLeft, ');
s = s.replace(/const payload = {\r?\n        roomId,\r?\n        enemyUserId,\r?\n        userId:/g, 'const payload = {\n        roomId,\n        email,\n        userId:');
fs.writeFileSync('server.js', s);

let p = fs.readFileSync('src/app/room/[roomId]/page.tsx', 'utf8');
p = p.replace(/userId: uid,\r?\n            timeLeft: timeL,/g, 'userId: uid,\n            email: user?.email || null,\n            timeLeft: timeL,');
fs.writeFileSync('src/app/room/[roomId]/page.tsx', p);
console.log('done');
