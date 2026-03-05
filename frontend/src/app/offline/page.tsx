'use client'

export default function OfflinePage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground p-8">
      <div className="text-center max-w-md">
        <h1 className="text-2xl font-bold mb-4">オフラインです</h1>
        <p className="text-muted-foreground mb-8">
          インターネット接続が復旧したら再度お試しください。
          音楽ボットの操作にはネットワーク接続が必要です。
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-semibold"
        >
          再読み込み
        </button>
      </div>
    </div>
  )
}
