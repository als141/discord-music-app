import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from '@/components/ui/progress';
import axios from 'axios';

import {
  Swords,
  Store,
  Users,
  Clock,
  TrendingUp,
  ChevronsRight,
} from 'lucide-react';

interface ValorantPlayer {
  id: string;
  name: string;
  tagLine: string;
  rank: {
    tier: number;
    division: string;
    rr: number;
  };
  stats: {
    winRate: number;
    kda: number;
    headshotPercentage: number;
    mostPlayedAgent: string;
  };
  cardId: string;
  recentMatches: ValorantMatch[];
}

interface ValorantMatch {
  id: string;
  agent: string;
  map: string;
  mode: string;
  result: 'victory' | 'defeat';
  score: string;
  kills: number;
  deaths: number;
  assists: number;
  kda: number;
  hsPercentage: number;
  timestamp: string;
}

interface AgentData {
  icon: string;
  portrait: string;
  role: string;
}

const mockPlayers: ValorantPlayer[] = [
  {
    id: '1',
    name: 'als0028',
    tagLine: '#JP1',
    rank: {
      tier: 21,
      division: '2',
      rr: 67
    },
    stats: {
      winRate: 88.5,
      kda: 8.45,
      headshotPercentage: 0.5,
      mostPlayedAgent: 'add6443a-41bd-e414-f6ad-e58d267f4e95'
    },
    cardId: '9fb348bc-41a0-91ad-8a3e-818035c4e561',
    recentMatches: [
      {
        id: 'm1',
        agent: 'add6443a-41bd-e414-f6ad-e58d267f4e95',
        map: 'アセント',
        mode: 'コンペティティブ',
        result: 'victory',
        score: '13-8',
        kills: 24,
        deaths: 144,
        assists: 3,
        kda: 1.93,
        hsPercentage: 32,
        timestamp: '2h ago'
      }
    ]
  }
];

const mockStore = {
  daily: [
    {
      id: '1',
      name: 'ChronoVoid Phantom',
      type: 'Rifle',
      price: 1775,
      image: 'https://media.valorant-api.com/weaponskinchromas/6a203339-4efb-55fd-3473-b59503c224b2/fullrender.png',
      rarity: 'Premium'
    },
    {
      id: '2',
      name: 'Undercity Phantom',
      type: 'Rifle',
      price: 1775,
      image: 'https://media.valorant-api.com/weaponskinchromas/13c7d77d-4b4a-22bd-e886-ab8bda1fb1b5/fullrender.png',
      rarity: 'Premium'
    }
  ]
};

