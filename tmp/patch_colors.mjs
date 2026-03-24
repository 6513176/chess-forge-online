import fs from 'fs';

let content = fs.readFileSync('src/app/room/[roomId]/page.tsx', 'utf8');

const regex = /(\s*\{hand\.map\(\(c\)\s*=>\s*\{[\s\S]*?const\s+playable\s*=\s*[^;]+;[\s\S]*?const\s+isLocked\s*=\s*lockedCardId\s*===\s*c\.uid;)([\s\S]*?)(<button)/;

const replacement = `$1
              let tKey = 'indigo';
              if (['BUFF_EXTRA_MOVE', 'BUFF_PAWN_RANGE', 'AOE_BLAST'].includes(c.id)) tKey = 'rose';
              else if (['DEF_SHIELD', 'DEF_SAFE_ZONE', 'CLEANSE_BUFFS'].includes(c.id)) tKey = 'sky';
              else if (['COUNTER_SACRIFICE', 'BUFF_SWAP_ALLY', 'BUFF_SUMMON_PAWN'].includes(c.id)) tKey = 'amber';

              const themes: Record<string, any> = {
                rose: {
                  border: 'border-rose-500/60', hoverBorder: 'hover:border-rose-400', activeBorder: 'border-2 border-rose-500',
                  shadow: 'shadow-[0_30px_60px_-15px_rgba(244,63,94,0.6)]', hoverShadow: 'hover:shadow-[0_20px_40px_-15px_rgba(244,63,94,0.5)]',
                  gradient: 'from-rose-950/90 via-black/40 to-black/90',
                  btn: 'border-rose-500/50 bg-rose-500/10 text-rose-300 shadow-[0_0_10px_rgba(244,63,94,0.2)]'
                },
                sky: {
                  border: 'border-sky-500/60', hoverBorder: 'hover:border-sky-400', activeBorder: 'border-2 border-sky-500',
                  shadow: 'shadow-[0_30px_60px_-15px_rgba(14,165,233,0.6)]', hoverShadow: 'hover:shadow-[0_20px_40px_-15px_rgba(14,165,233,0.5)]',
                  gradient: 'from-sky-950/90 via-black/40 to-black/90',
                  btn: 'border-sky-500/50 bg-sky-500/10 text-sky-300 shadow-[0_0_10px_rgba(14,165,233,0.2)]'
                },
                amber: {
                  border: 'border-amber-500/60', hoverBorder: 'hover:border-amber-400', activeBorder: 'border-2 border-amber-500',
                  shadow: 'shadow-[0_30px_60px_-15px_rgba(245,158,11,0.6)]', hoverShadow: 'hover:shadow-[0_20px_40px_-15px_rgba(245,158,11,0.5)]',
                  gradient: 'from-amber-950/90 via-black/40 to-black/90',
                  btn: 'border-amber-500/50 bg-amber-500/10 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.2)]'
                },
                indigo: {
                  border: 'border-indigo-500/40', hoverBorder: 'hover:border-indigo-400', activeBorder: 'border-2 border-indigo-400',
                  shadow: 'shadow-[0_30px_60px_-15px_rgba(99,102,241,0.6)]', hoverShadow: 'hover:shadow-[0_20px_40px_-15px_rgba(99,102,241,0.5)]',
                  gradient: 'from-black/90 via-black/20 to-black/90',
                  btn: 'border-indigo-500/50 bg-indigo-500/10 text-indigo-300 shadow-[0_0_10px_rgba(99,102,241,0.2)]'
                }
              };
              const t = themes[tKey];

              return (
                <div 
                  key={c.uid} 
                  onClick={() => { 
                    if (playable && lockedCardId !== c.uid) {
                      setLockedCardId(c.uid);
                      playCard(c);
                    }
                  }}
                  className={\`relative shrink-0 rounded-2xl overflow-hidden shadow-2xl transition-all duration-300 snap-center
                    \${isLocked 
                      ? \`w-40 h-56 sm:w-48 sm:h-72 md:w-56 md:h-80 z-50 -translate-y-4 md:-translate-y-6 \${t.shadow} \${t.activeBorder} scale-105 mx-1 md:mx-2\` 
                      : \`w-28 h-40 sm:w-36 sm:h-52 md:w-44 md:h-64 \${playable ? \`cursor-pointer hover:-translate-y-2 md:hover:-translate-y-4 \${t.hoverShadow} border \${t.border} \${t.hoverBorder}\` : 'cursor-not-allowed opacity-60 grayscale-[50%] border border-gray-700'}\`
                    }
                    group bg-gray-900 flex flex-col justify-between
                  \`}
                >
                  <img 
                    src={\`/cards/\${c.id}.png\`} 
                    alt={c.name}
                    className="absolute inset-0 w-full h-full object-cover z-0 transition-transform duration-500 group-hover:scale-110"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                  
                  <div className={\`absolute inset-0 bg-gradient-to-b \${t.gradient} z-10 pointer-events-none\`} />

                  <div className="relative z-20 p-4 flex flex-col h-full justify-between pointer-events-none">
                    <div>
                      <div className="font-extrabold text-sm sm:text-base md:text-xl text-white tracking-wide uppercase drop-shadow-md" style={{textShadow: "0 2px 4px rgba(0,0,0,0.8)"}}>{c.name}</div>
                      
                      <div className={\`text-[10px] sm:text-xs text-slate-200 mt-1 md:mt-2 font-medium leading-relaxed md:leading-relaxed drop-shadow-md bg-black/50 p-1.5 md:p-2.5 rounded-lg backdrop-blur-md border border-white/10 transition-opacity duration-300 \${isLocked ? 'opacity-100' : 'opacity-0 hidden'}\`} style={{textShadow: "0 1px 2px rgba(0,0,0,0.8)"}}>
                        {c.desc}
                      </div>
                    </div>

                    <div className="mt-auto pointer-events-auto">
                      {isLocked ? (
                        <div className="flex flex-col gap-2">
                          {pendingTarget ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                confirmPendingTarget();
                              }}
                              className="w-full font-bold px-3 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-400 hover:from-emerald-400 hover:to-emerald-300 text-white shadow-[0_0_15px_rgba(16,185,129,0.4)] hover:scale-[1.02] transition-all animate-in fade-in zoom-in duration-200"
                            >
                              {Object.keys(pendingTarget.payload).length === 0 ? 'CONFIRM USE' : 'CONFIRM TARGET'}
                            </button>
                          ) : (
                            <div className={\`w-full text-center font-bold px-3 py-2 rounded-xl border-2 border-dashed \${t.btn}\`}>
                              SELECT TARGET
                            </div>
                          )}
                          $3`;

content = content.replace(regex, replacement);
fs.writeFileSync('src/app/room/[roomId]/page.tsx', content, 'utf8');
console.log('Successfully patched page.tsx to apply colors');
