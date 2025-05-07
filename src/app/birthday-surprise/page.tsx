'use client';
// pages/index.tsx
// このファイルはNext.jsプロジェクトの `pages` ディレクトリに配置してください。
// 必要なライブラリ:
// npm install framer-motion lucide-react clsx tailwind-merge sonner react-confetti howler three @react-three/fiber @react-three/drei
// または
// yarn add framer-motion lucide-react clsx tailwind-merge sonner react-confetti howler three @react-three/fiber @react-three/drei

import Head from 'next/head';
import { NextPage } from 'next';
import React, { useState, useEffect, useMemo, useCallback, Suspense, useRef } from 'react';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';
import { Gift as GiftIconLucide, PartyPopper, Mail, ArrowRight, RotateCcw, Copy, Check, Heart, Sparkles, Wind, Zap, Download, PackageOpen } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import Confetti from 'react-confetti';
import { Howl } from 'howler';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Box, useGLTF, PresentationControls, Stage as DreiStage, Text as DreiText, Environment } from '@react-three/drei';
import * as THREE from 'three';

// Tailwind CSSクラスのマージを容易にするユーティリティ関数
function cn(...inputs: any[]) {
  return twMerge(clsx(inputs));
}

// ☆★☆ 設定 ☆★☆
const birthdayConfig = {
  recipientName: '大切なキミへ',
  senderName: 'いつも想っている私より',  
  greetingTitle: "Happy Birthday!",
  mainMessage: "お誕生日おめでとう！🎉\nいつもたくさんの笑顔と優しさをありがとう。\nキミと出会えて、毎日が本当に楽しいよ。\nこの一年が、キミにとって夢と希望に満ちた、キラキラ輝く素晴らしいものになりますように！✨",
  giftTeaser: "心を込めて、特別なプレゼントを用意したよ。\nドキドキしながら開けてみてね！",
  giftUrl: "#demo-gift", // "#demo-gift" or actual URL e.g. "https://example.com/gift"
  giftLinkText: 'メッセージを見る', 
  finalMessage: "これからも一緒にたくさんの素敵な思い出を作っていこうね。\nキミの幸せをいつも願ってるよ！💖",

  theme: 'dreamy_aurora', 
  fontFamily: {
    heading: "'Manrope', sans-serif", 
    body: "'Inter', sans-serif",       
    messageCard: "'Dancing Script', cursive", 
  },
  // Base colors (will be overridden by theme but good for fallback)
  colors: {
    primary: '#8B5CF6', // purple-500
    secondary: '#EC4899', // pink-500
    accent: '#F59E0B', // amber-400
    textBase: '#374151', // gray-700
    textBaseDark: '#F3F4F6', // gray-100
    cardBg: '#FFFFFF', // white
    cardBgDark: '#1F2937', // gray-800 (hex for consistency)
  },
  background: {
    type: 'gradient',
    gradientDirection: 'to-br', 
    gradientColors: ['from-indigo-300', 'via-purple-400', 'to-pink-400'],
    showParticles: true, 
  },
  animationStyle: 'dynamic',
  sounds: {
    introMusic: { src: null, volume: 0.2, loop: true },
    buttonClick: { src: '/sounds/button_pop.mp3', volume: 0.7 },
    giftAppear: { src: '/sounds/gift_appear_sparkle.mp3', volume: 0.5 },
    giftInteract: { src: '/sounds/gift_shake_chime.mp3', volume: 0.4 },
    giftOpen: { src: '/sounds/gift_open_magic.mp3', volume: 0.8 },
    messageReveal: { src: '/sounds/message_reveal_harp.mp3', volume: 0.6 },
  },
  confetti: {
    colors: ['#FFC700', '#FF6B6B', '#C0FFEE', '#A084E8', '#84E8A0'],
    numberOfPieces: 300,
    recycle: false,
    gravity: 0.15,
    initialVelocityX: {min: -10, max: 10},
    initialVelocityY: {min: -15, max: 5},
  },
};
// ☆★☆ 設定ここまで ☆★☆

// --- Theme color mapping to HEX for 3D and direct use ---
const tailwindColorToHex: Record<string, string> = {
  'purple-500': '#a855f7', 'pink-500': '#ec4899', 'amber-400': '#f59e0b',
  'rose-600': '#e11d48', 'amber-500': '#f59e0b', 'teal-500': '#14b8a6',
  'cyan-400': '#22d3ee', 'purple-400': '#c084fc', 'lime-400': '#a3e63e',
  'lime-500': '#84cc16', 'fuchsia-500': '#d946ef', 'sky-400': '#38bdf8',
  'violet-400': '#a78bfa', 'sky-300': '#7dd3fc', 'emerald-400': '#34d399',
  'yellow-300': '#fde047', 'blue-400': '#60a5fa', 'purple-300': '#d8b4fe',
  'slate-200': '#e2e8f0', 'sky-500': '#0ea5e9', 'rose-500': '#f43f5e',
  'gray-700': '#374151', 'gray-100': '#F3F4F6', 'white': '#FFFFFF', 'gray-800': '#1F2937',
  'indigo-300': '#a5b4fc', 'pink-400': '#f472b6',
  'rose-100': '#ffe4e6', 'orange-50': '#fff7ed', 'yellow-100': '#fef9c3',
  'gray-900': '#111827', 'purple-900': '#581c87', 'blue-900': '#1e3a8a',
  'orange-400': '#fb923c', 'red-400': '#f87171',
  'indigo-800': '#3730a3', 'purple-700': '#7e22ce', 'pink-700': '#be185d'
};

