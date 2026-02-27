/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Trophy, 
  RotateCcw, 
  Play, 
  Pause, 
  Keyboard, 
  Settings, 
  Info,
  ChevronDown,
  Sparkles,
  Zap
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { COMMON_WORDS } from './wordlist';
import { GoogleGenAI } from "@google/genai";

// --- Constants ---
const COLS = 10;
const ROWS = 20;
const INITIAL_DROP_SPEED = 800; // ms

const SHAPES = {
  I: [[0, 0], [-1, 0], [1, 0], [2, 0]],
  J: [[0, 0], [-1, 0], [1, 0], [1, 1]],
  L: [[0, 0], [-1, 0], [1, 0], [-1, 1]],
  O: [[0, 0], [1, 0], [0, 1], [1, 1]],
  S: [[0, 0], [1, 0], [0, 1], [-1, 1]],
  T: [[0, 0], [-1, 0], [1, 0], [0, 1]],
  Z: [[0, 0], [-1, 0], [0, 1], [1, 1]],
};

type ShapeType = keyof typeof SHAPES;

type ActivePiece = {
  x: number;
  y: number;
  shape: number[][];
  chars: string[];
  type: ShapeType;
};

type Cell = {
  char: string;
  isWordPart: boolean;
  id: string;
} | null;

type GameState = 'START' | 'PLAYING' | 'PAUSED' | 'GAMEOVER' | 'LEVEL_UP';

const VOWELS = 'AEIOU';
const CONSONANTS = 'BCDFGHJKLMNPQRSTVWXYZ';

const getRandomLetter = () => {
  const isVowel = Math.random() < 0.4;
  const source = isVowel ? VOWELS : CONSONANTS;
  return source[Math.floor(Math.random() * source.length)];
};

