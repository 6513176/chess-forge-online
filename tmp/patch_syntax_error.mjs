import fs from 'fs';

let lines = fs.readFileSync('src/app/room/[roomId]/page.tsx', 'utf8').split(/\r?\n/);
let modified = false;

// Delete lines starting when we see the duplicate confirmPendingTarget block, until we see the cancel button.
let inBadBlock = false;
let startIdx = -1;

for (let i = 0; i < lines.length; i++) {
  const t = lines[i];

  if (t.includes('SELECT TARGET') && lines[i+1]?.includes('</div>') && lines[i+2]?.includes(')}')) {
    // This is the GOOD block because t.btn is on the div above it.
  }

  // We are looking for the duplicated `<button` block
  if (t.includes('confirmPendingTarget();')) {
    // The <button> tag is a few lines above.
    // Let's just find the actual block by explicitly matching the line 1266 in view_file.
  }
}

// Let's do a strict string replacement!
let content = fs.readFileSync('src/app/room/[roomId]/page.tsx', 'utf8');

const badChunk = \`                          <button
                              onClick={(e) => {
                                e.stopPropagation();
                                confirmPendingTarget();
                              }}
                              className="w-full font-bold px-3 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-400 hover:from-emerald-400 hover:to-emerald-300 text-white shadow-[0_0_15px_rgba(16,185,129,0.4)] hover:scale-[1.02] transition-all animate-in fade-in zoom-in duration-200"
                            >
                              {Object.keys(pendingTarget.payload).length === 0 ? 'CONFIRM USE' : 'CONFIRM TARGET'}
                            </button>
                          ) : (
                            <div className="w-full text-center font-bold px-3 py-2 rounded-xl border-2 border-dashed border-indigo-500/50 bg-indigo-500/10 text-indigo-300 shadow-[0_0_10px_rgba(99,102,241,0.2)]">
                              SELECT TARGET
                            </div>
                          )}\`;

if (content.includes(badChunk)) {
  content = content.replace(badChunk, "");
  fs.writeFileSync('src/app/room/[roomId]/page.tsx', content, 'utf8');
  console.log("Successfully removed the duplicated bad chunk.");
} else {
  // Try regex
  const regex = /<button\\s*onClick={\\(e\\)\\s*=>\\s*\\{\\s*e\\.stopPropagation\\(\\);\\s*confirmPendingTarget\\(\\);\\s*\\}\\}[\\s\\S]*?SELECT TARGET\\s*<\\/div>\\s*\\)}\\n/g;
  const replaced = content.replace(regex, "");
  if (replaced !== content) {
    fs.writeFileSync('src/app/room/[roomId]/page.tsx', replaced, 'utf8');
    console.log("Successfully removed the duplicated bad chunk via regex.");
  } else {
    console.log("Could not find the duplicated chunk.");
  }
}