// --- テーマ定義 ---
// Note: For colors, provide Tailwind class names for CSS, and direct HEX values for JS/3D if needed.
// We'll primarily use Tailwind classes and derive HEX for specific cases like 3D or CSS vars.
const themes: Record<string, {
  colors: { primary: string, secondary: string, accent: string, textBase: string, cardBg: string, textBaseTailwind: string, cardBgTailwind: string },
  background: { gradientColors?: string[], type?: string, gradientDirection?: string },
  fontFamily: { [key: string]: string },
  confettiColors?: string[]
}> = {
  light_elegant: {
    colors: { primary: tailwindColorToHex['rose-600'], secondary: tailwindColorToHex['amber-500'], accent: tailwindColorToHex['teal-500'], textBase: tailwindColorToHex['gray-800'], cardBg: 'rgba(255,255,255,0.85)', textBaseTailwind: 'gray-800', cardBgTailwind: 'white' },
    background: { gradientColors: ['from-rose-100', 'via-orange-50', 'to-yellow-100'], type: 'gradient' },
    fontFamily: { heading: "'Playfair Display', serif", body: "'Lato', sans-serif", messageCard: "'Parisienne', cursive" },
    confettiColors: ['#E11D48', '#F59E0B', '#14B8A6', '#FECACA', '#FDE68A'],
  },
  dark_modern: {
    colors: { primary: tailwindColorToHex['cyan-400'], secondary: tailwindColorToHex['purple-400'], accent: tailwindColorToHex['lime-400'], textBase: tailwindColorToHex['gray-100'], cardBg: 'rgba(31,41,55,0.7)', textBaseTailwind: 'gray-100', cardBgTailwind: 'gray-800' },
    background: { gradientColors: ['from-gray-900', 'via-purple-900', 'to-blue-900'], type: 'gradient' },
    fontFamily: { heading: "'Orbitron', sans-serif", body: "'Roboto Mono', monospace", messageCard: "'Kalam', cursive" },
    confettiColors: ['#22D3EE', '#C084FC', '#A3E63E', '#67E8F9', '#F0ABFC'],
  },
  pop_funky: {
    colors: { primary: tailwindColorToHex['lime-500'], secondary: tailwindColorToHex['fuchsia-500'], accent: tailwindColorToHex['sky-400'], textBase: tailwindColorToHex['gray-800'], cardBg: 'rgba(254,249,195,0.85)', textBaseTailwind: 'gray-800', cardBgTailwind: 'yellow-100' },
    background: { gradientColors: ['from-yellow-300', 'via-orange-400', 'to-red-400'], type: 'gradient' },
    fontFamily: { heading: "'Bangers', cursive", body: "'Comic Neue', cursive", messageCard: "'Gochi Hand', cursive" },
    confettiColors: ['#84CC16', '#D946EF', '#38BDF8', '#FACC15', '#FB7185'],
  },
  dreamy_aurora: {
    colors: { primary: tailwindColorToHex['violet-400'], secondary: tailwindColorToHex['sky-300'], accent: tailwindColorToHex['emerald-400'], textBase: '#FFFFFF', cardBg: 'rgba(25,15,60,0.55)', textBaseTailwind: 'white', cardBgTailwind: 'gray-900' /* Placeholder for dark card */ },
    background: { type: 'animated_aurora' },
    fontFamily: { heading: "'Manrope', sans-serif", body: "'Inter', sans-serif", messageCard: "'Satisfy', cursive" },
    confettiColors: ['#A78BFA', '#7DD3FC', '#6EE7B7', '#FBCFE8', '#DDD6FE'],
  },
  starry_night: {
    colors: { primary: tailwindColorToHex['yellow-300'], secondary: tailwindColorToHex['blue-400'], accent: tailwindColorToHex['purple-300'], textBase: tailwindColorToHex['gray-100'], cardBg: 'rgba(17,24,39,0.7)', textBaseTailwind: 'gray-100', cardBgTailwind: 'gray-900' },
    background: { type: 'starry_sky' },
    fontFamily: { heading: "'Righteous', cursive", body: "'Space Grotesk', sans-serif", messageCard: "'Cedarville Cursive', cursive" },
    confettiColors: ['#FDE047', '#60A5FA', '#D8B4FE', '#FEF3C7', '#BFDBFE'],
  },
   sleek_modern: {
    colors: { primary: tailwindColorToHex['slate-200'], secondary: tailwindColorToHex['sky-500'], accent: tailwindColorToHex['rose-500'], textBase: tailwindColorToHex['gray-800'], cardBg: 'rgba(255,255,255,0.8)', textBaseTailwind: 'slate-800', cardBgTailwind: 'white' },
    background: { gradientColors: ['from-slate-50', 'to-gray-200'], type: 'gradient', gradientDirection: 'to-b' },
    fontFamily: { heading: "'Inter', sans-serif", body: "'Inter', sans-serif", messageCard: "'Caveat', cursive" },
    confettiColors: ['#E2E8F0', '#0EA5E9', '#F43F5E', '#94A3B8', '#38BDF8'],
  }
};

const currentThemeName = birthdayConfig.theme as keyof typeof themes;
const currentThemeSettings = themes[currentThemeName] || themes.dreamy_aurora;