export default function App() {
  // --- State ---
  const [grid, setGrid] = useState<Cell[][]>(
    Array.from({ length: ROWS }, () => Array(COLS).fill(null))
  );
  const [activePiece, setActivePiece] = useState<ActivePiece | null>(null);
  const [nextPiece, setNextPiece] = useState<ActivePiece | null>(null);
  const [gameState, setGameState] = useState<GameState>('START');
  const [score, setScore] = useState(0);
  const [wordsFound, setWordsFound] = useState<string[]>([]);
  const [level, setLevel] = useState(1);
  const [targetWords, setTargetWords] = useState(5);
  const [dropSpeed, setDropSpeed] = useState(INITIAL_DROP_SPEED);
  const [aiHint, setAiHint] = useState<string | null>(null);
  const [vowelProgress, setVowelProgress] = useState<Record<string, number>>({
    A: 0, E: 0, I: 0, O: 0, U: 0
  });
  const [powerMessage, setPowerMessage] = useState<string | null>(null);

  const gameLoopRef = useRef<number | null>(null);
  const lastDropTimeRef = useRef<number>(0);
  const gridRef = useRef<Cell[][]>(grid);

  // Sync ref with state for use in callbacks
  useEffect(() => {
    gridRef.current = grid;
  }, [grid]);

  // --- Logic ---

  const createPiece = useCallback((): ActivePiece => {
    const keys = Object.keys(SHAPES) as ShapeType[];
    const type = keys[Math.floor(Math.random() * keys.length)];
    const shape = SHAPES[type];
    const chars = shape.map(() => getRandomLetter());
    return {
      x: Math.floor(COLS / 2),
      y: 0,
      shape,
      chars,
      type
    };
  }, []);

  const spawnPiece = useCallback(() => {
    const piece = nextPiece || createPiece();
    const newNext = createPiece();

    // Check collision at spawn
    const hasCollision = piece.shape.some(([dx, dy]) => {
      const nx = piece.x + dx;
      const ny = piece.y + dy;
      return ny >= 0 && ny < ROWS && nx >= 0 && nx < COLS && gridRef.current[ny][nx];
    });

    if (hasCollision) {
      setGameState('GAMEOVER');
      return;
    }

    setActivePiece(piece);
    setNextPiece(newNext);
  }, [nextPiece, createPiece]);

  const triggerPower = useCallback((vowel: string) => {
    setPowerMessage(`${vowel} POWER ACTIVATED!`);
    setTimeout(() => setPowerMessage(null), 2000);

    switch (vowel) {
      case 'A': // Annihilate: Clear bottom row
        setGrid(prev => {
          const newGrid = prev.map(row => [...row]);
          newGrid[ROWS - 1] = Array(COLS).fill(null);
          // Apply gravity
          for (let c = 0; c < COLS; c++) {
            let emptyRow = ROWS - 1;
            for (let r = ROWS - 1; r >= 0; r--) {
              if (newGrid[r][c]) {
                const temp = newGrid[r][c];
                newGrid[r][c] = null;
                newGrid[emptyRow][c] = temp;
                emptyRow--;
              }
            }
          }
          return newGrid;
        });
        break;
      case 'E': // Enrich: Big score bonus
        setScore(prev => prev + 1000);
        confetti({ particleCount: 100, spread: 100 });
        break;
      case 'I': // Ice: Slow down for a bit
        const oldSpeed = dropSpeed;
        setDropSpeed(2000);
        setTimeout(() => setDropSpeed(oldSpeed), 10000);
        break;
      case 'O': // Orbit: Shuffle board
        setGrid(prev => {
          const letters = prev.flat().filter(c => c !== null);
          const shuffled = [...letters].sort(() => Math.random() - 0.5);
          const newGrid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
          
          // Fill from bottom up
          let idx = 0;
          for (let r = ROWS - 1; r >= 0; r--) {
            for (let c = 0; c < COLS; c++) {
              if (idx < shuffled.length) {
                newGrid[r][c] = shuffled[idx++];
              }
            }
          }
          return newGrid;
        });
        break;
      case 'U': // Upgrade: Turn 3 random consonants into vowels
        setGrid(prev => {
          const newGrid = prev.map(row => [...row]);
          const cells = [];
          for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
              if (newGrid[r][c] && !VOWELS.includes(newGrid[r][c]!.char)) {
                cells.push({ r, c });
              }
            }
          }
          const toChange = cells.sort(() => Math.random() - 0.5).slice(0, 3);
          toChange.forEach(({ r, c }) => {
            if (newGrid[r][c]) {
              newGrid[r][c]!.char = VOWELS[Math.floor(Math.random() * VOWELS.length)];
            }
          });
          return newGrid;
        });
        break;
    }
  }, [dropSpeed]);

  const checkWords = useCallback((currentGrid: Cell[][]) => {
    const foundWords: { word: string; cells: { r: number; c: number }[] }[] = [];
    const newGrid = currentGrid.map(row => row.map(cell => cell ? { ...cell, isWordPart: false } : null));
    const minLen = level <= 2 ? 2 : 3;

    // Horizontal check
    for (let r = 0; r < ROWS; r++) {
      let currentStr = "";
      let currentCells: { r: number; c: number }[] = [];
      for (let c = 0; c < COLS; c++) {
        const cell = newGrid[r][c];
        if (cell) {
          currentStr += cell.char;
          currentCells.push({ r, c });
        } else {
          if (currentStr.length >= minLen) {
            for (let i = 0; i <= currentStr.length - minLen; i++) {
              for (let j = i + minLen; j <= currentStr.length; j++) {
                const sub = currentStr.substring(i, j);
                if (COMMON_WORDS.includes(sub)) {
                  foundWords.push({ word: sub, cells: currentCells.slice(i, j) });
                }
              }
            }
          }
          currentStr = "";
          currentCells = [];
        }
      }
      if (currentStr.length >= minLen) {
        for (let i = 0; i <= currentStr.length - minLen; i++) {
          for (let j = i + minLen; j <= currentStr.length; j++) {
            const sub = currentStr.substring(i, j);
            if (COMMON_WORDS.includes(sub)) {
              foundWords.push({ word: sub, cells: currentCells.slice(i, j) });
            }
          }
        }
      }
    }

    // Vertical check
    for (let c = 0; c < COLS; c++) {
      let currentStr = "";
      let currentCells: { r: number; c: number }[] = [];
      for (let r = 0; r < ROWS; r++) {
        const cell = newGrid[r][c];
        if (cell) {
          currentStr += cell.char;
          currentCells.push({ r, c });
        } else {
          if (currentStr.length >= minLen) {
            for (let i = 0; i <= currentStr.length - minLen; i++) {
              for (let j = i + minLen; j <= currentStr.length; j++) {
                const sub = currentStr.substring(i, j);
                if (COMMON_WORDS.includes(sub)) {
                  foundWords.push({ word: sub, cells: currentCells.slice(i, j) });
                }
              }
            }
          }
          currentStr = "";
          currentCells = [];
        }
      }
      if (currentStr.length >= minLen) {
        for (let i = 0; i <= currentStr.length - minLen; i++) {
          for (let j = i + minLen; j <= currentStr.length; j++) {
            const sub = currentStr.substring(i, j);
            if (COMMON_WORDS.includes(sub)) {
              foundWords.push({ word: sub, cells: currentCells.slice(i, j) });
            }
          }
        }
      }
    }

    if (foundWords.length > 0) {
      foundWords.forEach(fw => {
        fw.cells.forEach(cell => {
          if (newGrid[cell.r][cell.c]) {
            newGrid[cell.r][cell.c]!.isWordPart = true;
          }
        });
      });

      const uniqueWords = Array.from(new Set(foundWords.map(fw => fw.word)));
      setWordsFound(prev => [...prev, ...uniqueWords]);
      
      // Track vowel usage
      const vowelsInWords = foundWords.flatMap(fw => fw.word.split('')).filter(char => VOWELS.includes(char));
      setVowelProgress(prev => {
        const next = { ...prev };
        vowelsInWords.forEach(v => {
          next[v] = (next[v] || 0) + 1;
          if (next[v] >= 3) {
            triggerPower(v);
            next[v] = 0;
          }
        });
        return next;
      });

      // Scoring based on word length
      const roundScore = foundWords.reduce((acc, fw) => {
        let base = fw.word.length * 10;
        if (fw.word.length === 2) base = 10;
        else if (fw.word.length === 3) base = 30;
        else if (fw.word.length === 4) base = 60;
        else if (fw.word.length === 5) base = 120;
        else if (fw.word.length >= 6) base = 300;
        
        // Bonus for rare letters
        const rareLetters = 'QZJX';
        const rareBonus = fw.word.split('').reduce((bonus, char) => 
          rareLetters.includes(char) ? bonus + 50 : bonus, 0);
        
        return acc + base + rareBonus;
      }, 0);

      setScore(prev => prev + roundScore);

      confetti({
        particleCount: 50,
        spread: 70,
        origin: { y: 0.6 }
      });

      setTimeout(() => {
        setGrid(prev => {
          const clearedGrid = prev.map(row => row.map(cell => cell?.isWordPart ? null : cell));
          for (let c = 0; c < COLS; c++) {
            let emptyRow = ROWS - 1;
            for (let r = ROWS - 1; r >= 0; r--) {
              if (clearedGrid[r][c]) {
                const temp = clearedGrid[r][c];
                clearedGrid[r][c] = null;
                clearedGrid[emptyRow][c] = temp;
                emptyRow--;
              }
            }
          }
          return clearedGrid;
        });
      }, 300);

      return true;
    }
    return false;
  }, []);

  const moveDown = useCallback(() => {
    if (!activePiece || gameState !== 'PLAYING') return;

    const nextY = activePiece.y + 1;
    const hasCollision = activePiece.shape.some(([dx, dy]) => {
      const nx = activePiece.x + dx;
      const ny = nextY + dy;
      return ny >= ROWS || (ny >= 0 && gridRef.current[ny][nx]);
    });

    if (!hasCollision) {
      setActivePiece(prev => prev ? { ...prev, y: nextY } : null);
    } else {
      const newGrid = [...gridRef.current.map(row => [...row])];
      activePiece.shape.forEach(([dx, dy], i) => {
        const nx = activePiece.x + dx;
        const ny = activePiece.y + dy;
        if (ny >= 0 && ny < ROWS && nx >= 0 && nx < COLS) {
          newGrid[ny][nx] = {
            char: activePiece.chars[i],
            isWordPart: false,
            id: Math.random().toString(36).substr(2, 9)
          };
        }
      });
      setGrid(newGrid);
      setActivePiece(null);
      
      if (!checkWords(newGrid)) {
        spawnPiece();
      } else {
        setTimeout(spawnPiece, 400);
      }
    }
  }, [activePiece, gameState, spawnPiece, checkWords]);

  const moveSide = useCallback((dir: number) => {
    if (!activePiece || gameState !== 'PLAYING') return;
    const nextX = activePiece.x + dir;
    const hasCollision = activePiece.shape.some(([dx, dy]) => {
      const nx = nextX + dx;
      const ny = activePiece.y + dy;
      return nx < 0 || nx >= COLS || (ny >= 0 && gridRef.current[ny][nx]);
    });

    if (!hasCollision) {
      setActivePiece(prev => prev ? { ...prev, x: nextX } : null);
    }
  }, [activePiece, gameState]);

  const rotate = useCallback(() => {
    if (!activePiece || gameState !== 'PLAYING' || activePiece.type === 'O') return;
    
    const newShape = activePiece.shape.map(([dx, dy]) => [-dy, dx]);
    const hasCollision = newShape.some(([dx, dy]) => {
      const nx = activePiece.x + dx;
      const ny = activePiece.y + dy;
      return nx < 0 || nx >= COLS || ny >= ROWS || (ny >= 0 && gridRef.current[ny][nx]);
    });

    if (!hasCollision) {
      setActivePiece(prev => prev ? { ...prev, shape: newShape } : null);
    }
  }, [activePiece, gameState]);

  const hardDrop = useCallback(() => {
    if (!activePiece || gameState !== 'PLAYING') return;
    let finalY = activePiece.y;
    while (true) {
      const nextY = finalY + 1;
      const hasCollision = activePiece.shape.some(([dx, dy]) => {
        const nx = activePiece.x + dx;
        const ny = nextY + dy;
        return ny >= ROWS || (ny >= 0 && gridRef.current[ny][nx]);
      });
      if (hasCollision) break;
      finalY++;
    }
    setActivePiece(prev => prev ? { ...prev, y: finalY } : null);
    setTimeout(moveDown, 0);
  }, [activePiece, gameState, moveDown]);

  // --- Gemini AI Integration ---
  const getAiHint = async () => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const currentLetters = gridRef.current.flat().filter(c => c !== null).map(c => c!.char).join(', ');
      
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `I'm playing a word game called Letteretris. The grid has these letters: ${currentLetters}. Can you suggest a 4-5 letter word I should try to build? Just give me the word in uppercase.`,
      });
      
      setAiHint(response.text?.trim().toUpperCase() || "FOCUS!");
    } catch (err) {
      console.error("AI Hint Error:", err);
    }
  };

  // --- Game Loop ---
  useEffect(() => {
    if (gameState === 'PLAYING') {
      const loop = (time: number) => {
        if (time - lastDropTimeRef.current > dropSpeed) {
          moveDown();
          lastDropTimeRef.current = time;
        }
        gameLoopRef.current = requestAnimationFrame(loop);
      };
      gameLoopRef.current = requestAnimationFrame(loop);
    } else {
      if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
    }
    return () => {
      if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
    };
  }, [gameState, dropSpeed, moveDown]);

  // --- Controls ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (gameState !== 'PLAYING') return;
      switch (e.key) {
        case 'ArrowLeft': moveSide(-1); break;
        case 'ArrowRight': moveSide(1); break;
        case 'ArrowDown': moveDown(); break;
        case 'ArrowUp': rotate(); break;
        case ' ': hardDrop(); break;
        case 'p': setGameState('PAUSED'); break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameState, moveSide, moveDown, hardDrop, rotate]);

  // --- Level Progression ---
  useEffect(() => {
    if (wordsFound.length >= targetWords * level) {
      setGameState('LEVEL_UP');
      setLevel(prev => prev + 1);
      setDropSpeed(prev => Math.max(200, prev - 100));
    }
  }, [wordsFound.length, targetWords, level]);

  const startGame = () => {
    setGrid(Array.from({ length: ROWS }, () => Array(COLS).fill(null)));
    setScore(0);
    setWordsFound([]);
    setLevel(1);
    setDropSpeed(INITIAL_DROP_SPEED);
    setVowelProgress({ A: 0, E: 0, I: 0, O: 0, U: 0 });
    setGameState('PLAYING');
    spawnPiece();
    getAiHint();
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-emerald-500/30 overflow-hidden flex flex-col items-center justify-center p-4">
      {/* Background Decorative Elements */}
      <div className="fixed inset-0 pointer-events-none opacity-20">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-500/20 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/20 blur-[120px] rounded-full" />
      </div>

      <div className="relative z-10 w-full max-w-5xl grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-8 items-start">
        
        {/* Left Sidebar: Stats & Info */}
        <div className="space-y-6 order-2 lg:order-1">
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-white/5 border border-white/10 p-6 rounded-2xl backdrop-blur-md"
          >
            <div className="flex items-center gap-3 mb-4 text-emerald-400">
              <Trophy size={20} />
              <h2 className="text-sm font-bold uppercase tracking-widest">Scoreboard</h2>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-xs text-white/40 uppercase tracking-tighter">Current Score</p>
                <p className="text-4xl font-black tracking-tighter">{score.toLocaleString()}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-white/40 uppercase tracking-tighter">Level</p>
                  <p className="text-2xl font-bold">{level}</p>
                </div>
                <div>
                  <p className="text-xs text-white/40 uppercase tracking-tighter">Words</p>
                  <p className="text-2xl font-bold">{wordsFound.length} / {targetWords * level}</p>
                </div>
              </div>
            </div>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white/5 border border-white/10 p-6 rounded-2xl backdrop-blur-md"
          >
            <div className="flex items-center gap-3 mb-4 text-purple-400">
              <ChevronDown size={20} />
              <h2 className="text-sm font-bold uppercase tracking-widest">Next Piece</h2>
            </div>
            <div className="flex items-center justify-center h-24 bg-black/20 rounded-xl">
              {nextPiece && (
                <div className="grid grid-cols-4 grid-rows-2 gap-1">
                  {nextPiece.shape.map(([dx, dy], i) => (
                    <div 
                      key={i}
                      className="w-6 h-6 bg-emerald-500 rounded-sm flex items-center justify-center text-[10px] font-black"
                      style={{ 
                        gridColumn: dx + 2, 
                        gridRow: dy + 1 
                      }}
                    >
                      {nextPiece.chars[i]}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white/5 border border-white/10 p-6 rounded-2xl backdrop-blur-md"
          >
            <div className="flex items-center gap-3 mb-4 text-blue-400">
              <Sparkles size={20} />
              <h2 className="text-sm font-bold uppercase tracking-widest">AI Strategist</h2>
            </div>
            <p className="text-xs text-white/60 mb-2">Gemini suggests building:</p>
            <div className="bg-blue-500/10 border border-blue-500/20 p-3 rounded-xl text-center">
              <p className="text-xl font-mono font-bold text-blue-300 tracking-[0.2em]">
                {aiHint || "THINKING..."}
              </p>
            </div>

            <div className="mt-6 space-y-3">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-white/40">Vowel Powers (3x to trigger)</h3>
              {Object.entries(vowelProgress).map(([v, count]) => (
                <div key={v} className="space-y-1">
                  <div className="flex justify-between text-[10px] font-mono">
                    <span className="text-white/60">{v}</span>
                    <span className="text-white/40">{count}/3</span>
                  </div>
                  <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                    <motion.div 
                      initial={false}
                      animate={{ width: `${(count / 3) * 100}%` }}
                      className={`h-full ${
                        v === 'A' ? 'bg-red-400' : 
                        v === 'E' ? 'bg-emerald-400' : 
                        v === 'I' ? 'bg-blue-400' : 
                        v === 'O' ? 'bg-orange-400' : 'bg-purple-400'
                      }`}
                    />
                  </div>
                </div>
              ))}
            </div>

            <p className="text-[10px] text-white/30 mt-4 text-center uppercase tracking-widest">
              Min Word Length: {level <= 2 ? 2 : 3}
            </p>
            <button 
              onClick={getAiHint}
              className="w-full mt-4 py-2 text-[10px] uppercase font-bold tracking-widest text-white/40 hover:text-white transition-colors"
            >
              Refresh Hint
            </button>
          </motion.div>
        </div>

        {/* Center: Game Board */}
        <div className="relative order-1 lg:order-2">
          <div className="bg-white/5 border-4 border-white/10 p-1 rounded-xl shadow-2xl relative overflow-hidden backdrop-blur-sm">
            <div 
              className="grid gap-[1px] bg-white/5"
              style={{ 
                gridTemplateColumns: `repeat(${COLS}, 1fr)`,
                width: 'min(80vw, 320px)',
                height: 'min(160vw, 640px)'
              }}
            >
              {grid.map((row, r) => 
                row.map((cell, c) => {
                  let char = cell?.char;
                  let isActive = false;
                  let isWordPart = cell?.isWordPart;

                  if (activePiece) {
                    const blockIndex = activePiece.shape.findIndex(([dx, dy]) => 
                      activePiece.x + dx === c && activePiece.y + dy === r
                    );
                    if (blockIndex !== -1) {
                      isActive = true;
                      char = activePiece.chars[blockIndex];
                    }
                  }

                  return (
                    <div 
                      key={`${r}-${c}`}
                      className={`
                        aspect-square flex items-center justify-center text-lg font-black rounded-sm transition-all duration-200
                        ${isActive ? 'bg-emerald-500 text-white scale-105 shadow-[0_0_15px_rgba(16,185,129,0.5)] z-10' : ''}
                        ${cell ? 'bg-white/10 text-white' : 'bg-transparent'}
                        ${isWordPart ? 'bg-yellow-500 text-black scale-95 animate-pulse' : ''}
                      `}
                    >
                      {char}
                    </div>
                  );
                })
              )}
            </div>

            {/* Overlays */}
            <AnimatePresence>
              {gameState === 'START' && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-20 bg-black/80 backdrop-blur-xl flex flex-col items-center justify-center p-8 text-center"
                >
                  <h1 className="text-5xl font-black tracking-tighter mb-2 italic">LETTERETRIS</h1>
                  <p className="text-white/60 text-sm mb-8 max-w-[200px]">Tetris meets Scrabble. Form words to survive.</p>
                  <button 
                    onClick={startGame}
                    className="group relative px-8 py-4 bg-emerald-500 text-black font-black rounded-full hover:scale-105 transition-transform flex items-center gap-2"
                  >
                    <Play fill="currentColor" size={20} />
                    START MISSION
                  </button>
                </motion.div>
              )}

              {gameState === 'PAUSED' && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-20 bg-black/60 backdrop-blur-md flex flex-col items-center justify-center"
                >
                  <h2 className="text-3xl font-black mb-6">PAUSED</h2>
                  <button 
                    onClick={() => setGameState('PLAYING')}
                    className="px-6 py-3 bg-white text-black font-bold rounded-full flex items-center gap-2"
                  >
                    <Play fill="currentColor" size={16} />
                    RESUME
                  </button>
                </motion.div>
              )}

              {gameState === 'GAMEOVER' && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="absolute inset-0 z-20 bg-red-500/90 backdrop-blur-xl flex flex-col items-center justify-center p-8 text-center"
                >
                  <h2 className="text-5xl font-black tracking-tighter mb-2">GAME OVER</h2>
                  <p className="text-2xl font-bold mb-8">Score: {score}</p>
                  <button 
                    onClick={startGame}
                    className="px-8 py-4 bg-white text-black font-black rounded-full flex items-center gap-2"
                  >
                    <RotateCcw size={20} />
                    TRY AGAIN
                  </button>
                </motion.div>
              )}

              {gameState === 'LEVEL_UP' && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="absolute inset-0 z-20 bg-emerald-500/90 backdrop-blur-xl flex flex-col items-center justify-center p-8 text-center"
                >
                  <Zap size={64} className="mb-4 animate-bounce" />
                  <h2 className="text-5xl font-black tracking-tighter mb-2">LEVEL UP!</h2>
                  <p className="text-xl font-bold mb-8">Speed Increased</p>
                  <button 
                    onClick={() => setGameState('PLAYING')}
                    className="px-8 py-4 bg-white text-black font-black rounded-full"
                  >
                    CONTINUE
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Power Activation Message */}
            <AnimatePresence>
              {powerMessage && (
                <motion.div 
                  initial={{ opacity: 0, y: 20, scale: 0.8 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.2 }}
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 bg-white text-black px-6 py-3 rounded-full font-black text-xl shadow-[0_0_30px_rgba(255,255,255,0.5)] pointer-events-none"
                >
                  {powerMessage}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          
          {/* Touch Controls */}
          <div className="lg:hidden mt-8 grid grid-cols-3 gap-4 w-full max-w-[320px]">
            <div />
            <button 
              onPointerDown={(e) => { e.preventDefault(); rotate(); }}
              className="p-6 bg-white/10 rounded-2xl flex items-center justify-center active:scale-90 transition-transform"
            >
              <RotateCcw size={24} />
            </button>
            <div />
            <button 
              onPointerDown={(e) => { e.preventDefault(); moveSide(-1); }}
              className="p-6 bg-white/10 rounded-2xl flex items-center justify-center active:scale-90 transition-transform"
            >
              <ChevronDown size={24} className="rotate-90" />
            </button>
            <button 
              onPointerDown={(e) => { e.preventDefault(); moveDown(); }}
              className="p-6 bg-white/10 rounded-2xl flex items-center justify-center active:scale-90 transition-transform"
            >
              <ChevronDown size={24} />
            </button>
            <button 
              onPointerDown={(e) => { e.preventDefault(); moveSide(1); }}
              className="p-6 bg-white/10 rounded-2xl flex items-center justify-center active:scale-90 transition-transform"
            >
              <ChevronDown size={24} className="-rotate-90" />
            </button>
            <div />
            <button 
              onPointerDown={(e) => { e.preventDefault(); hardDrop(); }}
              className="p-6 bg-emerald-500 text-black rounded-2xl flex items-center justify-center active:scale-90 transition-transform"
            >
              <Zap size={24} />
            </button>
            <div />
          </div>

          {/* Controls Hint (Desktop) */}
          <div className="hidden lg:flex mt-4 justify-center gap-4 text-white/20">
            <div className="flex items-center gap-1 text-[10px] uppercase font-bold tracking-widest">
              <Keyboard size={14} />
              Arrows to Move & Rotate
            </div>
            <div className="flex items-center gap-1 text-[10px] uppercase font-bold tracking-widest">
              <ChevronDown size={14} />
              Space to Drop
            </div>
          </div>
        </div>

        {/* Right Sidebar: Word List */}
        <div className="space-y-6 order-3">
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-white/5 border border-white/10 p-6 rounded-2xl backdrop-blur-md h-full max-h-[600px] flex flex-col"
          >
            <div className="flex items-center gap-3 mb-4 text-yellow-400">
              <Info size={20} />
              <h2 className="text-sm font-bold uppercase tracking-widest">Words Found</h2>
            </div>
            <div className="flex-1 overflow-y-auto pr-2 space-y-2 custom-scrollbar">
              {wordsFound.length === 0 ? (
                <p className="text-xs text-white/20 italic">No words found yet...</p>
              ) : (
                [...wordsFound].reverse().map((word, i) => (
                  <motion.div 
                    key={`${word}-${i}`}
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/5"
                  >
                    <span className="font-mono font-bold tracking-widest">{word}</span>
                    <span className="text-[10px] text-emerald-400 font-bold">+{word.length * 10}</span>
                  </motion.div>
                ))
              )}
            </div>
          </motion.div>

          <div className="grid grid-cols-2 gap-4">
            <button className="p-4 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-colors flex flex-col items-center gap-2">
              <Settings size={20} className="text-white/40" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Settings</span>
            </button>
            <button 
              onClick={() => setGameState('PAUSED')}
              className="p-4 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-colors flex flex-col items-center gap-2"
            >
              <Pause size={20} className="text-white/40" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Pause</span>
            </button>
          </div>
        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}</style>
    </div>
  );
}