export const VALORANTScreen: React.FC = () => {
  const [selectedPlayer, setSelectedPlayer] = useState<ValorantPlayer | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [rankImages, setRankImages] = useState<Record<number, string>>({});
  const [agentImages, setAgentImages] = useState<Record<string, AgentData>>({});
  const [playerCards, setPlayerCards] = useState<Record<string, string>>({});

  useEffect(() => {
    const fetchRankImages = async () => {
      try {
        const response = await axios.get('https://valorant-api.com/v1/competitivetiers');
        const latestSeason = response.data.data[response.data.data.length - 1];
        const images: Record<number, string> = {};
        latestSeason.tiers.forEach((tier: { tier: number; largeIcon: string }) => {
          images[tier.tier] = tier.largeIcon;
        });
        setRankImages(images);
      } catch (error) {
        console.error('Failed to fetch rank images:', error);
      }
    };

    const fetchAgentImages = async () => {
      try {
        const response = await axios.get('https://valorant-api.com/v1/agents?isPlayableCharacter=true');
        const agents: Record<string, AgentData> = {};
        response.data.data.forEach((agent: { uuid: string; displayIcon: string; fullPortrait: string; role: { displayName: string } }) => {
          agents[agent.uuid] = {
            icon: agent.displayIcon,
            portrait: agent.fullPortrait,
            role: agent.role.displayName
          };
        });
        setAgentImages(agents);
      } catch (error) {
        console.error('Failed to fetch agent images:', error);
      }
    };

    const fetchPlayerCards = async () => {
      try {
        const response = await axios.get('https://valorant-api.com/v1/playercards');
        const cards: Record<string, string> = {};
        response.data.data.forEach((card: { uuid: string; largeArt: string }) => {
          cards[card.uuid] = card.largeArt;
        });
        setPlayerCards(cards);
      } catch (error) {
        console.error('Failed to fetch player cards:', error);
      }
    };

    fetchRankImages();
    fetchAgentImages();
    fetchPlayerCards();
  }, []);

  const PlayerCard: React.FC<{ player: ValorantPlayer }> = ({ player }) => (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 20 },
        visible: { opacity: 1, y: 0 }
      }}
      whileTap={{ scale: 0.98 }}
      onClick={() => {
        setSelectedPlayer(player);
        setIsDrawerOpen(true);
      }}
      className="w-[280px] p-4 bg-card rounded-xl shadow-lg cursor-pointer active:bg-accent/50 transition-all duration-200 relative"
    >
      <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 to-purple-500/5 rounded-xl" />
      <div className="flex items-center gap-4 relative">
        {playerCards[player.cardId] && (
          <Image 
            src={playerCards[player.cardId]} 
            alt={player.name}
            width={64}
            height={64}
            className="rounded-full object-cover"
          />
        )}
        <div className="flex-1">
          <div className="font-bold text-lg">{player.name}</div>
          <div className="text-sm text-muted-foreground">{player.tagLine}</div>
          <div className="flex items-center gap-2 mt-1">
            {rankImages[player.rank.tier] && (
              <Image 
                src={rankImages[player.rank.tier]} 
                alt={`Rank ${player.rank.tier}`}
                width={24}
                height={24}
              />
            )}
            <span className="text-sm">{`${player.rank.tier} - ${player.rank.rr}RR`}</span>
          </div>
        </div>
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-accent/30">
          <ChevronsRight className="w-5 h-5 text-muted-foreground" />
        </div>
      </div>
    </motion.div>
  );

  const PlayerStatsDrawer: React.FC = () => {
    if (!selectedPlayer) return null;

    return (
      <Sheet open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {playerCards[selectedPlayer.cardId] && (
                  <Image 
                    src={playerCards[selectedPlayer.cardId]} 
                    alt={selectedPlayer.name}
                    width={48}
                    height={48}
                    className="rounded-full"
                  />
                )}
                <div>
                  <div className="text-xl font-bold">{selectedPlayer.name}</div>
                  <div className="text-sm text-muted-foreground">{selectedPlayer.tagLine}</div>
                </div>
              </div>
            </SheetTitle>
          </SheetHeader>

          <Tabs defaultValue="overview" className="mt-6">
            <TabsList className="grid grid-cols-2">
              <TabsTrigger value="overview" className="gap-2">
                <TrendingUp className="w-4 h-4" />
                Overview
              </TabsTrigger>
              <TabsTrigger value="matches" className="gap-2">
                <Swords className="w-4 h-4" />
                Matches
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-4 space-y-4">
              <Card className="p-4">
                <div className="flex items-center gap-4 mb-4">
                  {agentImages[selectedPlayer.stats.mostPlayedAgent] && (
                    <Image
                      src={agentImages[selectedPlayer.stats.mostPlayedAgent].portrait}
                      alt="Most Played Agent"
                      width={96}
                      height={96}
                      className="rounded-lg"
                    />
                  )}
                  <div>
                    <div className="font-semibold text-lg">Most Played Agent</div>
                    <div className="text-sm text-muted-foreground">
                      {agentImages[selectedPlayer.stats.mostPlayedAgent]?.role || 'Unknown Role'}
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between mb-2">
                      <span>Win Rate</span>
                      <span>{selectedPlayer.stats.winRate}%</span>
                    </div>
                    <Progress value={selectedPlayer.stats.winRate} className="h-2" />
                  </div>

                  <div>
                    <div className="flex justify-between mb-2">
                      <span>Headshot %</span>
                      <span>{selectedPlayer.stats.headshotPercentage}%</span>
                    </div>
                    <Progress value={selectedPlayer.stats.headshotPercentage} className="h-2" />
                  </div>

                  <div className="flex justify-between text-sm">
                    <span>KDA Ratio</span>
                    <span>{selectedPlayer.stats.kda}</span>
                  </div>
                </div>
              </Card>
            </TabsContent>

            <TabsContent value="matches" className="mt-4">
              <div className="space-y-4">
                {selectedPlayer.recentMatches.map((match) => (
                  <Card key={match.id} className="p-4">
                    <div className="flex justify-between items-center">
                      <div>
                        <div className="font-semibold">{match.map}</div>
                        <div className="text-sm text-muted-foreground">{match.mode}</div>
                      </div>
                      <div className={`text-sm ${
                        match.result === 'victory' ? 'text-green-500' : 'text-red-500'
                      }`}>
                        {match.result.toUpperCase()}
                      </div>
                    </div>
                    <div className="mt-2 flex justify-between items-center">
                      <div className="flex gap-2 items-center">
                        {agentImages[match.agent] && (
                          <Image
                            src={agentImages[match.agent].icon}
                            alt="Agent"
                            width={32}
                            height={32}
                          />
                        )}
                        <div className="text-sm">
                          {match.kills}/{match.deaths}/{match.assists}
                        </div>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {match.timestamp}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>
    );
  };

  const StoreSection = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Store className="w-5 h-5" />
          Daily Store
        </h3>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="w-4 h-4" />
          12h
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {mockStore.daily.map((item) => (
          <Card key={item.id} className="overflow-hidden">
            <div className="h-40 relative bg-black">
              <Image
                src={item.image}
                alt={item.name}
                width={400}
                height={160}
                className="w-full h-full object-contain"
              />
            </div>
            <div className="p-3">
              <div className="font-semibold truncate">{item.name}</div>
              <div className="text-sm text-muted-foreground">{item.price} VP</div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-full bg-gradient-to-br from-red-500/5 to-violet-500/5 p-4 space-y-6"
    >
      <div className="text-center text-sm text-gray-500">
        お試しモード
        <br />
        この機能はバージョン 1.0.0 でリリース予定です
      </div>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6" />
            Team Members
          </h2>
        </div>
        <ScrollArea className="h-[280px]">
          <div className="flex flex-wrap gap-4">
            <AnimatePresence>
              {mockPlayers.map((player) => (
                <PlayerCard key={player.id} player={player} />
              ))}
            </AnimatePresence>
          </div>
        </ScrollArea>
      </section>

      <section>
        <StoreSection />
      </section>

      <PlayerStatsDrawer />
    </motion.div>
  );
};

export default VALORANTScreen;