const finalConfig = {
  ...birthdayConfig,
  colors: { // Store HEX values directly for JS/3D use
    primary: currentThemeSettings.colors.primary,
    secondary: currentThemeSettings.colors.secondary,
    accent: currentThemeSettings.colors.accent,
    textBase: currentThemeSettings.colors.textBase, // For JS logic if needed
    cardBg: currentThemeSettings.colors.cardBg, // For JS logic if needed
    // Tailwind class names for CSS styling
    primaryTailwind: Object.keys(tailwindColorToHex).find(key => tailwindColorToHex[key] === currentThemeSettings.colors.primary) || 'purple-500',
    secondaryTailwind: Object.keys(tailwindColorToHex).find(key => tailwindColorToHex[key] === currentThemeSettings.colors.secondary) || 'pink-500',
    accentTailwind: Object.keys(tailwindColorToHex).find(key => tailwindColorToHex[key] === currentThemeSettings.colors.accent) || 'amber-400',
    textBaseTailwind: currentThemeSettings.colors.textBaseTailwind,
    cardBgTailwind: currentThemeSettings.colors.cardBgTailwind,
  },
  fontFamily: { ...birthdayConfig.fontFamily, ...currentThemeSettings.fontFamily },
  background: { ...birthdayConfig.background, ...currentThemeSettings.background },
  confetti: { ...birthdayConfig.confetti, colors: currentThemeSettings.confettiColors || birthdayConfig.confetti.colors }
};


// --- サウンド関連の型定義 ---
type SoundInfo = {
  src: string | null;
  volume: number;
  loop?: boolean;
};

type Stage = 'initial_load' | 'invitation' | 'gift_interaction' | 'unveiling' | 'revealed';

// --- 3D Gift Box Component ---
const GiftBox3D = ({ onOpen, onInteract, isOpening }: { onOpen: () => void, onInteract: () => void, isOpening: boolean }) => {
  const group = useRef<THREE.Group>(null);
  const lidRef = useRef<THREE.Mesh>(null);
  const [isHovered, setIsHovered] = useState(false);

  const boxSize: [number, number, number] = [1.8, 1.8, 1.8];
  const lidSize: [number, number, number] = [boxSize[0] * 1.05, boxSize[1] * 0.3, boxSize[2] * 1.05];

  useFrame((state, delta) => {
    if (group.current && !isOpening) {
      group.current.rotation.y += delta * 0.10 * (isHovered ? 1.5 : 0.5);
    }
    if (lidRef.current && isOpening) {
      // Lid opening animation
      lidRef.current.position.y = THREE.MathUtils.lerp(lidRef.current.position.y, boxSize[1] * 1.2, 0.06);
      lidRef.current.rotation.x = THREE.MathUtils.lerp(lidRef.current.rotation.x, -Math.PI / 5, 0.06);
      lidRef.current.rotation.z = THREE.MathUtils.lerp(lidRef.current.rotation.z, Math.PI / 9, 0.06);
    }
  });
  
  const handlePointerDown = (e: any) => {
    e.stopPropagation(); 
    if (!isOpening) {
        onInteract();
        if (group.current) { // Small jump animation
            group.current.position.y = 0.05;
            setTimeout(() => { if(group.current) group.current.position.y = 0; }, 100);
        }
    }
  };

  const handleClick = (e: any) => {
    e.stopPropagation();
    if (!isOpening) {
      onOpen();
    }
  }

  return (
    <group ref={group} position={[0, -boxSize[1]/4, 0]} onClick={handleClick} onPointerOver={() => setIsHovered(true)} onPointerOut={() => setIsHovered(false)} onPointerDown={handlePointerDown}>
      {/* Box Base */}
      <Box args={boxSize} position={[0, -lidSize[1]/2, 0]}>
        <meshStandardMaterial color={new THREE.Color(finalConfig.colors.primary)} metalness={0.2} roughness={0.7} />
      </Box>
      {/* Lid */}
      <Box ref={lidRef} args={lidSize} position={[0, boxSize[1]/2 - lidSize[1]/2 + 0.02, 0]}>
        <meshStandardMaterial color={new THREE.Color(finalConfig.colors.secondary)} metalness={0.2} roughness={0.6} />
      </Box>
      {/* Ribbon - simplified cross */}
      <Box args={[boxSize[0] * 1.1, 0.2, 0.2]} position={[0, boxSize[1]/2 - lidSize[1]/2 + lidSize[1]/2 - 0.1, 0]}>
         <meshStandardMaterial color={new THREE.Color(finalConfig.colors.accent)} emissive={new THREE.Color(finalConfig.colors.accent)} emissiveIntensity={0.2} roughness={0.4}/>
      </Box>
       <Box args={[0.2, 0.2, boxSize[2] * 1.1]} position={[0, boxSize[1]/2 - lidSize[1]/2 + lidSize[1]/2 - 0.1, 0]}>
         <meshStandardMaterial color={new THREE.Color(finalConfig.colors.accent)} emissive={new THREE.Color(finalConfig.colors.accent)} emissiveIntensity={0.2} roughness={0.4}/>
      </Box>
    </group>
  );
};


