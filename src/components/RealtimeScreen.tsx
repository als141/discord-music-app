import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, PhoneOff, Phone, Bot, Activity } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/utils/api';
import { useToast } from "@/hooks/use-toast";

export const RealtimeScreen: React.FC = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { toast } = useToast();
  
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      handleStop();
    };
  }, []);

  const setupAudioAnalyser = (stream: MediaStream) => {
    audioContextRef.current = new AudioContext();
    analyserRef.current = audioContextRef.current.createAnalyser();
    const source = audioContextRef.current.createMediaStreamSource(stream);
    source.connect(analyserRef.current);
  };

  const handleStart = async () => {
    try {
      setErrorMessage(null);
      const data = await api.getRealtimeSession();
      const EPHEMERAL_KEY = data.client_secret.value;

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });

      if (!audioRef.current) {
        const audioEl = document.createElement("audio");
        audioEl.autoplay = true;
        audioRef.current = audioEl;
        document.body.appendChild(audioEl);
      }
      
      pc.ontrack = (e) => {
        if (audioRef.current) {
          audioRef.current.srcObject = e.streams[0];
        }
      };

      const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
      setupAudioAnalyser(ms);
      
      ms.getTracks().forEach(track => {
        track.enabled = !isMuted;
        pc.addTrack(track, ms);
      });

      const dc = pc.createDataChannel("oai-events");
      dc.onmessage = (e) => console.log("Received event:", JSON.parse(e.data));
      dcRef.current = dc;

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
        description: "イリーナと会話を開始できます",
      });

    } catch (error) {
      console.error("Error:", error);
      const message = error instanceof Error ? error.message : "音声チャットの開始に失敗しました";
      setErrorMessage(message);
      toast({
        title: "エラー",
        description: message,
        variant: "destructive",
      });
    }
  };

  const handleStop = async () => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.srcObject = null;
    }
    if (audioContextRef.current) {
      await audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setIsConnected(false);
    
    toast({
      title: "通話終了",
      description: "AIとの会話を終了しました",
    });
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
        <header className="px-4 py-3 border-b border-gray-800 bg-gray-900/95 backdrop-blur supports-[backdrop-filter]:bg-gray-900/60">
          <div className="flex items-center space-x-2">
            <Bot className="w-6 h-6 text-blue-400" />
            <h1 className="text-lg font-semibold bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent">
              AI Voice Chat
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
                      className="w-32 h-32 rounded-full bg-blue-500/10 flex items-center justify-center"
                      animate={{
                        scale: [1, 1.1, 1],
                        boxShadow: [
                          '0 0 0 0 rgba(59, 130, 246, 0.4)',
                          '0 0 0 20px rgba(59, 130, 246, 0)',
                          '0 0 0 0 rgba(59, 130, 246, 0)'
                        ]
                      }}
                      transition={{
                        duration: 2,
                        repeat: Infinity,
                        ease: "easeInOut"
                      }}
                    >
                      <motion.div
                        className="w-24 h-24 rounded-full bg-blue-500/20 flex items-center justify-center"
                        animate={{
                          scale: [1, 1.1, 1],
                        }}
                        transition={{
                          duration: 1.5,
                          repeat: Infinity,
                          ease: "easeInOut",
                          delay: 0.5
                        }}
                      >
                        <Activity className="w-12 h-12 text-blue-400" />
                      </motion.div>
                    </motion.div>
                  </div>

                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center space-y-2"
                  >
                    <p className="text-lg font-medium text-gray-200">AIと会話中...</p>
                    <p className="text-sm text-gray-400">接続状態: 安定</p>
                  </motion.div>

                  <div className="flex items-center space-x-4">
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={toggleMute}
                      className={`p-4 rounded-full transition-colors ${
                        isMuted 
                          ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' 
                          : 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30'
                      }`}
                    >
                      {isMuted ? (
                        <MicOff className="w-6 h-6" />
                      ) : (
                        <Mic className="w-6 h-6" />
                      )}
                    </motion.button>

                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={handleStop}
                      className="p-6 rounded-full bg-gradient-to-r from-red-500 to-pink-500 text-white shadow-lg shadow-red-500/25"
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
                  <div className="p-8 rounded-full bg-gray-800/50">
                    <Bot className="w-16 h-16 text-gray-400" />
                  </div>
                  
                  <p className="text-center text-gray-400 max-w-xs">
                    イリーナと音声で会話を始めましょう
                  </p>

                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleStart}
                    className="p-6 rounded-full bg-gradient-to-r from-blue-500 to-violet-500 text-white shadow-lg shadow-blue-500/25"
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
                className="mt-6 p-4 rounded-lg bg-red-900/50 border border-red-700/50 text-red-200 text-sm text-center"
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