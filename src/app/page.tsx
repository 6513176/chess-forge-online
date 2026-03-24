'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createRoom } from './lib/socket';
import { auth, signOut } from './lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';

export default function Home() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [joinId, setJoinId] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoadingUser(false);
    });
    return () => unsub();
  }, []);

  async function onCreate() {
    if (!user) {
      router.push('/login');
      return;
    }
    setCreating(true);
    setErr(null);
    try {
      const { roomId } = await createRoom();
      router.push(`/room/${roomId}`);
    } catch (e: any) {
      setErr('Failed to create room. Please try again.');
    } finally {
      setCreating(false);
    }
  }

  function onJoin() {
    const id = joinId.trim();
    if (!id) return setErr('Please enter a Room ID');
    if (!user) {
      router.push(`/room/${id}`); // Let the room guard handle the redirect and ?redirect back to play
      return;
    }
    router.push(`/room/${id}`);
  }

  return (
    <div
      className="relative min-h-screen bg-[#030712] text-slate-200 overflow-hidden font-sans selection:bg-indigo-500/30 bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: "url('/bg.png')" }}
    >
      {/* Background Overlay */}
      <div className="absolute inset-0 bg-black/70 pointer-events-none z-0" />

      {/* Background Orbs & Effects */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/20 blur-[120px] rounded-full mix-blend-screen pointer-events-none z-0" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-600/20 blur-[120px] rounded-full mix-blend-screen pointer-events-none z-0" />

      {/* Navigation Bar */}
      <nav className="fixed top-0 w-full z-50 border-b border-white/5 bg-black/20 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Chess Forge Logo" className="w-10 h-10 object-contain drop-shadow-md" />
            <span className="font-bold text-xl tracking-tight text-white drop-shadow-sm">ChessForge</span>
          </div>

          <div className="flex items-center gap-4 text-sm">
            {loadingUser ? (
              <div className="w-24 h-5 animate-pulse bg-white/10 rounded-md" />
            ) : user ? (
              <div className="flex items-center gap-4">
                <span className="text-slate-400 font-medium hidden sm:inline-block">
                  {user.isAnonymous ? 'Guest Player' : user.displayName || user.email?.split('@')[0]}
                </span>
                <button
                  onClick={() => signOut(auth)}
                  className="px-4 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition-colors text-slate-300"
                >
                  Logout
                </button>
              </div>
            ) : (
              <button
                onClick={() => router.push('/login')}
                className="px-5 py-2 rounded-full bg-indigo-500 hover:bg-indigo-600 text-white font-medium transition-colors shadow-lg shadow-indigo-500/25"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* Main Hero Content */}
      <main className="relative pt-32 pb-16 px-4 sm:px-6 flex flex-col items-center justify-center min-h-screen z-10">

        <div className="max-w-3xl w-full text-center space-y-8">

          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 text-xs font-semibold tracking-wide uppercase shadow-[0_0_15px_rgba(99,102,241,0.2)]">
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></span>
              Live Multiplayer
            </div>
            <h1 className="text-4xl sm:text-5xl md:text-7xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-white via-slate-200 to-slate-500">
              CHESS <br className="hidden md:block" /> FORGE
            </h1>
          </div>

          <div className="pt-8">
            <div className="mx-auto max-w-lg p-1.5 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md shadow-2xl flex flex-col sm:flex-row gap-2">
              <button
                onClick={onCreate}
                disabled={creating}
                className="flex-shrink-0 flex justify-center items-center gap-2 px-4 sm:px-6 py-3 sm:py-4 rounded-xl bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-400 hover:to-indigo-500 text-white font-semibold transition-all shadow-lg hover:shadow-indigo-500/25 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
              >
                {creating ? (
                  <span className="animate-pulse">Creating...</span>
                ) : (
                  <>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
                    Create Room
                  </>
                )}
              </button>

              <div className="flex-1 flex bg-black/40 rounded-xl focus-within:ring-2 ring-indigo-500/50 transition-all overflow-hidden border border-white/5">
                <input
                  value={joinId}
                  onChange={(e) => setJoinId(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && onJoin()}
                  placeholder="Room Code..."
                  className="w-full bg-transparent px-4 py-4 text-white outline-none placeholder:text-slate-500 font-mono"
                />
                <button
                  onClick={onJoin}
                  className="px-5 bg-white/5 hover:bg-white/10 border-l border-white/5 transition-colors font-medium text-slate-300 hover:text-white"
                >
                  Join
                </button>
              </div>
            </div>

            {err && (
              <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                {err}
              </div>
            )}

            {!user && !loadingUser && (
              <div className="mt-6 text-sm text-slate-500">
                You must <button onClick={() => router.push('/login')} className="text-indigo-400 hover:text-indigo-300 underline underline-offset-4">sign in</button> to create a room.
              </div>
            )}

            <div className="mt-8">
              <button
                onClick={() => setShowRules(true)}
                className="px-6 py-2 rounded-full border border-slate-500/30 text-slate-300 hover:text-white hover:bg-white/5 hover:border-slate-500/50 transition-all text-sm font-medium tracking-wide"
              >
                How to Play & Rules
              </button>
            </div>
          </div>

        </div>

      </main>

      {showRules && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-indigo-500/30 rounded-2xl p-6 sm:p-8 max-w-2xl w-full shadow-2xl relative overflow-hidden">
            <button
              onClick={() => setShowRules(false)}
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
                    <span className="font-bold text-rose-400 block mb-1">Red (Aggression)</span>
                    <span className="text-xs text-slate-400 block">Hit & Run: Move twice (cannot capture on 2nd step).</span>
                    <span className="text-xs text-slate-400 block">Forge: Gain an extra turn (cannot capture King).</span>
                    <span className="text-xs text-slate-400 block">AOE: Explodes a 3x3 area after 1 turn.</span>
                  </div>
                  <div className="bg-white/5 border border-sky-500/20 p-3 rounded-xl">
                    <span className="font-bold text-sky-400 block mb-1">Blue (Defense)</span>
                    <span className="text-xs text-slate-400 block">Shield: Protects a 3x3 area. Safe Zone: 3x3 immunity area.</span>
                    <span className="text-xs text-slate-400 block">Cleanse: Removes all buffs/debuffs from board.</span>
                  </div>
                  <div className="bg-white/5 border border-amber-500/20 p-3 rounded-xl sm:col-span-2">
                    <span className="font-bold text-amber-400 block mb-1">Yellow (Utility)</span>
                    <span className="text-xs text-slate-400 block">Counter Sacrifice: Revive a piece at the cost of another. Swap: Swap two of your pieces. Summon: Spawn a Pawn.</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 pt-4 border-t border-white/5 text-center">
              <button
                onClick={() => setShowRules(false)}
                className="px-8 py-2.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl font-medium transition-all shadow-lg hover:shadow-indigo-500/25"
              >
                Let's Play!
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
