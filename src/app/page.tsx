'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createRoom } from './lib/socket';
import { auth, signOut } from './lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';

export default function Home() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
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
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
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
      <main className="relative pt-32 pb-16 px-6 flex flex-col items-center justify-center min-h-screen z-10">
        
        <div className="max-w-3xl w-full text-center space-y-8">
          
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 text-xs font-semibold tracking-wide uppercase shadow-[0_0_15px_rgba(99,102,241,0.2)]">
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></span>
              Live Multiplayer
            </div>
            <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-white via-slate-200 to-slate-500">
              Forge Your Path to <br className="hidden md:block" /> Victory
            </h1>
            <p className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto leading-relaxed">
              Experience chess reimagined with powerful custom cards. Join the arena, cast spells, and outmaneuver your opponent in real-time.
            </p>
          </div>

          <div className="pt-8">
            <div className="mx-auto max-w-lg p-1.5 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md shadow-2xl flex flex-col sm:flex-row gap-2">
              <button
                onClick={onCreate}
                disabled={creating}
                className="flex-1 flex justify-center items-center gap-2 px-6 py-4 rounded-xl bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-400 hover:to-indigo-500 text-white font-semibold transition-all shadow-lg hover:shadow-indigo-500/25 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
              >
                {creating ? (
                  <span className="animate-pulse">Creating...</span>
                ) : (
                  <>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
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
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                {err}
              </div>
            )}
            
            {!user && !loadingUser && (
               <div className="mt-6 text-sm text-slate-500">
                 You must <button onClick={() => router.push('/login')} className="text-indigo-400 hover:text-indigo-300 underline underline-offset-4">sign in or play as guest</button> to create a room.
               </div>
            )}
          </div>

        </div>

      </main>
    </div>
  );
}