const BirthdaySurprisePage: NextPage = () => {
  const [stage, setStage] = useState<Stage>('initial_load');
  const [showConfetti, setShowConfetti] = useState(false);
  const [windowSize, setWindowSize] = useState({ width: 0, height: 0 });
  const [isGiftReady, setIsGiftReady] = useState(false);
  const [isGiftOpening, setIsGiftOpening] = useState(false);
  const [copied, setCopied] = useState(false);

  const messageCardControls = useAnimation();
  const sounds = useMemo(() => {
    const loadedSounds: { [key: string]: Howl | null } = {};
    for (const key in finalConfig.sounds) {
      const soundInfo = finalConfig.sounds[key as keyof typeof finalConfig.sounds] as SoundInfo;
      if (soundInfo && soundInfo.src) {
        loadedSounds[key] = new Howl({ 
          src: [soundInfo.src], 
          volume: soundInfo.volume ?? 0.7,
          loop: soundInfo.loop ?? false,
          html5: true 
        });
      } else {
        loadedSounds[key] = null;
      }
    }
    return loadedSounds;
  }, []);

  const playSound = useCallback((soundName: keyof typeof finalConfig.sounds) => {
    sounds[soundName]?.play();
  }, [sounds]);

  useEffect(() => {
    const fontFamilies = [finalConfig.fontFamily.heading, finalConfig.fontFamily.body, finalConfig.fontFamily.messageCard];
    const uniqueFontNames = [...new Set(fontFamilies.map(f => f.split(',')[0].replace(/'/g, '').replace(/ /g, '+')))];
    
    const fontLink = document.createElement('link');
    fontLink.href = `https://fonts.googleapis.com/css2?family=${uniqueFontNames.join('&family=')}:wght@300;400;500;600;700;800&display=swap`;
    fontLink.rel = 'stylesheet';
    document.head.appendChild(fontLink);

    const handleResize = () => setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    handleResize();
    window.addEventListener('resize', handleResize);
    
    const timer = setTimeout(() => {
      setStage('invitation');
      playSound('introMusic');
    }, 1500);

    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timer);
      Object.values(sounds).forEach(sound => sound?.unload());
    };
  }, [playSound, sounds]);


  const handleStartInteraction = () => {
    playSound('buttonClick');
    setStage('gift_interaction');
    setTimeout(() => {
      setIsGiftReady(true);
      playSound('giftAppear');
    }, 700);
  };
  
  const handleGiftInteract3D = () => {
    playSound('giftInteract');
  };

  const handleOpenGift3D = async () => {
    if (isGiftOpening) return;
    playSound('giftOpen');
    setIsGiftOpening(true);

    setTimeout(async () => {
        setStage('unveiling'); // Transition to unveiling to hide 3D box
        setShowConfetti(true);
        
        // Animate message card in
        playSound('messageReveal');
        await messageCardControls.start({
            opacity: 1,
            scale: 1,
            y: 0,
            transition: { duration: 1, delay: 0.3, type: 'spring', stiffness: 100, damping: 15 },
        });
        setStage('revealed'); // Final stage, content is now visible
        setTimeout(() => setShowConfetti(false), 8000);
    }, 2000); // Time for 3D lid animation to play out a bit
  };

  const handleCopyToClipboard = (text: string) => {
    playSound('buttonClick');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      toast.success("ギフトURLがコピーされました！", { style: { fontFamily: finalConfig.fontFamily.body }});
      setTimeout(() => setCopied(false), 2000);
    }).catch(err => {
      toast.error("コピーに失敗しました。", { style: { fontFamily: finalConfig.fontFamily.body }});
    });
  };
  
  const handleSaveToEmail = () => {
    playSound('buttonClick');
    const subject = encodeURIComponent(`${finalConfig.recipientName}さんへの誕生日プレゼント (${finalConfig.senderName}より)`);
    let body = `こんにちは、${finalConfig.recipientName}さん！\n\n`;
    body += `${finalConfig.senderName}からの誕生日メッセージです💌：\n\n"${finalConfig.mainMessage}"\n\n`;
    if (finalConfig.giftUrl && finalConfig.giftUrl !== '#demo-gift') {
      body += `\nそして、特別なギフトのリンクはこちらです🎁：\n${finalConfig.giftUrl}\n\n`;
    } else {
      body += `\nこれはデモンストレーション用の素敵なプレゼント体験でした！\n\n`;
    }
    body += `\n${finalConfig.finalMessage}\n\n`;
    body += `心からお祝い申し上げます、\n${finalConfig.senderName}`;
    const encodedBody = encodeURIComponent(body);
    window.location.href = `mailto:?subject=${subject}&body=${encodedBody}`;
    toast.info("メールソフトが起動します。", { style: { fontFamily: finalConfig.fontFamily.body }});
  };

  const handleDownloadGift = () => {
    playSound('buttonClick');
    toast.success("記念品のダウンロードを開始します！ (現在はダミーです)", { 
      style: { fontFamily: finalConfig.fontFamily.body },
      description: "実際の機能は後ほど実装されます。"
    });
  };

  const handleReset = () => {
    playSound('buttonClick');
    setStage('invitation');
    setShowConfetti(false);
    setIsGiftReady(false);
    setIsGiftOpening(false);
    messageCardControls.start({ opacity: 0, scale: 0.8, y: 50, transition: {duration: 0.1} }); // Reset immediately
    sounds.introMusic?.stop(); // Stop if playing
    sounds.introMusic?.play(); // Restart
  };

  const isDarkThemeActive = useMemo(() => {
    return currentThemeName.startsWith('dark') || ['dreamy_aurora', 'starry_night'].includes(currentThemeName);
  }, [currentThemeName]);

  const textBaseColorClass = isDarkThemeActive ? `text-${finalConfig.colors.textBaseTailwind}` : `text-${finalConfig.colors.textBaseTailwind}`;
  
  const cardStyle = useMemo(() => {
    const cardBgColor = finalConfig.colors.cardBg; // This is already rgba or hex
    let styles: React.CSSProperties = {
        fontFamily: finalConfig.fontFamily.body,
        borderRadius: '1.75rem', // Slightly more rounded
        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', 
        padding: '2rem 2.5rem',
        backgroundColor: cardBgColor, // Use the direct rgba value
    };
    let classNames = 'relative z-10 w-full';

    if (cardBgColor.startsWith('rgba')) {
        styles.backdropFilter = 'blur(20px) saturate(150%)';
        styles.WebkitBackdropFilter = 'blur(20px) saturate(150%)';
        classNames = cn(classNames, isDarkThemeActive ? 'border border-white/10' : 'border border-black/5');
    }
    return { styles, classNames };
  }, [finalConfig.fontFamily.body, finalConfig.colors.cardBg, isDarkThemeActive]);


  const BackgroundParticles = () => {
    if (!finalConfig.background.showParticles || ['animated_aurora', 'starry_sky'].includes(finalConfig.background.type || '')) return null;
    const particleCount = 70;
    return (
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-[-1]">
        {Array.from({ length: particleCount }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute rounded-full bg-white/50" // Use opacity on bg
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              width: `${Math.random() * 2.5 + 0.5}px`,
              height: `${Math.random() * 2.5 + 0.5}px`,
              filter: 'blur(0.5px)',
            }}
            animate={{
              x: [0, (Math.random() - 0.5) * 40, 0],
              y: [0, (Math.random() - 0.5) * 40, 0],
              opacity: [0, Math.random() * 0.3 + 0.1, 0]
            }}
            transition={{
              duration: Math.random() * 15 + 15,
              repeat: Infinity,
              repeatType: 'mirror',
              ease: 'easeInOut',
              delay: Math.random() * 5
            }}
          />
        ))}
      </div>
    );
  };
  
  const AuroraBackground = () => (
    <div className="aurora-bg fixed inset-0 overflow-hidden pointer-events-none z-[-1]">
      <div className="aurora-layer"></div>
      <div className="aurora-layer"></div>
      <div className="aurora-layer"></div>
    </div>
  );

  const StarrySkyBackground = () => (
    <div className="starry-sky-bg fixed inset-0 overflow-hidden pointer-events-none z-[-1]">
      {Array.from({length: 150}).map((_, i) => (
        <motion.div
          key={i}
          className="absolute bg-white rounded-full"
          style={{
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            width: `${Math.random() * 1.5 + 0.3}px`,
            height: `${Math.random() * 1.5 + 0.3}px`,
            opacity: Math.random() * 0.6 + 0.2,
          }}
          animate={{ opacity: [Math.random() * 0.4 + 0.1, Math.random() * 0.7 + 0.2, Math.random() * 0.4 + 0.1] }}
          transition={{ duration: Math.random() * 4 + 3, repeat: Infinity, repeatType: "mirror", delay: Math.random() * 2 }}
        />
      ))}
    </div>
  );

  const buttonBaseClasses = "font-semibold text-base px-6 py-3 rounded-xl shadow-md hover:shadow-lg transition-all duration-300 ease-in-out transform hover:-translate-y-0.5 flex items-center justify-center group focus:outline-none focus:ring-2 focus:ring-offset-2";
  const primaryButtonClasses = cn(buttonBaseClasses, `bg-gradient-to-r from-${finalConfig.colors.accentTailwind.replace('-400','-500')} to-${finalConfig.colors.accentTailwind}`, `hover:from-${finalConfig.colors.accentTailwind.replace('-400','-600')} hover:to-${finalConfig.colors.accentTailwind.replace('-400','-500')}`, `focus:ring-${finalConfig.colors.accentTailwind}`, isDarkThemeActive ? 'text-gray-900' : 'text-white');
  const secondaryButtonClasses = cn(buttonBaseClasses, `bg-${finalConfig.colors.primaryTailwind}`, `hover:bg-${finalConfig.colors.primaryTailwind.replace('-500','-600').replace('-400','-500')}`, `focus:ring-${finalConfig.colors.primaryTailwind}`, 'text-white');
  const tertiaryButtonClasses = cn(buttonBaseClasses, `bg-white/10 hover:bg-white/20 backdrop-blur-sm border border-white/20`, `focus:ring-white/50`, isDarkThemeActive ? `text-${finalConfig.colors.textBaseTailwind}` : `text-gray-700`);


  return (
    <>
      <Head>
        <title>🎂 {finalConfig.recipientName}への誕生日プレゼント！</title>
        <meta name="description" content={`A special birthday surprise for ${finalConfig.recipientName} from ${finalConfig.senderName}`} />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main
        className={cn(
          `min-h-screen flex flex-col items-center justify-center p-4 sm:p-6 overflow-hidden relative transition-colors duration-1000 ease-in-out select-none`,
          textBaseColorClass,
          (finalConfig.background.type !== 'animated_aurora' && finalConfig.background.type !== 'starry_sky' && finalConfig.background.gradientColors)
            ? `bg-gradient-${finalConfig.background.gradientDirection} ${finalConfig.background.gradientColors.join(' ')}` 
            : ''
        )}
        style={{ fontFamily: finalConfig.fontFamily.body }}
      >
        {finalConfig.background.type === 'animated_aurora' && <AuroraBackground />}
        {finalConfig.background.type === 'starry_sky' && <StarrySkyBackground />}
        <BackgroundParticles />
        <Toaster richColors position="top-center" toastOptions={{ 
            style: { fontFamily: finalConfig.fontFamily.body, background: isDarkThemeActive ? '#2D3748' : '#FFFFFF', color: isDarkThemeActive ? '#F7FAFC' : '#1A202C', border: isDarkThemeActive ? '1px solid #4A5568': '1px solid #E2E8F0' },
            closeButton: true,
        }}/>
        
        {showConfetti && windowSize.width > 0 && (
          <Confetti
            width={windowSize.width}
            height={windowSize.height}
            colors={finalConfig.confetti.colors}
            numberOfPieces={finalConfig.confetti.numberOfPieces}
            recycle={finalConfig.confetti.recycle}
            gravity={finalConfig.confetti.gravity}
            initialVelocityX={finalConfig.confetti.initialVelocityX}
            initialVelocityY={finalConfig.confetti.initialVelocityY}
            tweenDuration={8000}
            className="fixed top-0 left-0 w-full h-full z-[100]" // Ensure confetti is on top
          />
        )}
        
        <AnimatePresence mode="wait">
          {stage === 'initial_load' && (
            <motion.div key="loader" className="flex flex-col items-center"
              initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
              transition={{ type: 'spring', stiffness: 150, damping: 20}}
            >
              <Heart size={72} className={`animate-pulse text-[${finalConfig.colors.primary}]`} strokeWidth={1.5}/>
              <p className="mt-5 text-lg font-medium tracking-wider">準備中...</p>
            </motion.div>
          )}

          {stage === 'invitation' && (
            <motion.div
              key="invitation"
              initial={{ opacity: 0, y: 50, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.8, type: 'spring', stiffness: 120, damping: 18 } }}
              exit={{ opacity: 0, y: -30, scale: 0.95, transition: { duration: 0.5, ease: 'anticipate' } }}
              className={cn(`text-center max-w-md md:max-w-lg`, cardStyle.classNames)}
              style={cardStyle.styles}
            >
              <motion.h1
                className={cn("text-4xl md:text-5xl font-bold mb-3", `text-[${finalConfig.colors.primary}]`)}
                style={{ fontFamily: finalConfig.fontFamily.heading, fontWeight: 700 }}
                initial={{ opacity:0, scale:0.8}} animate={{opacity:1, scale:1, transition:{delay:0.2, duration:0.6, type: 'spring'}}}
              >
                {finalConfig.greetingTitle}
              </motion.h1>
              <motion.p 
                className={cn("text-2xl md:text-3xl mb-6 font-semibold", `text-[${finalConfig.colors.secondary}]`)} 
                style={{ fontFamily: finalConfig.fontFamily.heading, fontWeight: 600 }}
                initial={{ opacity:0, y:10}} animate={{opacity:1, y:0, transition:{delay:0.3, duration:0.5}}}
              >
                {finalConfig.recipientName}！
              </motion.p>
              <motion.p 
                className="text-md md:text-lg mb-10 whitespace-pre-line leading-relaxed" 
                initial={{opacity:0}} animate={{opacity:1, transition:{delay:0.4, duration:0.5}}}
              >
                {finalConfig.mainMessage}
              </motion.p>
              
              <motion.button
                onClick={handleStartInteraction}
                className={primaryButtonClasses}
                // Using style for box shadow with dynamic color from JS variable
                style={{'--shadow-color': finalConfig.colors.accent} as React.CSSProperties}
                whileHover={{ scale: 1.03, boxShadow: `0px 8px 25px var(--shadow-color)` }}
                whileTap={{ scale: 0.97 }}
                initial={{opacity:0, y:20}} animate={{opacity:1, y:0, transition:{delay:0.6, type:'spring', stiffness:150}}}
              >
                <Sparkles size={22} className="mr-2.5 group-hover:animate-spin" strokeWidth={2} />
                サプライズを見る
                <ArrowRight size={22} className="ml-2.5 group-hover:translate-x-1 transition-transform" strokeWidth={2} />
              </motion.button>
            </motion.div>
          )}

          {stage === 'gift_interaction' && (
             <motion.div
              key="gift_interaction"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1, transition: { duration: 0.6, ease: 'easeOut' } }}
              exit={{ opacity: 0, scale: 0.9, y: 50, transition: { duration: 0.4, ease: 'easeIn' } }} // Exit downwards
              className="flex flex-col items-center text-center relative z-10 w-full max-w-md"
            >
              <motion.p 
                className="text-xl md:text-2xl mb-6 md:mb-8 leading-relaxed" 
                initial={{opacity:0, y:20}} animate={{opacity:1, y:0, transition:{delay:0.2, duration:0.5}}}
              >
                {finalConfig.giftTeaser}
              </motion.p>
              
              <motion.div 
                className="w-full h-[320px] md:h-[400px] my-4 md:my-2 relative cursor-pointer" // Added cursor-pointer
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: isGiftReady ? 1 : 0, scale: isGiftReady ? 1 : 0.5, transition: { type: 'spring', stiffness: 100, damping: 15, delay: 0.3 } }}
                onClick={!isGiftOpening ? handleOpenGift3D : undefined} // Click on canvas to open if not already opening
              >
                {isGiftReady && (
                  <Suspense fallback={<div className="w-full h-full flex items-center justify-center"><Sparkles className="animate-spin text-2xl" /> <span className="ml-2">Loading 3D Gift...</span></div>}>
                    <Canvas camera={{ position: [0, 1, 5.8], fov: 45 }} shadows>
                      <ambientLight intensity={1} />
                      <spotLight position={[8, 10, 8]} angle={0.25} penumbra={0.8} intensity={2} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
                      <pointLight position={[-8, -3, -8]} intensity={1} />
                       <Environment preset="sunset" background={false} /> 
                      <PresentationControls
                        global
                        config={{ mass: 1, tension: 200, friction: 20 }}
                        snap={{ mass: 2, tension: 300, friction: 30 }}
                        rotation={[0.1, -0.2, 0]} // Initial slight rotation
                        polar={[-Math.PI / 4, Math.PI / 4]} // Limit vertical rotation
                        azimuth={[-Math.PI / 3, Math.PI / 3]} // Limit horizontal rotation
                      >
                        <GiftBox3D onOpen={handleOpenGift3D} onInteract={handleGiftInteract3D} isOpening={isGiftOpening} />
                      </PresentationControls>
                    </Canvas>
                  </Suspense>
                )}
              </motion.div>

              {isGiftReady && !isGiftOpening && (
                <motion.button
                  onClick={handleOpenGift3D}
                  className={cn(primaryButtonClasses, "mt-4 md:mt-6")}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: 0.8, type: 'spring', stiffness: 150 } }}
                  style={{'--shadow-color': finalConfig.colors.accent} as React.CSSProperties}
                  whileHover={{ scale: 1.03, boxShadow: `0px 6px 20px var(--shadow-color)` }} 
                  whileTap={{ scale: 0.97 }}
                >
                  <PackageOpen size={22} className="mr-2.5 group-hover:animate-bounce" strokeWidth={2}/>
                  宝箱を開ける
                </motion.button>
              )}
               {isGiftOpening && (
                 <motion.p 
                    className="text-lg mt-4 md:mt-6 font-medium"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1, transition: { delay: 0.5 } }}
                 >
                    開封中... ✨
                 </motion.p>
               )}
            </motion.div>
          )}
          
          {/* Message Card Stage - combines unveiling and revealed */}
          {(stage === 'unveiling' || stage === 'revealed') && (
            <motion.div
              key="revealed_card_wrapper" // Ensure key is stable for AnimatePresence
              initial="initial"
              animate="animate"
              exit="exit"
              variants={{
                initial: { opacity: 0, y: 50, scale: 0.95 },
                animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.8, type: 'spring', stiffness: 120, damping: 18, delay: stage === 'unveiling' ? 0.2 : 0 } },
                exit: { opacity: 0, y: -30, scale: 0.95, transition: { duration: 0.4, ease: 'anticipate' } }
              }}
              className={cn(`text-center max-w-lg md:max-w-xl`, cardStyle.classNames)}
              style={cardStyle.styles}
            >
              {/* This inner motion.div is for the content animation after card appears */}
              <motion.div 
                animate={messageCardControls} 
                initial={{ opacity: 0, scale: 0.8, y: 30 }}
                className="w-full"
              >
                <PartyPopper size={60} className={cn("mx-auto mb-5", `text-[${finalConfig.colors.accent}]`)} strokeWidth={1.5}/>
                <h2 className={cn("text-3xl md:text-4xl font-bold mb-4", `text-[${finalConfig.colors.primary}]`)} style={{ fontFamily: finalConfig.fontFamily.heading, fontWeight: 700 }}>
                  開封おめでとう！
                </h2>
                
                <div 
                  className="text-lg md:text-xl my-6 p-5 rounded-lg bg-black/5 dark:bg-white/5 shadow-inner whitespace-pre-line min-h-[100px] flex items-center justify-center"
                  style={{ 
                    fontFamily: finalConfig.fontFamily.messageCard, 
                    fontSize: '1.7rem', 
                    lineHeight: '1.9', 
                    color: isDarkThemeActive ? finalConfig.colors.textBase : '#4A5568', // Ensure good contrast for script font
                    WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale'
                  }}
                >
                  {finalConfig.finalMessage}
                </div>

                {finalConfig.giftUrl && finalConfig.giftUrl !== '#demo-gift' ? (
                  <motion.a
                    href={finalConfig.giftUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(secondaryButtonClasses, 'mb-6 text-md')}
                    style={{'--shadow-color': finalConfig.colors.primary} as React.CSSProperties}
                    whileHover={{ scale: 1.03, boxShadow: `0px 5px 20px var(--shadow-color)` }}
                    whileTap={{ scale: 0.97 }}
                  >
                    <Wind size={20} className="mr-2.5 group-hover:rotate-[360deg] transition-transform duration-700" strokeWidth={2}/>
                    <span>プレゼントを見る！</span>
                  </motion.a>
                ) : (
                  <motion.div 
                    className={cn("p-4 rounded-lg mb-6 text-md border-2 border-dashed", `border-[${finalConfig.colors.accent}]`, `text-[${finalConfig.colors.accent}]`)}
                    initial={{opacity:0, y:10}} animate={{opacity:1, y:0, transition:{delay:0.2}}}
                  >
                    <PartyPopper size={24} className="inline mr-2" strokeWidth={2}/>
                    これはデモンストレーション用の素敵なプレゼントです！
                  </motion.div>
                )}
                
                <div className="mt-6 flex flex-row flex-wrap justify-center items-center gap-3 sm:gap-4">
                  <motion.button
                    onClick={handleSaveToEmail}
                    className={tertiaryButtonClasses}
                    whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  >
                    <Mail size={18} className="mr-2" strokeWidth={2}/>
                    メールで保存
                  </motion.button>
                  {finalConfig.giftUrl && finalConfig.giftUrl !== '#demo-gift' && (
                    <motion.button
                      onClick={() => handleCopyToClipboard(finalConfig.giftUrl)}
                      className={cn(tertiaryButtonClasses)}
                      whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                    >
                      {copied ? <Check size={18} className="mr-2 text-green-400" strokeWidth={3}/> : <Copy size={18} className="mr-2" strokeWidth={2}/>}
                      URLをコピー
                    </motion.button>
                  )}
                  <motion.button
                    onClick={handleDownloadGift}
                    className={cn(tertiaryButtonClasses, `text-[${finalConfig.colors.accent}] hover:bg-[${finalConfig.colors.accent}]/20 border-[${finalConfig.colors.accent}]/50`)}
                    whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  >
                    <Download size={18} className="mr-2" strokeWidth={2}/>
                    記念品を保存
                  </motion.button>
                </div>
                 <p className="text-md font-medium mt-8" style={{ fontFamily: finalConfig.fontFamily.body }}>
                   心からの感謝を込めて、<br/> <span className={`font-semibold text-[${finalConfig.colors.secondary}]`}>{finalConfig.senderName}</span>
                 </p>
              </motion.div> {/* End of messageCardControls animated div */}
              
              <motion.button
                onClick={handleReset}
                className="mt-8 flex items-center text-sm opacity-60 hover:opacity-100 transition-opacity duration-300"
                initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.8 } }}
              >
                <RotateCcw size={15} className="mr-1.5" strokeWidth={2}/>
                もう一度体験する
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>

        <footer className="fixed bottom-4 left-1/2 -translate-x-1/2 text-xs opacity-40 z-20" style={{ fontFamily: finalConfig.fontFamily.body }}>
          A heartfelt surprise for {finalConfig.recipientName}
        </footer>
      </main>
      
      <style jsx global>{`
        // Aurora Background
        .aurora-bg { 
            filter: blur(35px) contrast(1.15) brightness(0.95);
            z-index: -2; // Ensure it's furthest back
        }
        .aurora-layer {
          position: absolute;
          inset: -120px; 
          background-image: radial-gradient(ellipse at center, 
            rgba(var(--aurora-color-1-r, 139), var(--aurora-color-1-g, 92), var(--aurora-color-1-b, 246), 0.22) 0%,
            rgba(var(--aurora-color-1-r, 139), var(--aurora-color-1-g, 92), var(--aurora-color-1-b, 246), 0) 50%
          );
          opacity: 0.6;
          mix-blend-mode: screen; 
          animation: aurora-drift 28s infinite alternate ease-in-out;
        }
        .aurora-layer:nth-child(2) {
          background-image: radial-gradient(ellipse at center, 
            rgba(var(--aurora-color-2-r, 56), var(--aurora-color-2-g, 189), var(--aurora-color-2-b, 248), 0.22) 0%,
            rgba(var(--aurora-color-2-r, 56), var(--aurora-color-2-g, 189), var(--aurora-color-2-b, 248), 0) 50%
          );
          animation-duration: 33s;
          animation-delay: -8s;
           mix-blend-mode: lighten;
        }
        .aurora-layer:nth-child(3) {
          background-image: radial-gradient(ellipse at center, 
            rgba(var(--aurora-color-3-r, 52), var(--aurora-color-3-g, 211), var(--aurora-color-3-b, 153), 0.18) 0%,
            rgba(var(--aurora-color-3-r, 52), var(--aurora-color-3-g, 211), var(--aurora-color-3-b, 153), 0) 55%
          );
          animation-duration: 38s;
          animation-delay: -14s;
          mix-blend-mode: overlay;
        }
        @keyframes aurora-drift {
          0% { transform: rotate(0deg) scale(2) translateX(-20%) translateY(8%); }
          50% { transform: rotate(180deg) scale(2.5) translateX(15%) translateY(-12%); }
          100% { transform: rotate(360deg) scale(2) translateX(-20%) translateY(8%); }
        }
        
        // Starry Sky Background
        .starry-sky-bg { 
            background: linear-gradient(to bottom, #0c1424, #182338, #2d3a50);
            z-index: -2; // Ensure it's furthest back
        }

        body {
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          overscroll-behavior-y: contain; // Prevent pull-to-refresh on mobile
        }
        
        // CSS variables for Aurora colors (derived from finalConfig in JS)
        ${(() => {
          function hexToRgb(hexInput: string): { r: number, g: number, b: number } | null {
            let hex = hexInput;
            if (!hex.startsWith('#')) { // If not a direct hex, try to map from tailwind names
                const mappedHex = tailwindColorToHex[hexInput];
                if (mappedHex) hex = mappedHex;
                else return null; // Cannot resolve color
            }

            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return result ? {
              r: parseInt(result[1], 16),
              g: parseInt(result[2], 16),
              b: parseInt(result[3], 16)
            } : null;
          }

          const primaryRgb = hexToRgb(finalConfig.colors.primary);
          const secondaryRgb = hexToRgb(finalConfig.colors.secondary);
          const accentRgb = hexToRgb(finalConfig.colors.accent);

          return `
            :root {
              --aurora-color-1-r: ${primaryRgb?.r || 139};
              --aurora-color-1-g: ${primaryRgb?.g || 92};
              --aurora-color-1-b: ${primaryRgb?.b || 246};
              --aurora-color-2-r: ${secondaryRgb?.r || 56};
              --aurora-color-2-g: ${secondaryRgb?.g || 189};
              --aurora-color-2-b: ${secondaryRgb?.b || 248};
              --aurora-color-3-r: ${accentRgb?.r || 52};
              --aurora-color-3-g: ${accentRgb?.g || 211};
              --aurora-color-3-b: ${accentRgb?.b || 153};
            }
          `;
        })()}
      `}</style>
    </>
  );
};

export default BirthdaySurprisePage;
