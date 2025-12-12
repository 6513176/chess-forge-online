'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createRoom } from './lib/socket';

type User = { id: string; email: string; name: string } | null;

export default function Home() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [joinId, setJoinId] = useState('');
  const [user, setUser] = useState<User>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // ตรวจ session เบื้องต้น (mock / ถ้าต่อ backend: /api/me)
    (async () => {
      try {
        const r = await fetch('http://localhost:3001/api/me', {
          credentials: 'include',
        });
        const j = await r.json();
        if (j?.ok && j.user) setUser(j.user);
      } catch (e) {
        // ignore
      } finally {
        setLoadingUser(false);
      }
    })();
  }, []);

  async function onCreate() {
    setCreating(true);
    setErr(null);
    try {
      const { roomId } = await createRoom();
      router.push(`/room/${roomId}`);
    } catch (e: any) {
      setErr('สร้างห้องไม่สำเร็จ ลองใหม่อีกครั้ง');
    } finally {
      setCreating(false);
    }
  }

  function onJoin() {
    const id = joinId.trim();
    if (!id) return setErr('กรุณากรอก Room ID');
    router.push(`/room/${id}`);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#061021] via-[#071427] to-[#02060b] text-white p-6 flex items-center justify-center">
      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* LEFT: Hero */}
        <div className="bg-[linear-gradient(135deg,#0b1221cc,_#071022d9)] border border-gray-800 rounded-2xl p-8 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-indigo-500 to-emerald-400 flex items-center justify-center shadow-lg">
                {/* Knight svg */}
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M6 13c0-2.5 2-4 4-4s4-1.5 4-4 3-4 3-4l-2 6-2 5-5 6H6v-9z" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight">ChessForge</h1>
                <p className="text-sm text-gray-300">เกมหมากรุกผสมการ์ด — เล่นกับเพื่อนแบบเรียลไทม์</p>
              </div>
            </div>

            <h2 className="mt-8 text-3xl font-bold leading-tight">สร้างห้อง</h2>
            <p className="mt-3 text-gray-300">เริ่มเกมได้ทันที — สมัครบัญชีเพื่อบันทึกชื่อผู้เล่นและประวัติการเล่น</p>

            <div className="mt-6 flex flex-col sm:flex-row gap-3 sm:items-center">
              <button
                onClick={onCreate}
                disabled={creating}
                className="px-5 py-3 rounded-xl bg-indigo-500 hover:bg-indigo-600 transition font-semibold shadow"
              >
                {creating ? 'Creating…' : 'Create Room'}
              </button>

              <div className="flex gap-2 items-center">
                <input
                  value={joinId}
                  onChange={(e) => setJoinId(e.target.value)}
                  placeholder="Room ID (ตัวอย่าง: ab12cd)"
                  className="px-3 py-2 rounded-xl bg-gray-800 border border-gray-700 text-sm"
                />
                <button onClick={onJoin} className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 transition text-sm">
                  Join
                </button>
              </div>
            </div>

            {err && <div className="mt-4 text-sm text-rose-400">{err}</div>}
          </div>

          <div className="mt-8 text-sm text-gray-400">
            Pro tip: แชร์ลิงก์ห้องให้เพื่อน แล้วเริ่มแข่งได้เลย 
          </div>
        </div>

        {/* RIGHT: Panel (Auth / Quick links / Info) */}
        <aside className="bg-gray-900/60 border border-gray-800 rounded-2xl p-6 shadow-xl">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-300">บัญชี</div>
              <div className="font-medium">
                {loadingUser ? 'ตรวจสอบ...' : user ? user.name || user.email : 'ผู้เล่นไม่ระบุ'}
              </div>
            </div>

            <div>
              {!loadingUser && user ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      // logout (ถ้ามี API)
                      fetch('http://localhost:3001/api/logout', { method: 'POST', credentials: 'include' })
                        .finally(() => {
                          setUser(null);
                          router.refresh();
                        });
                    }}
                    className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-sm"
                  >
                    Logout
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <a href="/login" className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-sm">Login</a>
                  <a href="/register" className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-sm">Register</a>
                </div>
              )}
            </div>
          </div>

          <hr className="my-4 border-gray-800" />

          <div className="space-y-3">
            <div>
              <h4 className="text-sm text-gray-300">ChessForge</h4>
              <ul className="mt-2 text-sm text-gray-400 space-y-1">
                <li>• Demo version</li>
                <li>• v0.01</li>
                
              </ul>
            </div>

            <div>
              <h4 className="text-sm text-gray-300"></h4>
              <div className="mt-2 flex flex-col gap-2">
                  
              </div>
            </div>
          </div>

          <div className="mt-6 text-xs text-gray-500">
            
          </div>
        </aside>
      </div>
    </div>
  );
}
