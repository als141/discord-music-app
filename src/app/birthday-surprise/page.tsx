'use client';

import Head from 'next/head';
import { NextPage } from 'next';
import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';
import { Gift as GiftIconLucide, PartyPopper, Mail, ArrowRight, RotateCcw, Copy, Check, Heart, Sparkles, Wind, PackageOpen } from 'lucide-react'; // アイコン追加
import { Toaster, toast } from 'sonner';
import Confetti from 'react-confetti';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Tailwind CSSクラスのマージを容易にするユーティリティ関数
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ☆★☆ 設定 ☆★☆
const birthdayConfig = {
  recipientName: process.env.NEXT_PUBLIC_RECIPIENT_NAME,
  senderName: process.env.NEXT_PUBLIC_SENDER_NAME,
  greetingTitle: process.env.NEXT_PUBLIC_GREETING_TITLE,
  mainMessage: process.env.NEXT_PUBLIC_MAIN_MESSAGE,
  giftTeaser: process.env.NEXT_PUBLIC_GIFT_TEASER,
  giftUrl: process.env.NEXT_PUBLIC_GIFT_URL,
  giftLinkText: process.env.NEXT_PUBLIC_GIFT_LINK_TEXT,
  finalMessage: process.env.NEXT_PUBLIC_FINAL_MESSAGE,

  theme: 'dreamy_aurora', // 'light_elegant', 'dark_modern', 'pop_funky', 'dreamy_aurora', 'starry_night', 'sleek_modern'
  fontFamily: {
    heading: "'Manrope', sans-serif",
    body: "'Inter', sans-serif",
    messageCard: "'Dancing Script', cursive",
  },
  colors: { // テーマで上書きされるがフォールバックとして定義
    primary: '#8B5CF6',
    secondary: '#EC4899',
    accent: '#F59E0B',
    textBase: '#374151',
    cardBg: '#FFFFFF',
  },
  background: { // テーマで上書き
    type: 'gradient',
    gradientDirection: 'to-br',
    gradientColors: ['from-indigo-300', 'via-purple-400', 'to-pink-400'],
    showParticles: true,
  },
  animationStyle: 'dynamic', // 'subtle' or 'dynamic'
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

const tailwindColorToHex: Record<string, string> = {
  'purple-500': '#a855f7', 'pink-500': '#ec4899', 'amber-400': '#f59e0b', 'rose-600': '#e11d48',
  'amber-500': '#f59e0b', 'teal-500': '#14b8a6', 'cyan-400': '#22d3ee', 'purple-400': '#c084fc',
  'lime-400': '#a3e63e', 'lime-500': '#84cc16', 'fuchsia-500': '#d946ef', 'sky-400': '#38bdf8',
  'violet-400': '#a78bfa', 'sky-300': '#7dd3fc', 'emerald-400': '#34d399', 'yellow-300': '#fde047',
  'blue-400': '#60a5fa', 'purple-300': '#d8b4fe', 'slate-200': '#e2e8f0', 'sky-500': '#0ea5e9',
  'rose-500': '#f43f5e', 'gray-700': '#374151', 'gray-100': '#F3F4F6', 'white': '#FFFFFF',
  'gray-800': '#1F2937', 'indigo-300': '#a5b4fc', 'pink-400': '#f472b6', 'rose-100': '#ffe4e6',
  'orange-50': '#fff7ed', 'yellow-100': '#fef9c3', 'gray-900': '#111827', 'purple-900': '#581c87',
  'blue-900': '#1e3a8a', 'orange-400': '#fb923c', 'red-400': '#f87171', 'indigo-800': '#3730a3',
  'purple-700': '#7e22ce', 'pink-700': '#be185d', 'slate-800': '#1e293b', 'slate-50': '#f8fafc',
  'gray-200': '#e5e7eb', 'gray-950': '#030712', 'gray-50': '#f9fafb',
};

const themes: Record<string, {
  colors: { primary: string, secondary: string, accent: string, textBase: string, cardBg: string, textBaseTailwind: string, cardBgTailwind: string },
  background: { gradientColors?: string[], type?: string, gradientDirection?: string, baseColor?: string },
  fontFamily: { [key: string]: string },
  confettiColors?: string[]
}> = {
  light_elegant: {
    colors: { primary: tailwindColorToHex['rose-600'], secondary: tailwindColorToHex['amber-500'], accent: tailwindColorToHex['teal-500'], textBase: tailwindColorToHex['gray-800'], cardBg: 'rgba(255,255,255,0.9)', textBaseTailwind: 'gray-800', cardBgTailwind: 'white' },
    background: { gradientColors: ['from-rose-100', 'via-orange-50', 'to-yellow-100'], type: 'gradient', baseColor: tailwindColorToHex['gray-50'] },
    fontFamily: { heading: "'Playfair Display', serif", body: "'Lato', sans-serif", messageCard: "'Parisienne', cursive" },
  },
  dark_modern: {
    colors: { primary: tailwindColorToHex['cyan-400'], secondary: tailwindColorToHex['purple-400'], accent: tailwindColorToHex['lime-400'], textBase: tailwindColorToHex['gray-100'], cardBg: 'rgba(31,41,55,0.8)', textBaseTailwind: 'gray-100', cardBgTailwind: 'gray-800' },
    background: { gradientColors: ['from-gray-900', 'via-purple-900', 'to-blue-900'], type: 'gradient', baseColor: tailwindColorToHex['gray-950'] },
    fontFamily: { heading: "'Orbitron', sans-serif", body: "'Roboto Mono', monospace", messageCard: "'Kalam', cursive" },
  },
  pop_funky: {
    colors: { primary: tailwindColorToHex['lime-500'], secondary: tailwindColorToHex['fuchsia-500'], accent: tailwindColorToHex['sky-400'], textBase: tailwindColorToHex['gray-800'], cardBg: 'rgba(254,249,195,0.9)', textBaseTailwind: 'gray-800', cardBgTailwind: 'yellow-100' },
    background: { gradientColors: ['from-yellow-300', 'via-orange-400', 'to-red-400'], type: 'gradient', baseColor: tailwindColorToHex['orange-50'] },
    fontFamily: { heading: "'Bangers', cursive", body: "'Comic Neue', cursive", messageCard: "'Gochi Hand', cursive" },
  },
  dreamy_aurora: {
    colors: { primary: tailwindColorToHex['violet-400'], secondary: tailwindColorToHex['sky-300'], accent: tailwindColorToHex['emerald-400'], textBase: '#FFFFFF', cardBg: 'rgba(25,15,60,0.65)', textBaseTailwind: 'white', cardBgTailwind: 'gray-900' },
    background: { type: 'animated_aurora', baseColor: tailwindColorToHex['gray-950'] },
    fontFamily: { heading: "'Manrope', sans-serif", body: "'Inter', sans-serif", messageCard: "'Satisfy', cursive" },
  },
  starry_night: {
    colors: { primary: tailwindColorToHex['yellow-300'], secondary: tailwindColorToHex['blue-400'], accent: tailwindColorToHex['purple-300'], textBase: tailwindColorToHex['gray-100'], cardBg: 'rgba(17,24,39,0.8)', textBaseTailwind: 'gray-100', cardBgTailwind: 'gray-900' },
    background: { type: 'starry_sky', baseColor: '#0c1424' },
    fontFamily: { heading: "'Righteous', cursive", body: "'Space Grotesk', sans-serif", messageCard: "'Cedarville Cursive', cursive" },
  },
  sleek_modern: {
    colors: { primary: tailwindColorToHex['slate-200'], secondary: tailwindColorToHex['sky-500'], accent: tailwindColorToHex['rose-500'], textBase: tailwindColorToHex['slate-800'], cardBg: 'rgba(255,255,255,0.85)', textBaseTailwind: 'slate-800', cardBgTailwind: 'white' },
    background: { gradientColors: ['from-slate-50', 'to-gray-200'], type: 'gradient', gradientDirection: 'to-b', baseColor: tailwindColorToHex['slate-50'] },
    fontFamily: { heading: "'Inter', sans-serif", body: "'Inter', sans-serif", messageCard: "'Caveat', cursive" },
  }
};

const currentThemeName = birthdayConfig.theme as keyof typeof themes;
const currentThemeSettings = themes[currentThemeName] || themes.dreamy_aurora;

const finalConfig = {
  ...birthdayConfig,
  colors: {
    primary: currentThemeSettings.colors.primary,
    secondary: currentThemeSettings.colors.secondary,
    accent: currentThemeSettings.colors.accent,
    textBase: currentThemeSettings.colors.textBase,
    cardBg: currentThemeSettings.colors.cardBg,
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

type Stage = 'initial_load' | 'invitation' | 'gift_interaction' | 'unveiling' | 'revealed';

// トークンごとのアニメーション用コンポーネント
const TypewriterText = ({ text, delay = 0, className = "" }: { text: string, delay?: number, className?: string }) => {
  const [displayText, setDisplayText] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (!text) return;
    
    const timeout = setTimeout(() => {
      if (currentIndex < text.length) {
        setDisplayText(prev => prev + text[currentIndex]);
        setCurrentIndex(prev => prev + 1);
      }
    }, 50); // 各文字の表示間隔（ミリ秒）

    return () => clearTimeout(timeout);
  }, [currentIndex, text, delay]);

  return (
    <span className={className}>
      {displayText}
      <motion.span
        animate={{ opacity: [1, 0] }}
        transition={{ duration: 0.5, repeat: Infinity }}
        className="inline-block w-[2px] h-[1em] bg-current ml-[1px]"
      />
    </span>
  );
};

const BirthdaySurprisePage: NextPage = () => {
  const [stage, setStage] = useState<Stage>('initial_load');
  const [showConfetti, setShowConfetti] = useState(false);
  const [windowSize, setWindowSize] = useState({ width: 0, height: 0 });
  const [isGiftReady, setIsGiftReady] = useState(false); // 2Dギフトアイコン表示準備
  const [isGiftOpening, setIsGiftOpening] = useState(false); // 2Dギフト開封アニメーション中
  const [copied, setCopied] = useState(false);

  const messageCardControls = useAnimation();

  useEffect(() => {
    const fontFamilies = [finalConfig.fontFamily.heading, finalConfig.fontFamily.body, finalConfig.fontFamily.messageCard];
    const uniqueFontNames = [...new Set(fontFamilies.map(f => f.split(',')[0].replace(/'/g, '').replace(/ /g, '+')))];

    if (document && !document.getElementById('google-fonts-birthday')) {
      const fontLink = document.createElement('link');
      fontLink.id = 'google-fonts-birthday';
      fontLink.href = `https://fonts.googleapis.com/css2?family=${uniqueFontNames.join('&family=')}:wght@300;400;500;600;700;800&display=swap`;
      fontLink.rel = 'stylesheet';
      document.head.appendChild(fontLink);
    }

    const handleResize = () => setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    handleResize();
    window.addEventListener('resize', handleResize);

    const timer = setTimeout(() => {
      setStage('invitation');
    }, 1500);

    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timer);
    };
  }, []);

  const handleStartInteraction = () => {
    setStage('gift_interaction');
    setTimeout(() => {
      setIsGiftReady(true); // 2Dギフトアイコン表示準備完了
    }, 700);
  };

  // 2Dギフト開封処理
  const handleOpenGift2D = async () => {
    if (isGiftOpening) return;
    setIsGiftOpening(true); // 開封アニメーション開始

    // アイコンアニメーションの時間（例: 1.5秒）
    setTimeout(async () => {
      setStage('unveiling');
      setShowConfetti(true);
      try {
        await messageCardControls.start({
          opacity: 1, scale: 1, y: 0,
          transition: { duration: 1, delay: 0.5, type: 'spring', stiffness: 100, damping: 15 },
        });
        setStage('revealed');
      } catch (error) {
        console.error('Animation error:', error);
        setStage('revealed'); // エラー時もステージは進める
      }
      setTimeout(() => setShowConfetti(false), 8000);
    }, 1500); // アイコン開封アニメーションの時間
  };

  const handleCopyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      toast.success("ギフトURLがコピーされました！", { style: { fontFamily: finalConfig.fontFamily.body }});
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      toast.error("コピーに失敗しました。", { style: { fontFamily: finalConfig.fontFamily.body }});
    });
  };

  const handleSaveToEmail = () => {
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

  const handleReset = () => {
    setStage('initial_load');
    setShowConfetti(false);
    setIsGiftReady(false);
    setIsGiftOpening(false);
    messageCardControls.start({ opacity: 0, scale: 0.8, y: 50, transition: {duration: 0.1} });
    setTimeout(() => {
        setStage('invitation');
    }, 1500);
  };

  const isDarkThemeActive = useMemo(() => {
    return currentThemeName.startsWith('dark') || ['dreamy_aurora', 'starry_night'].includes(currentThemeName);
  }, []);

  const textBaseColorClass = `text-${finalConfig.colors.textBaseTailwind}`;

  const cardStyle = useMemo(() => {
    const cardBgColor = finalConfig.colors.cardBg;
    const styles: React.CSSProperties = {
      fontFamily: finalConfig.fontFamily.body,
      borderRadius: '1.75rem',
      boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
      padding: '2rem 2.5rem',
      backgroundColor: cardBgColor,
    };
    let classNames = 'relative z-10 w-full';

    if (cardBgColor.startsWith('rgba')) {
      styles.backdropFilter = 'blur(18px) saturate(150%)';
      styles.WebkitBackdropFilter = 'blur(18px) saturate(150%)';
      classNames = cn(classNames, isDarkThemeActive ? 'border border-white/10' : 'border border-black/5');
    }
    return { styles, classNames };
  }, [isDarkThemeActive]);


  const BackgroundParticles = () => {
    if (!finalConfig.background.showParticles || ['animated_aurora', 'starry_sky'].includes(finalConfig.background.type || '')) return null;
    const particleCount = finalConfig.animationStyle === 'dynamic' ? 70 : 30;
    return (
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-[-1]">
        {Array.from({ length: particleCount }).map((_, i) => (
          <motion.div
            key={i} className="absolute rounded-full"
            style={{
              left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%`,
              width: `${Math.random() * 2.5 + 0.5}px`, height: `${Math.random() * 2.5 + 0.5}px`,
              backgroundColor: `rgba(255,255,255,${Math.random() * 0.3 + 0.1})`, // 透明度をランダムに
              filter: 'blur(0.5px)',
            }}
            animate={{
              x: [0, (Math.random() - 0.5) * (finalConfig.animationStyle === 'dynamic' ? 50: 20), 0],
              y: [0, (Math.random() - 0.5) * (finalConfig.animationStyle === 'dynamic' ? 50: 20), 0],
              opacity: [0, Math.random() * 0.4 + 0.1, 0]
            }}
            transition={{
              duration: Math.random() * (finalConfig.animationStyle === 'dynamic' ? 20 : 30) + (finalConfig.animationStyle === 'dynamic' ? 15 : 20),
              repeat: Infinity,
              repeatType: 'mirror', ease: 'easeInOut', delay: Math.random() * 5
            }} />
        ))}
      </div>
    );
  };

  const AuroraBackground = () => (
    <div className="aurora-bg fixed inset-0 overflow-hidden pointer-events-none z-[-1]">
      <div className="aurora-layer"></div> <div className="aurora-layer"></div> <div className="aurora-layer"></div>
    </div>
  );

  const StarrySkyBackground = () => (
    <div className="starry-sky-bg fixed inset-0 overflow-hidden pointer-events-none z-[-1]">
      {Array.from({length: finalConfig.animationStyle === 'dynamic' ? 150 : 70}).map((_, i) => (
        <motion.div key={i} className="absolute bg-white rounded-full"
          style={{
            left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%`,
            width: `${Math.random() * 1.5 + 0.3}px`, height: `${Math.random() * 1.5 + 0.3}px`,
            opacity: Math.random() * 0.7 + 0.3, // 少し明るく
          }}
          animate={{ opacity: [Math.random() * 0.5 + 0.2, Math.random() * 0.8 + 0.3, Math.random() * 0.5 + 0.2] }}
          transition={{ duration: Math.random() * 5 + 4, repeat: Infinity, repeatType: "mirror", delay: Math.random() * 3 }} />
      ))}
    </div>
  );

  const buttonBaseClasses = "font-semibold text-base px-7 py-3.5 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out transform hover:-translate-y-1 flex items-center justify-center group focus:outline-none focus:ring-4 focus:ring-offset-1";
  const primaryButtonClasses = cn(buttonBaseClasses,
    `bg-gradient-to-r from-${finalConfig.colors.accentTailwind.replace('-400','-500')} to-${finalConfig.colors.accentTailwind}`,
    `hover:from-${finalConfig.colors.accentTailwind.replace('-400','-600')} hover:to-${finalConfig.colors.accentTailwind.replace('-400','-500')}`,
    `focus:ring-${finalConfig.colors.accentTailwind}/50`, // リングを少し透明に
    isDarkThemeActive ? 'text-gray-900' : 'text-white',
    'hover:scale-105' // ホバー時のスケールアップ
  );
  const secondaryButtonClasses = cn(buttonBaseClasses,
    `bg-${finalConfig.colors.primaryTailwind}`,
    `hover:bg-${finalConfig.colors.primaryTailwind.replace('-500','-600').replace('-400','-500')}`,
    `focus:ring-${finalConfig.colors.primaryTailwind}/50`,
    'text-white', 'hover:scale-105'
  );
  const tertiaryButtonClasses = cn(buttonBaseClasses,
    `bg-white/10 hover:bg-white/20 backdrop-blur-sm border border-white/20`,
    `focus:ring-white/30`,
    isDarkThemeActive ? `text-${finalConfig.colors.textBaseTailwind}` : `text-gray-700`,
    'px-5 py-2.5 text-sm', // 少し小さめのボタンに
    'hover:scale-105'
  );

  // gift_interaction ステージのコンテナに適用するキー
  const giftInteractionKey = `gift-interaction-container-${stage}-${isGiftReady}-${isGiftOpening}`;


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
          // テーマに応じた基本背景色を適用
          `bg-[${currentThemeSettings.background.baseColor || (isDarkThemeActive ? tailwindColorToHex['gray-950'] : tailwindColorToHex['gray-50'])}]`,
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
            width={windowSize.width} height={windowSize.height} colors={finalConfig.confetti.colors}
            numberOfPieces={finalConfig.confetti.numberOfPieces} recycle={finalConfig.confetti.recycle}
            gravity={finalConfig.confetti.gravity} initialVelocityX={finalConfig.confetti.initialVelocityX}
            initialVelocityY={finalConfig.confetti.initialVelocityY} tweenDuration={8000}
            className="fixed top-0 left-0 w-full h-full z-[100]" />
        )}

        <AnimatePresence mode="wait">
          {stage === 'initial_load' && (
            <motion.div key="loader" className="flex flex-col items-center"
              initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
              transition={{ type: 'spring', stiffness: 150, damping: 20}} >
              <Heart size={80} className="animate-pulse drop-shadow-lg" strokeWidth={1.5} style={{color: finalConfig.colors.primary}}/>
              <p className="mt-6 text-lg font-medium tracking-wider">準備中...</p>
            </motion.div>
          )}

          {stage === 'invitation' && (
            <motion.div key="invitation"
              initial={{ opacity: 0, y: 60, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.8, type: 'spring', stiffness: 120, damping: 18, delay: 0.1 } }}
              exit={{ opacity: 0, y: -40, scale: 0.9, transition: { duration: 0.5, ease: 'anticipate' } }}
              className={cn(`text-center max-w-md md:max-w-lg shadow-2xl`, cardStyle.classNames)} style={cardStyle.styles} >
              <motion.h1
                style={{ fontFamily: finalConfig.fontFamily.heading, fontWeight: 700, color: finalConfig.colors.primary }}
                className="text-5xl md:text-6xl font-bold mb-4 drop-shadow-md" // サイズとドロップシャドウ調整
                initial={{ opacity:0, scale:0.7}} animate={{opacity:1, scale:1, transition:{delay:0.2, duration:0.7, type: 'spring'}}} >
                {finalConfig.greetingTitle}
              </motion.h1>
              <motion.p
                style={{ fontFamily: finalConfig.fontFamily.heading, fontWeight: 600, color: finalConfig.colors.secondary }}
                className="text-3xl md:text-4xl mb-8 font-semibold drop-shadow-sm" // サイズ調整
                initial={{ opacity:0, y:15}} animate={{opacity:1, y:0, transition:{delay:0.35, duration:0.6}}} >
                {finalConfig.recipientName}！
              </motion.p>
              <motion.p className="text-md md:text-lg mb-12 whitespace-pre-line leading-relaxed"
                initial={{opacity:0}} animate={{opacity:1, transition:{delay:0.5, duration:0.5}}} >
                <TypewriterText text={finalConfig.mainMessage || ''} delay={0.7} />
              </motion.p>
              <motion.button onClick={handleStartInteraction} className={cn(primaryButtonClasses, "w-full max-w-xs mx-auto")}
                style={{'--shadow-color': finalConfig.colors.accent} as React.CSSProperties} // CSS Variable for shadow
                whileHover={{ scale: 1.05, boxShadow: `0px 10px 30px -5px var(--shadow-color)` }} // よりリッチなホバーエフェクト
                whileTap={{ scale: 0.95 }}
                initial={{opacity:0, y:25}} animate={{opacity:1, y:0, transition:{delay:0.7, type:'spring', stiffness:150}}} >
                <Sparkles size={24} className="mr-3 group-hover:animate-spin" strokeWidth={2} />
                サプライズを見る
                <ArrowRight size={24} className="ml-3 group-hover:translate-x-1.5 transition-transform" strokeWidth={2} />
              </motion.button>
            </motion.div>
          )}

          {stage === 'gift_interaction' && (
            <motion.div key={giftInteractionKey}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1, transition: { duration: 0.6, ease: 'easeOut' } }}
              exit={{ opacity: 0, scale: 0.9, y: 50, transition: { duration: 0.4, ease: 'easeIn' } }}
              className="flex flex-col items-center justify-center w-full max-w-md mx-auto text-center p-4 relative z-10 h-full"
            >
              <motion.p className="text-xl md:text-2xl mb-10 leading-relaxed"
                initial={{opacity:0, y:20}} animate={{opacity:1, y:0, transition:{delay:0.2, duration:0.5}}} >
                <TypewriterText text={finalConfig.giftTeaser || ''} delay={0.3} />
              </motion.p>

              <motion.div
                className="w-full flex-grow flex items-center justify-center relative cursor-pointer"
                onClick={!isGiftOpening ? handleOpenGift2D : undefined}
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{
                  opacity: isGiftReady ? 1 : 0,
                  scale: isGiftReady ? (isGiftOpening ? 1.2 : 1) : 0.5, // 開封中は少し拡大
                  rotate: isGiftOpening ? [0, 10, -10, 0] : 0, // 開封中に揺れるアニメーション
                  transition: { type: 'spring', stiffness: 100, damping: 10, delay: 0.1 }
                }}
              >
                {isGiftReady && (
                  <motion.div
                    animate={{ y: [0, -10, 0], transition: { duration: 1.5, repeat: Infinity, ease: "easeInOut" } }} // ふわふわ浮遊
                  >
                    {isGiftOpening ? (
                      <PackageOpen size={160} strokeWidth={1.2} style={{color: finalConfig.colors.accent}} className="drop-shadow-xl" />
                    ) : (
                      <GiftIconLucide size={150} strokeWidth={1.2} style={{color: finalConfig.colors.primary}} className="drop-shadow-xl" />
                    )}
                  </motion.div>
                )}
              </motion.div>

              {isGiftOpening && (
                <motion.p className="text-lg mt-8 font-medium"
                  initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.5 } }} >
                  開封中... ✨
                </motion.p>
              )}
               {!isGiftOpening && isGiftReady && (
                 <motion.p
                    className="mt-8 text-sm opacity-70 animate-pulse"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 0.7, transition: { delay: 1, duration: 0.5} }}
                >
                    タップして開けてね！
                </motion.p>
               )}
            </motion.div>
          )}

          {(stage === 'unveiling' || stage === 'revealed') && (
            <motion.div key="revealed_card_wrapper"
              initial="initial" animate="animate" exit="exit"
              variants={{
                initial: { opacity: 0, y: 50, scale: 0.95 },
                animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.8, type: 'spring', stiffness: 120, damping: 18, delay: stage === 'unveiling' ? 0.2 : 0 } },
                exit: { opacity: 0, y: -30, scale: 0.95, transition: { duration: 0.4, ease: 'anticipate' } }
              }}
              className={cn(`text-center max-w-lg md:max-w-xl shadow-2xl`, cardStyle.classNames)} style={cardStyle.styles} >
              <motion.div animate={stage === 'revealed' ? { opacity: 1, scale: 1, y: 0 } : messageCardControls}
                initial={{ opacity: 0, scale: 0.8, y: 30 }}
                transition={stage === 'revealed' ? { duration: 0.5 } : undefined} className="w-full" >
                <PartyPopper size={72} className="mx-auto mb-6 drop-shadow-lg" strokeWidth={1.5} style={{color: finalConfig.colors.accent}}/>
                <h2 className="text-4xl md:text-5xl font-bold mb-5 drop-shadow-md" style={{ fontFamily: finalConfig.fontFamily.heading, fontWeight: 700, color: finalConfig.colors.primary }}>
                  誕生日おめでとう！
                </h2>
                <div className="text-lg md:text-xl my-8 p-6 rounded-lg bg-black/5 dark:bg-white/5 shadow-inner whitespace-pre-line min-h-[120px] flex items-center justify-center"
                  style={{
                    fontFamily: finalConfig.fontFamily.messageCard, fontSize: '1.8rem', lineHeight: '2',
                    color: isDarkThemeActive ? finalConfig.colors.textBase : tailwindColorToHex['gray-700'],
                    WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale'
                  }} >
                  <div className="flex flex-col items-center gap-4">
                    <span>レジストレーションコード:</span>
                    <motion.button
                      onClick={() => finalConfig.finalMessage && handleCopyToClipboard(finalConfig.finalMessage)}
                      className="font-mono text-2xl tracking-wider px-6 py-3 rounded-lg bg-white/10 hover:bg-white/20 transition-colors duration-200 flex items-center gap-3 group"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <TypewriterText text={finalConfig.finalMessage || 'コードなし'} delay={1.2} />
                      <Copy size={20} className="opacity-50 group-hover:opacity-100 transition-opacity" />
                    </motion.button>
                  </div>
                </div>

                {finalConfig.giftUrl && finalConfig.giftUrl !== '#demo-gift' ? (
                  <motion.a href={finalConfig.giftUrl} target="_blank" rel="noopener noreferrer"
                    className={cn(secondaryButtonClasses, 'mb-7 text-md')} // margin調整
                    style={{'--shadow-color': finalConfig.colors.primary} as React.CSSProperties}
                    whileHover={{ scale: 1.05, boxShadow: `0px 8px 25px -3px var(--shadow-color)` }} whileTap={{ scale: 0.95 }} >
                    <Wind size={22} className="mr-2.5 group-hover:rotate-[360deg] transition-transform duration-700" strokeWidth={2}/>
                    <span>プレゼントを見る！</span>
                  </motion.a>
                ) : (
                  <motion.div className={cn("p-4 rounded-lg mb-7 text-md border-2 border-dashed flex items-center justify-center gap-2")}
                    style={{ borderColor: finalConfig.colors.accent, color: finalConfig.colors.accent }}
                    initial={{opacity:0, y:10}} animate={{opacity:1, y:0, transition:{delay:0.2}}} >
                    <PartyPopper size={26} strokeWidth={2}/>
                    これはデモンストレーション用の素敵なプレゼントです！
                  </motion.div>
                )}

                <div className="mt-8 flex flex-row flex-wrap justify-center items-center gap-3 sm:gap-4">
                  <motion.button onClick={handleSaveToEmail} className={tertiaryButtonClasses}
                    whileHover={{ scale: 1.05, y: -2 }} whileTap={{ scale: 0.95 }} >
                    <Mail size={18} className="mr-2" strokeWidth={2}/> メールで保存
                  </motion.button>
                  {finalConfig.giftUrl && finalConfig.giftUrl !== '#demo-gift' && (
                    <motion.button onClick={() => handleCopyToClipboard(finalConfig.giftUrl as string)} className={cn(tertiaryButtonClasses)}
                      whileHover={{ scale: 1.05, y: -2 }} whileTap={{ scale: 0.95 }} >
                      {copied ? <Check size={18} className="mr-2 text-green-400" strokeWidth={3}/> : <Copy size={18} className="mr-2" strokeWidth={2}/>} URLをコピー
                    </motion.button>
                  )}
                </div>
                <p className="text-md font-medium mt-10" style={{ fontFamily: finalConfig.fontFamily.body }}>
                  心からの感謝を込めて、<br/> <span className="font-semibold" style={{color: finalConfig.colors.secondary}}>{finalConfig.senderName}</span>
                </p>
              </motion.div>

              <motion.button onClick={handleReset}
                className="mt-10 flex items-center text-sm opacity-70 hover:opacity-100 transition-all duration-300 hover:text-[--dynamic-color]"
                style={{'--dynamic-color': finalConfig.colors.primary} as React.CSSProperties}
                initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.8 } }}
                whileHover={{scale: 1.1}} whileTap={{scale: 0.9}}
                >
                <RotateCcw size={16} className="mr-2" strokeWidth={2}/> もう一度体験する
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>

        <footer className="fixed bottom-4 left-1/2 -translate-x-1/2 text-xs opacity-50 z-20" style={{ fontFamily: finalConfig.fontFamily.body }}>
          A heartfelt surprise for {finalConfig.recipientName}
        </footer>
      </main>

      <style jsx global>{`
        .aurora-bg { filter: blur(40px) contrast(1.2) brightness(0.9); z-index: -1; } /* ブラー調整 */
        .aurora-layer {
          position: absolute; inset: -150px; /* 範囲拡大 */
          background-image: radial-gradient(ellipse at center,
            rgba(var(--aurora-color-1-r, 139), var(--aurora-color-1-g, 92), var(--aurora-color-1-b, 246), 0.25) 0%, /* 透明度調整 */
            rgba(var(--aurora-color-1-r, 139), var(--aurora-color-1-g, 92), var(--aurora-color-1-b, 246), 0) 55% );
          opacity: ${finalConfig.animationStyle === 'dynamic' ? 0.7 : 0.5}; /* アニメーションスタイルで透明度変更 */
          mix-blend-mode: screen;
          animation: aurora-drift ${finalConfig.animationStyle === 'dynamic' ? '25s' : '40s'} infinite alternate ease-in-out;
        }
        .aurora-layer:nth-child(2) {
          background-image: radial-gradient(ellipse at center,
            rgba(var(--aurora-color-2-r, 56), var(--aurora-color-2-g, 189), var(--aurora-color-2-b, 248), 0.25) 0%,
            rgba(var(--aurora-color-2-r, 56), var(--aurora-color-2-g, 189), var(--aurora-color-2-b, 248), 0) 55% );
          animation-duration: ${finalConfig.animationStyle === 'dynamic' ? '30s' : '45s'}; animation-delay: -7s; mix-blend-mode: lighten;
        }
        .aurora-layer:nth-child(3) {
          background-image: radial-gradient(ellipse at center,
            rgba(var(--aurora-color-3-r, 52), var(--aurora-color-3-g, 211), var(--aurora-color-3-b, 153), 0.20) 0%,
            rgba(var(--aurora-color-3-r, 52), var(--aurora-color-3-g, 211), var(--aurora-color-3-b, 153), 0) 60% );
          animation-duration: ${finalConfig.animationStyle === 'dynamic' ? '35s' : '50s'}; animation-delay: -12s; mix-blend-mode: overlay;
        }
        @keyframes aurora-drift {
          0% { transform: rotate(0deg) scale(2.2) translateX(-15%) translateY(5%); }
          50% { transform: rotate(180deg) scale(2.8) translateX(10%) translateY(-10%); }
          100% { transform: rotate(360deg) scale(2.2) translateX(-15%) translateY(5%); }
        }
        .starry-sky-bg { background: linear-gradient(to bottom, #0a101a, #121828, #20283a); z-index: -1; } /* 色調整 */
        body {
          margin: 0;
          padding: 0;
          -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
          overscroll-behavior-y: contain;
          background-color: ${currentThemeSettings.background.baseColor || (isDarkThemeActive ? tailwindColorToHex['gray-950'] : tailwindColorToHex['gray-50'])};
        }
        html, body, #__next {
            height: 100%;
        }
        /* gift_interactionステージのコンテナが中央に配置されるように */
        div[key^="gift-interaction-container-"] {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%; /* 親要素の高さに依存 */
            width: 100%;
        }
         /* gift_interactionステージ内のアイコンコンテナ */
        div[key^="gift-interaction-container-"] > div:nth-child(2) { /* motion.p の次 */
            flex-grow: 1; /* 利用可能なスペースを埋める */
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
        }


        ${(() => {
          function hexToRgb(hexInput: string): { r: number, g: number, b: number } | null {
            let hex = hexInput;
            if (!hex.startsWith('#')) {
              const mappedHex = tailwindColorToHex[hexInput];
              if (mappedHex) hex = mappedHex; else return null;
            }
            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : null;
          }
          const primaryRgb = hexToRgb(finalConfig.colors.primary);
          const secondaryRgb = hexToRgb(finalConfig.colors.secondary);
          const accentRgb = hexToRgb(finalConfig.colors.accent);
          return `
            :root {
              --aurora-color-1-r: ${primaryRgb?.r || 139}; --aurora-color-1-g: ${primaryRgb?.g || 92}; --aurora-color-1-b: ${primaryRgb?.b || 246};
              --aurora-color-2-r: ${secondaryRgb?.r || 56}; --aurora-color-2-g: ${secondaryRgb?.g || 189}; --aurora-color-2-b: ${secondaryRgb?.b || 248};
              --aurora-color-3-r: ${accentRgb?.r || 52}; --aurora-color-3-g: ${accentRgb?.g || 211}; --aurora-color-3-b: ${accentRgb?.b || 153};
            }`;
        })()}
      `}</style>
    </>
  );
};

export default BirthdaySurprisePage;
