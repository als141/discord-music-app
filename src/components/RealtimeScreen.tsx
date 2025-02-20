import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, PhoneOff, Phone, Bot } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/utils/api';
import { useToast } from "@/hooks/use-toast";
import Image from 'next/image';

export const RealtimeScreen: React.FC = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [finalText, setFinalText] = useState<string>('');
  const { toast } = useToast();

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const userMessageCreatedRef = useRef<boolean>(false);

  const NIJI_API_KEY = process.env.NEXT_PUBLIC_NIJI_API_KEY;
  const VOICE_ACTOR_ID = process.env.NEXT_PUBLIC_VOICE_ACTOR_ID;
  if (!NIJI_API_KEY || !VOICE_ACTOR_ID) {
    throw new Error("環境変数が設定されていません");
  }

  // handleStopは通常関数として定義し、useEffectは含めない
  const handleStop = useCallback(() => {
    // ここでuseEffectは使わない
    // ピア切断などの処理
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (dcRef.current) {
      dcRef.current.close();
      dcRef.current = null;
    }
  }, []);

  // クリーンアップ用のuseEffect
  useEffect(() => {
    // このuseEffect自体はマウント時に実行され、アンマウント時に返却される関数が呼ばれる
    const frameId = animationFrameRef.current;

    return () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }
      // handleStop()を呼ぶ
      handleStop();
    };
  }, [handleStop]);

  const playVoiceFromText = async (text: string) => {
    try {
      // 既に再生中のオーディオがあれば停止
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }

      const res = await fetch(`https://api.nijivoice.com/api/platform/v1/voice-actors/${VOICE_ACTOR_ID}/generate-voice`, {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
          'x-api-key': NIJI_API_KEY
        },
        body: JSON.stringify({
          script: text,
          speed: "0.9",
          format: "mp3"
        })
      });
      if (!res.ok) {
        const errText = await res.text();
        console.error("Failed to generate voice from NijiVoice API:", errText);
        return;
      }
      const json = await res.json();
      const audioUrl = json.generatedVoice?.audioFileUrl;
      if (!audioUrl) {
        console.error("No audioFileUrl returned from NijiVoice API");
        return;
      }
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      audio.play();
    } catch (e) {
      console.error("Error in playVoiceFromText:", e);
    }
  };

  const handleStart = async () => {
    try {
      setErrorMessage(null);
      const data = await api.getRealtimeSession();
      const EPHEMERAL_KEY = data.client_secret.value;

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });

      const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
      ms.getTracks().forEach(track => {
        track.enabled = !isMuted;
        pc.addTrack(track, ms);
      });

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.onmessage = (e) => {
        const event = JSON.parse(e.data);
        console.log("Received event:", event);

        if (event.type === "error") {
          console.error("OpenAI Realtime API Error:", event.error);
        }

        if (event.type === "conversation.item.created") {
          if (event.item && event.item.role === 'user') {
            userMessageCreatedRef.current = true;
            sendResponseCreate();
          }
        }

        if (event.type === "response.done") {
          let collectedText = '';
          const output = event.response?.output;
          if (Array.isArray(output)) {
            for (const item of output) {
              if (item.type === 'message' && item.role === 'assistant' && Array.isArray(item.content)) {
                for (const c of item.content) {
                  if (c.type === 'text' && c.text) {
                    collectedText += c.text;
                  }
                }
              }
            }
          }
          if (collectedText.trim()) {
            setFinalText(collectedText);
            playVoiceFromText(collectedText);
          } else {
            console.warn("No text found in response.done output.");
          }
        }
      };

      dc.onopen = () => {
        console.log("DataChannel open. Updating session to ensure text-only...");
        sendSessionUpdate();
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpResponse = await fetch(
        "https://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview-2024-12-17",
        {
          method: "POST",
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${EPHEMERAL_KEY}`,
            "Content-Type": "application/sdp"
          },
        }
      );
      if (!sdpResponse.ok) {
        throw new Error('AIとの接続に失敗しました');
      }

      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({
        type: 'answer',
        sdp: answerSdp,
      });

      pcRef.current = pc;
      setIsConnected(true);

      toast({
        title: "接続完了",
        description: "テキストのみの回答を取得します。",
      });

    } catch (error) {
      console.error("Error:", error);
      const message = error instanceof Error ? error.message : "開始に失敗しました";
      setErrorMessage(message);
      toast({
        title: "エラー",
        description: message,
        variant: "destructive",
      });
    }
  };

  const sendSessionUpdate = () => {
    const event = {
      type: "session.update",
      session: {
        modalities: ["text"]
      }
    };
    dcRef.current?.send(JSON.stringify(event));
  };

  const sendResponseCreate = () => {
    const instructions = "（キャラ設定などの文字列）";
    const event = {
      type: "response.create",
      response: {
        role: "assistant",
        content: instructions,
      }
    };
    dcRef.current?.send(JSON.stringify(event));
  };

  const toggleMute = () => {
    if (pcRef.current) {
      pcRef.current.getSenders().forEach(sender => {
        if (sender.track) {
          sender.track.enabled = isMuted;
        }
      });
      setIsMuted(!isMuted);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-950 text-gray-100">
      <div className="fixed inset-0 flex flex-col">
        <header className="px-4 py-3 border-b border-gray-800 bg-gray-900/95 backdrop-blur">
          <div className="flex items-center space-x-2">
            <Bot className="w-6 h-6 text-pink-400" />
            <h1 className="text-lg font-semibold text-transparent bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text">
              ひよりとチャット
            </h1>
          </div>
        </header>

        <main className="flex-1 flex flex-col items-center justify-center p-4">
          <div className="w-full max-w-md">
            <AnimatePresence mode="wait">
              {isConnected ? (
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  className="flex flex-col items-center space-y-8"
                >
                  <div className="relative">
                    <motion.div
                      className="w-40 h-40 rounded-full bg-gradient-to-r from-pink-400/20 to-purple-400/20 flex items-center justify-center"
                      animate={{
                        scale: [1, 1.05, 1],
                        boxShadow: [
                          '0 0 0 0 rgba(236,72,153,0.4)',
                          '0 0 0 20px rgba(236,72,153,0)',
                          '0 0 0 0 rgba(236,72,153,0)'
                        ]
                      }}
                      transition={{
                        duration: 2,
                        repeat: Infinity,
                        ease: "easeInOut"
                      }}
                    >
                      <motion.div
                        className="w-36 h-36 rounded-full bg-gradient-to-r from-pink-400/30 to-purple-400/30 flex items-center justify-center overflow-hidden"
                        animate={{
                          scale: [1, 1.05, 1],
                        }}
                        transition={{
                          duration: 1.5,
                          repeat: Infinity,
                          ease: "easeInOut",
                          delay: 0.5
                        }}
                      >
                        <div className="w-32 h-32 rounded-full overflow-hidden border-2 border-pink-400/30">
                          <Image
                            src="/hiyori.png"
                            alt="Hiyori"
                            width={128}
                            height={128}
                            className="object-cover"
                            priority
                          />
                        </div>
                      </motion.div>
                    </motion.div>
                  </div>

                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center space-y-2"
                  >
                    <p className="text-lg font-medium text-transparent bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text">
                      ひよりと会話中...
                    </p>
                    <p className="text-sm text-gray-400">安定接続</p>
                  </motion.div>

                  {finalText && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-center text-gray-100 bg-gradient-to-r from-pink-400/10 to-purple-400/10 rounded-xl p-4 border border-pink-400/20"
                    >
                      {finalText}
                    </motion.div>
                  )}

                  <div className="flex items-center space-x-4">
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={toggleMute}
                      className={`p-4 rounded-full transition-colors backdrop-blur-sm ${
                        isMuted
                          ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                          : 'bg-pink-400/20 text-pink-400 hover:bg-pink-400/30'
                      }`}
                    >
                      {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                    </motion.button>

                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={handleStop}
                      className="p-6 rounded-full bg-gradient-to-r from-red-500 to-pink-500 text-white shadow-lg shadow-red-500/25 backdrop-blur-sm"
                    >
                      <PhoneOff className="w-8 h-8" />
                    </motion.button>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  className="flex flex-col items-center space-y-6"
                >
                  <div className="w-32 h-32 rounded-full overflow-hidden border-2 border-pink-400/30">
                    <Image
                      src="/hiyori.png"
                      alt="Hiyori"
                      width={128}
                      height={128}
                      className="object-cover"
                      priority
                    />
                  </div>
                  
                  <p className="text-center text-gray-400 max-w-xs">
                    天音ひよりとお話しましょう！<br/>
                    下のボタンをクリックして会話を始めてください。
                  </p>

                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleStart}
                    className="p-6 rounded-full bg-gradient-to-r from-pink-400 to-purple-500 text-white shadow-lg shadow-pink-500/25 backdrop-blur-sm"
                  >
                    <Phone className="w-8 h-8" />
                  </motion.button>
                </motion.div>
              )}
            </AnimatePresence>

            {errorMessage && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6 p-4 rounded-lg bg-red-900/50 border border-red-700/50 text-red-200 text-sm text-center backdrop-blur-sm"
              >
                {errorMessage}
              </motion.div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default RealtimeScreen;