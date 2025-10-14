'use client'

export default function ChatBox({
  chat,
  message,
  setMessage,
  sendMessage,
}: {
  chat: string[]
  message: string
  setMessage: (val: string) => void
  sendMessage: () => void
}) {
  return (
    <div className="flex flex-col h-[560px] bg-gray-800 rounded-2xl shadow-xl p-4">
      <div className="flex-1 overflow-y-auto space-y-2 mb-2 pr-2">
        {chat.map((msg, i) => (
          <div key={i} className="text-sm text-gray-100 bg-gray-700 p-2 rounded-md">
            {msg}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          className="flex-1 p-2 rounded-md bg-gray-700 text-white border border-gray-600 focus:outline-none"
          placeholder="พิมพ์ข้อความ..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
        />
        <button
          onClick={sendMessage}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md"
        >
          ส่ง
        </button>
      </div>
    </div>
  )
}
