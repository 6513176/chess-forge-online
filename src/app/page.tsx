'use client';
import { useState } from 'react';
import { createRoom } from './lib/socket';
import { useRouter } from 'next/navigation';

export default function Home() {
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  const onCreate = async () => {
    setCreating(true);
    try {
      const { roomId } = await createRoom();
      router.push(`/room/${roomId}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center p-8">
      <div className="max-w-md w-full bg-gray-800 text-white p-6 rounded-2xl space-y-4">
        <h1 className="text-2xl font-bold">Chess Forge</h1>
        <button
          onClick={onCreate}
          disabled={creating}
          className="w-full py-3 bg-indigo-500 rounded-lg hover:bg-indigo-600"
        >
          {creating ? 'Creating…' : 'Create Room'}
        </button>
        
      </div>
    </div>
  );
}
