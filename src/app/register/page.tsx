'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RegisterMockCard() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [pwd, setPwd] = useState('');
  const [err, setErr] = useState<string|null>(null);

  function submitMock() {
    setErr(null);
    if (!email || !pwd) { setErr('Please fill in all fields'); return; }
    if (pwd.length < 6) { setErr('Password must be at least 6 characters'); return; }
    router.push('/login');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-900 to-black p-6">
      <div className="w-full max-w-sm bg-gray-900/60 backdrop-blur rounded-2xl border border-gray-700 p-6">
        <h1 className="text-2xl font-bold text-white text-center">ChessForge</h1>
        <p className="text-sm text-gray-400 text-center mb-4">Register</p>

        <label className="text-gray-300 text-xs">username</label>
        <input className="w-full mt-1 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white"
               value={name} onChange={(e)=>setName(e.target.value)} placeholder="username" />

        <label className="text-gray-300 text-xs mt-3 block">email</label>
        <input className="w-full mt-1 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white"
               value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="you@example.com" />

        <label className="text-gray-300 text-xs mt-3 block">password</label>
        <input type="password" className="w-full mt-1 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white"
               value={pwd} onChange={(e)=>setPwd(e.target.value)} placeholder="******" />

        {err && <div className="text-sm text-red-400 mt-3">{err}</div>}

        <button onClick={submitMock}
                className="w-full mt-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
          Register
        </button>

        <div className="text-sm text-gray-400 mt-4 text-center">
          <a href="/login" className="text-indigo-400">login</a>
        </div>
      </div>
    </div>
  );
}
