'use client';

interface RulesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function RulesModal({ isOpen, onClose }: RulesModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-indigo-500/30 rounded-2xl p-6 sm:p-8 max-w-2xl w-full shadow-2xl relative overflow-hidden">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-full hover:bg-white/10 transition-colors"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>

        <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
          <span className="text-indigo-400"></span> Rules of Chess Forge
        </h2>

        <div className="space-y-6 text-slate-300 text-sm sm:text-base max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-indigo-300">Core Gameplay</h3>
            <p>Chess Forge plays like standard chess, but with a twist: each player drafts and plays magical cards that bend the rules of the game.</p>
            <ul className="list-disc pl-5 space-y-1 text-slate-400">
              <li>You can get a card by capturing every 2 pieces.</li>
              <li>7 minute playtime.</li>
              <li>Standard chess movement and capture rules apply.</li>
              <li>Checkmate to win the game.</li>
            </ul>
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-rose-400">Playing Cards</h3>
            <p>You can play <strong className="text-white">ONE card per turn</strong>.</p>
            <ul className="list-disc pl-5 space-y-1 text-slate-400">
              <li>Click a card in your hand to select it, pick a target on the board if required, and click <strong className="text-emerald-400">CONFIRM</strong>.</li>
              <li>Playing a card does <strong className="underline text-white">not</strong> consume your piece movement turn (unless the card specifically says it ends your turn).</li>
            </ul>
          </div>

          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-amber-400">Card Archetypes</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="bg-white/5 border border-rose-500/20 p-3 rounded-xl">
                <span className="font-bold text-rose-400 block mb-1">Red (Attack)</span>
                <span className="text-xs text-slate-400 block mb-1"><strong>Forge:</strong> Activate before moving to sprint 2 times in one turn (can capture both times).</span>
                <span className="text-xs text-slate-400 block"><strong>RNG Blast:</strong> Destroy a random piece in 3x3 area. Delay 1 turn.</span>
              </div>
              <div className="bg-white/5 border border-sky-500/20 p-3 rounded-xl">
                <span className="font-bold text-sky-400 block mb-1">Blue (Defense)</span>
                <span className="text-xs text-slate-400 block mb-1"><strong>Shield:</strong> Protects a piece for 1 turn.</span>
                <span className="text-xs text-slate-400 block mb-1"><strong>Shield Aura:</strong> 3x3 immunity area for 1 turn.</span>
                <span className="text-xs text-slate-400 block"><strong>Cleanse:</strong> Removes all buffs/debuffs from board.</span>
              </div>
              <div className="bg-white/5 border border-amber-500/20 p-3 rounded-xl sm:col-span-2">
                <span className="font-bold text-amber-400 block mb-1">Yellow (Special)</span>
                <span className="text-xs text-slate-400 block mb-1"><strong>Sacrifice:</strong> Revive a piece at the cost of another.</span>
                <span className="text-xs text-slate-400 block mb-1"><strong>Swap:</strong> Swap two of your pieces.</span>
                <span className="text-xs text-slate-400 block"><strong>Summon:</strong> Spawn a Pawn on rank 2(W) / 7(B).</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 pt-4 border-t border-white/5 text-center">
          <button
            onClick={onClose}
            className="px-8 py-2.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl font-medium transition-all shadow-lg hover:shadow-indigo-500/25"
          >
            Let's Play!
          </button>
        </div>
      </div>
    </div>
  );
}
