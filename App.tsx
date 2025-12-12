import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Pencil, Search, Loader2, Volume2, StopCircle, History, Trash2, ChevronRight, Video, Download, RefreshCw, VolumeX, Sparkles } from 'lucide-react';
import { generateSketchSteps, generateSpeech, regenerateSingleStep } from './services/geminiService';
import { getHistory, saveHistoryItem, deleteHistoryItem } from './services/storageService';
import { base64ToBytes, pcmToAudioBuffer } from './utils/audio';
import SketchCanvas, { SketchCanvasHandle } from './components/SketchCanvas';
import StepControls from './components/StepControls';
import { SketchStep, AppState, HistoryItem } from './types';

const App: React.FC = () => {
  const [query, setQuery] = useState('');
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [steps, setSteps] = useState<SketchStep[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  
  // Audio State
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  
  // Export State
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState('');
  
  // Regeneration State
  const [isRegenerating, setIsRegenerating] = useState(false);
  
  // History Dropdown State
  const [showDropdown, setShowDropdown] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  
  const canvasRef = useRef<SketchCanvasHandle>(null);

  // Audio References
  const audioContextRef = useRef<AudioContext | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  
  // Track current step in a ref to prevent race conditions in async audio playback
  const currentStepRef = useRef(currentStepIndex);
  
  // Cache keyed by text content (string)
  const audioCacheRef = useRef<Map<string, AudioBuffer>>(new Map()); 
  const audioLoadingPromisesRef = useRef<Map<string, Promise<AudioBuffer>>>(new Map()); 

  // Export References
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Initialize AudioContext lazily
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 24000});
    }
    return audioContextRef.current;
  }, []);

  // Load history on mount
  useEffect(() => {
    setHistory(getHistory());
  }, []);

  // Sync ref with state
  useEffect(() => {
    currentStepRef.current = currentStepIndex;
  }, [currentStepIndex]);

  // --- Audio Logic (Gemini TTS) ---

  const stopSpeaking = useCallback(() => {
    if (activeSourceRef.current) {
      activeSourceRef.current.stop();
      activeSourceRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  const getAudioKey = useCallback((step: SketchStep) => {
    return `${step.title.trim()}|${step.description.trim()}`;
  }, []);

  // Core function to load audio (checks cache -> checks in-flight -> generates)
  const ensureAudioLoaded = useCallback(async (index: number): Promise<AudioBuffer> => {
    // Fail fast if we know we are out of quota to prevent hammering API
    if (quotaExceeded) throw new Error("Quota exceeded");

    const step = steps[index];
    if (!step) throw new Error("Step not found");

    const key = getAudioKey(step);

    // 1. Check Cache
    if (audioCacheRef.current.has(key)) {
      return audioCacheRef.current.get(key)!;
    }

    // 2. Check In-Flight Promise (deduplicate requests)
    if (audioLoadingPromisesRef.current.has(key)) {
      return audioLoadingPromisesRef.current.get(key)!;
    }

    // 3. Generate New
    const promise = (async () => {
      try {
        const text = `${step.title}. ${step.description}`;
        const b64 = await generateSpeech(text);
        
        const ctx = getAudioContext(); 
        const bytes = base64ToBytes(b64);
        const buffer = pcmToAudioBuffer(bytes, ctx);
        
        audioCacheRef.current.set(key, buffer);
        return buffer;
      } catch (e: any) {
        console.error(`Failed to load audio for step ${index}`, e);
        
        // If we hit a persistent 429, set global flag to stop trying
        if (e?.status === 429 || e?.code === 429 || e?.message?.includes('429')) {
           setQuotaExceeded(true);
        }
        
        throw e;
      } finally {
        audioLoadingPromisesRef.current.delete(key);
      }
    })();

    audioLoadingPromisesRef.current.set(key, promise);
    return promise;
  }, [steps, getAudioContext, getAudioKey, quotaExceeded]);

  const playAudioForStep = useCallback(async (index: number) => {
    const step = steps[index];
    if (!step) return;

    if (quotaExceeded) return;

    stopSpeaking();

    try {
      const key = getAudioKey(step);
      
      // Optimistically set loading if not cached
      if (!audioCacheRef.current.has(key)) {
        setIsLoadingAudio(true);
      }

      const ctx = getAudioContext();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      const buffer = await ensureAudioLoaded(index);
      
      // CRITICAL: Check if the user is still on the same step that initiated the playback.
      // If the user navigated away while the audio was loading, do NOT start playback.
      if (index !== currentStepRef.current) {
        return;
      }

      setIsLoadingAudio(false);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      
      source.onended = () => {
        setIsSpeaking(false);
        activeSourceRef.current = null;
      };

      source.start();
      activeSourceRef.current = source;
      setIsSpeaking(true);

    } catch (err) {
      console.warn("Audio Playback aborted or failed");
      // If we are still on the same step, update UI
      if (index === currentStepRef.current) {
        setIsLoadingAudio(false);
        setIsSpeaking(false);
      }
    }
  }, [steps, getAudioContext, stopSpeaking, ensureAudioLoaded, getAudioKey, quotaExceeded]);

  const toggleSpeech = () => {
    if (isSpeaking) {
      stopSpeaking();
    } else {
      playAudioForStep(currentStepIndex);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopSpeaking();
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [stopSpeaking]);

  // --- Throttled Pre-fetch Logic ---
  useEffect(() => {
    if (appState === AppState.SUCCESS && steps.length > 0 && !quotaExceeded) {
      // Debounce the pre-fetch by 1.5 seconds.
      // This ensures we only pre-fetch if the user stays on a step for a bit.
      const timer = setTimeout(() => {
        const nextIndex = currentStepIndex + 1;
        // Only pre-fetch 1 step ahead (reduced from 2) to save quota
        if (nextIndex < steps.length) {
          ensureAudioLoaded(nextIndex).catch(() => {});
        }
      }, 1500);

      return () => clearTimeout(timer);
    }
  }, [currentStepIndex, appState, steps, ensureAudioLoaded, quotaExceeded]);


  // --- Auto Play Logic ---
  useEffect(() => {
    // Only auto-play if we are successful, have steps, not exporting, and have quota
    if (appState === AppState.SUCCESS && steps.length > 0 && !isExporting && !quotaExceeded) {
      const timer = setTimeout(() => {
        playAudioForStep(currentStepIndex);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [currentStepIndex, appState, steps, isExporting, playAudioForStep, quotaExceeded]);


  // --- Export Video Logic (Optimized) ---

  const handleExportVideo = async () => {
    if (steps.length === 0 || isExporting) return;
    
    stopSpeaking();
    setIsExporting(true);
    setExportProgress('Preparing Audio...');

    try {
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') await ctx.resume();
      
      const dest = ctx.createMediaStreamDestination();

      // 1. Ensure ALL audio buffers are cached
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const key = getAudioKey(step);
        if (!audioCacheRef.current.has(key)) {
          setExportProgress(`Generating Audio (${i + 1}/${steps.length})...`);
          try {
             await ensureAudioLoaded(i);
          } catch (e) {
             console.warn(`Could not load audio for step ${i}, continuing without audio.`);
          }
        }
      }

      // 2. Setup MediaRecorder
      setExportProgress('Starting Recording...');
      const canvasElement = canvasRef.current?.getCanvas();
      if (!canvasElement) throw new Error("Canvas not found");
      
      const canvasStream = canvasElement.captureStream(30); 
      const combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...dest.stream.getAudioTracks()
      ]);

      const recorder = new MediaRecorder(combinedStream, { 
        mimeType: 'video/webm; codecs=vp9',
        videoBitsPerSecond: 2500000 
      });
      chunksRef.current = [];
      
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sketchy-full-guide.webm`;
        a.click();
        URL.revokeObjectURL(url);
        
        setIsExporting(false);
        setExportProgress('');
      };

      mediaRecorderRef.current = recorder;
      recorder.start();

      // 3. Playback Sequence
      const playExportStep = (index: number) => {
        if (index >= steps.length) {
          setTimeout(() => mediaRecorderRef.current?.stop(), 1000);
          return;
        }

        setExportProgress(`Recording Step ${index + 1}/${steps.length}...`);
        setCurrentStepIndex(index);
        
        setTimeout(() => {
           canvasRef.current?.replay();
           
           const step = steps[index];
           const key = getAudioKey(step);
           const buffer = audioCacheRef.current.get(key);
           
           if (buffer) {
             const source = ctx.createBufferSource();
             source.buffer = buffer;
             source.connect(dest);
             source.connect(ctx.destination);
             source.onended = () => {
               setTimeout(() => playExportStep(index + 1), 1000);
             };
             source.start();
           } else {
             // If no audio (due to error/quota), just wait a fixed time (e.g., 5s)
             setTimeout(() => playExportStep(index + 1), 5000);
           }
        }, 100); 
      };

      playExportStep(0);

    } catch (err) {
      console.error("Export failed", err);
      setIsExporting(false);
      setExportProgress('');
      alert("Failed to export video. Please try again.");
    }
  };

  // --- Search Logic ---

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    stopSpeaking();
    setQuotaExceeded(false); 
    setShowDropdown(false);
    
    setAppState(AppState.LOADING);
    setSteps([]);
    setErrorMsg('');
    setCurrentStepIndex(0);

    try {
      const data = await generateSketchSteps(query);
      if (data.steps && data.steps.length > 0) {
        setSteps(data.steps);
        setAppState(AppState.SUCCESS);
        saveHistoryItem(query, data.steps);
        setHistory(getHistory());
      } else {
        throw new Error("No steps generated.");
      }
    } catch (err) {
      setAppState(AppState.ERROR);
      setErrorMsg("Failed to generate sketches. Please try a different query.");
    }
  };

  // --- History Logic ---

  const loadHistoryItem = (item: HistoryItem) => {
    stopSpeaking();
    setQuotaExceeded(false);
    setQuery(item.query);
    setSteps(item.steps);
    setCurrentStepIndex(0);
    setAppState(AppState.SUCCESS);
  };

  const deleteHistory = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deleteHistoryItem(id);
    setHistory(getHistory());
  };

  // --- Regenerate Logic ---

  const reGenerateSketch = async () => {
    const currentStepData = steps[currentStepIndex];
    if (!currentStepData || isRegenerating || isExporting) return;
    
    stopSpeaking();
    setIsRegenerating(true);
    try {
      const newCode = await regenerateSingleStep(currentStepData.title, currentStepData.description);
      
      const newSteps = [...steps];
      newSteps[currentStepIndex] = { ...currentStepData, code: newCode };
      setSteps(newSteps);
      
      saveHistoryItem(query, newSteps);
      setHistory(getHistory());
      
    } catch (e) {
      console.error("Regeneration failed", e);
    } finally {
      setIsRegenerating(false);
    }
  };

  const isIdle = appState === AppState.IDLE;
  const isSuccess = appState === AppState.SUCCESS;
  const isLoading = appState === AppState.LOADING;

  const currentStepData = steps[currentStepIndex];

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#f8f9fa] text-slate-800 font-sans">
      
      {/* Header */}
      <header className="shrink-0 w-full bg-white/90 backdrop-blur-md border-b border-slate-200 z-20">
        <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div 
            className="flex items-center gap-3 cursor-pointer group shrink-0" 
            onClick={() => { if(!isExporting) { stopSpeaking(); setAppState(AppState.IDLE); setQuery(''); } }}
          >
            {/* Logo updated to Blue */}
            <div className="bg-blue-600 text-white p-2 rounded-xl shadow-sm group-hover:scale-105 transition-transform">
              <Pencil size={20} />
            </div>
            <h1 className="hand-font text-2xl font-bold tracking-wide select-none text-slate-700 group-hover:text-blue-600 transition-colors hidden sm:block">
              AI Sketchy
            </h1>
          </div>

          {!isIdle && (
            <div className="flex-1 flex items-center justify-end gap-3 max-w-3xl">
               
               {/* Search Bar with History Dropdown */}
               <div className="relative w-full max-w-md z-30 group">
                 {/* Animated Gradient Border for Header Input (Subtle) */}
                 <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 via-red-500 to-yellow-500 rounded-full opacity-0 group-focus-within:opacity-100 transition duration-500 blur-sm"></div>
                 
                 <form onSubmit={handleSearch} className="relative w-full">
                   <input
                     type="text"
                     value={query}
                     onFocus={() => setShowDropdown(true)}
                     onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                     onChange={(e) => setQuery(e.target.value)}
                     className="relative w-full h-10 pl-5 pr-10 rounded-full border border-slate-200 bg-slate-50 focus:bg-white focus:border-transparent outline-none transition-all text-sm placeholder:text-slate-400 text-slate-700 shadow-sm"
                     disabled={isLoading || isExporting}
                     placeholder="Ask another question..."
                   />
                   <button type="submit" disabled={isExporting} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-blue-600 transition-colors">
                      <Search size={16} />
                   </button>
                 </form>

                 {/* History Dropdown */}
                 {showDropdown && (
                   <div className="absolute top-full left-0 right-0 mt-3 bg-white rounded-2xl border border-slate-100 shadow-2xl overflow-hidden max-h-[400px] overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-200">
                      {history.filter(h => !query || h.query.toLowerCase().includes(query.toLowerCase())).length > 0 ? (
                        history.filter(h => !query || h.query.toLowerCase().includes(query.toLowerCase())).map(h => (
                          <div 
                              key={h.id}
                              onMouseDown={() => {
                                loadHistoryItem(h);
                                setShowDropdown(false);
                              }}
                              className="px-4 py-3 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0 flex items-center justify-between group transition-colors"
                          >
                              <div className="flex items-center gap-3 overflow-hidden">
                                <History size={14} className="text-slate-300 group-hover:text-blue-500 shrink-0" />
                                <span className="text-sm font-medium text-slate-700 truncate group-hover:text-slate-900">{h.query}</span>
                              </div>
                              <span className="text-xs text-slate-400 shrink-0">
                                  {new Date(h.timestamp).toLocaleDateString()}
                              </span>
                          </div>
                        ))
                      ) : (
                        <div className="px-4 py-4 text-center text-slate-400 text-sm italic">
                          {history.length === 0 ? "No search history yet" : "No matches found"}
                        </div>
                      )}
                   </div>
                 )}
               </div>

               {/* GLOBAL EXPORT BUTTON */}
               {isSuccess && (
                 <button
                    onClick={handleExportVideo}
                    disabled={isExporting}
                    className={`shrink-0 h-10 flex items-center gap-2 px-4 rounded-full text-sm font-bold transition-all border shadow-sm ${
                      isExporting
                      ? 'bg-blue-50 text-blue-600 border-blue-100 cursor-not-allowed'
                      : 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700 hover:scale-105 active:scale-95'
                    }`}
                  >
                    {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Video size={16} />}
                    <span className="hidden sm:inline">{isExporting ? exportProgress || 'Exporting...' : 'Export Video'}</span>
                  </button>
               )}
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 relative w-full h-full overflow-hidden">
        
        {/* IDLE STATE */}
        {isIdle && (
          <div className="absolute inset-0 overflow-y-auto">
            <div className="flex flex-col items-center justify-center p-4 min-h-full pt-20 pb-20">
              <div className="text-center mb-10 max-w-2xl animate-in fade-in zoom-in duration-500">
                <div className="inline-flex items-center justify-center p-3 bg-white rounded-2xl shadow-sm mb-6 border border-slate-100">
                    <Sparkles className="text-yellow-500 mr-2" size={24} fill="#fbbf24" />
                    <span className="font-bold text-slate-700">Visual Learning Assistant</span>
                </div>
                <h2 className="text-5xl md:text-6xl font-bold text-slate-800 mb-6 hand-font leading-tight">
                  What do you want to <span className="text-blue-600 decoration-4 decoration-blue-200 underline underline-offset-4">learn</span>?
                </h2>
                <p className="text-slate-500 text-xl">Enter a "How to" question and I'll sketch a guide for you.</p>
              </div>

              {/* IDLE SEARCH BAR with Google Flow Animation */}
              <div className="relative w-full max-w-2xl group animate-in fade-in slide-in-from-bottom-4 duration-700">
                {/* The animated flowing border */}
                <div className="absolute -inset-1 bg-gradient-to-r from-blue-500 via-red-500 via-yellow-500 to-green-500 rounded-3xl opacity-30 blur-md group-focus-within:opacity-80 transition duration-500 animate-flow"></div>
                
                <form onSubmit={handleSearch} className="relative flex items-center bg-white rounded-2xl shadow-xl overflow-hidden">
                    <div className="pl-6 text-slate-400">
                        <Search size={24} />
                    </div>
                    <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="e.g., How does an engine work?"
                    className="w-full h-16 pl-4 pr-16 text-xl text-slate-800 placeholder:text-slate-300 outline-none bg-transparent"
                    />
                    <button
                    type="submit"
                    disabled={!query.trim()}
                    className="absolute right-2 top-2 bottom-2 aspect-square bg-blue-600 text-white rounded-xl flex items-center justify-center hover:bg-blue-700 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:scale-100 transition-all"
                    >
                        <ChevronRight size={28} />
                    </button>
                </form>
              </div>

              {history.length > 0 && (
                <div className="w-full max-w-4xl mt-16 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-100">
                  <div className="flex items-center gap-2 mb-6 text-slate-400 font-bold tracking-wider text-sm uppercase">
                    <History size={16} />
                    <span>Recent Sketches</span>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {history.map((item) => (
                      <div 
                        key={item.id}
                        onClick={() => loadHistoryItem(item)}
                        className="group relative bg-white border border-slate-200 rounded-2xl p-5 hover:border-blue-300 hover:shadow-lg transition-all cursor-pointer"
                      >
                        <h3 className="font-bold text-slate-800 mb-1 pr-8 truncate hand-font text-xl group-hover:text-blue-600 transition-colors">{item.query}</h3>
                        <p className="text-sm text-slate-500 line-clamp-2">{item.steps[0]?.description}</p>
                        
                        <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-50">
                           <span className="text-xs text-slate-400">
                             {new Date(item.timestamp).toLocaleDateString()}
                           </span>
                           <span className="text-slate-300 group-hover:text-blue-500 transition-colors">
                             <ChevronRight size={16} />
                           </span>
                        </div>

                        <button 
                          onClick={(e) => deleteHistory(e, item.id)}
                          className="absolute top-4 right-4 p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                          title="Delete from history"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* LOADING STATE */}
        {isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/60 backdrop-blur-sm z-10">
            <div className="bg-white p-10 rounded-3xl shadow-2xl flex flex-col items-center max-w-sm animate-in fade-in zoom-in duration-300 relative overflow-hidden">
               {/* Loader Gradient Border */}
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-blue-500 via-red-500 to-yellow-500 animate-flow"></div>
              
              <Loader2 className="animate-spin text-blue-600 mb-6" size={48} />
              <p className="hand-font text-3xl text-slate-800 font-bold">Sketching...</p>
              <p className="text-slate-500 mt-2 text-center">Breaking down your question into visual steps.</p>
            </div>
          </div>
        )}

        {/* ERROR STATE */}
        {appState === AppState.ERROR && (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="bg-red-50 border border-red-100 rounded-3xl p-8 text-center max-w-md shadow-xl">
              <h3 className="text-red-700 font-bold text-xl mb-2">Oops!</h3>
              <p className="text-red-600 mb-6">{errorMsg}</p>
              <button 
                onClick={() => setAppState(AppState.IDLE)}
                className="bg-red-100 text-red-700 px-6 py-2 rounded-lg font-bold hover:bg-red-200 transition-colors"
              >
                Try Again
              </button>
            </div>
          </div>
        )}

        {/* SUCCESS STATE */}
        {isSuccess && currentStepData && (
          <div className="w-full h-full flex flex-col lg:flex-row animate-in fade-in slide-in-from-bottom-4 duration-700">
            
            {/* LEFT PANEL: Canvas */}
            <div className="flex-1 bg-slate-50 p-4 lg:p-8 flex items-center justify-center relative overflow-hidden">
              <div className="w-full h-full max-w-[1200px] flex items-center justify-center">
                 <SketchCanvas 
                    ref={canvasRef}
                    code={currentStepData.code} 
                    width={800} 
                    height={600} 
                    className="max-h-full w-auto aspect-[4/3] shadow-2xl border-4 border-white ring-1 ring-slate-200"
                  />
              </div>
            </div>

            {/* RIGHT PANEL: Sidebar */}
            <div className="shrink-0 w-full lg:w-[400px] xl:w-[450px] bg-white border-l border-slate-200 flex flex-col z-10 shadow-xl shadow-slate-200/50">
              
              {/* Content Area */}
              <div className="flex-1 overflow-y-auto p-6 lg:p-8">
                
                <div className="inline-block px-3 py-1 bg-blue-50 rounded-full text-xs font-bold text-blue-600 tracking-wider mb-6 border border-blue-100">
                  STEP {currentStepIndex + 1} OF {steps.length}
                </div>

                <div className="flex items-start gap-4 mb-6">
                  <h2 className="hand-font text-3xl lg:text-4xl font-bold text-slate-800 leading-[1.1]">
                    {currentStepData.title}
                  </h2>
                </div>

                <div className="prose prose-slate prose-lg leading-relaxed text-slate-600">
                  <p>{currentStepData.description}</p>
                </div>

                <div className="flex flex-wrap gap-3 mt-8">
                  {/* Audio Button */}
                  <button
                    onClick={toggleSpeech}
                    disabled={isExporting || quotaExceeded}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-bold transition-all ${
                      isSpeaking 
                      ? 'bg-red-50 text-red-600 ring-1 ring-red-200' 
                      : quotaExceeded
                        ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-800'
                    }`}
                    title={quotaExceeded ? "Audio disabled due to API limits" : "Read description"}
                  >
                    {isSpeaking ? <StopCircle size={18} /> : quotaExceeded ? <VolumeX size={18} /> : isLoadingAudio ? <Loader2 size={18} className="animate-spin" /> : <Volume2 size={18} />}
                    {isSpeaking ? 'Reading...' : quotaExceeded ? 'Audio Limit' : isLoadingAudio ? 'Loading Audio...' : 'Replay Audio'}
                  </button>

                  {/* Regenerate Button */}
                  <button
                    onClick={reGenerateSketch}
                    disabled={isRegenerating || isExporting}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-bold transition-all bg-slate-50 text-slate-500 hover:bg-blue-50 hover:text-blue-600 border border-slate-200 hover:border-blue-200 ${
                        isRegenerating ? 'opacity-80 cursor-wait' : ''
                    }`}
                    title="Regenerate this specific sketch if it looks wrong"
                  >
                    <RefreshCw size={18} className={isRegenerating ? "animate-spin" : ""} />
                    {isRegenerating ? 'Redrawing...' : 'Regenerate Sketch'}
                  </button>
                </div>
              </div>

              {/* Footer Controls */}
              <div className="p-6 border-t border-slate-100 bg-slate-50/50">
                <StepControls 
                  currentStep={currentStepIndex}
                  totalSteps={steps.length}
                  onNext={() => {
                    if (!isExporting) {
                      stopSpeaking();
                      setCurrentStepIndex(p => Math.min(steps.length - 1, p + 1));
                    }
                  }}
                  onPrev={() => {
                    if (!isExporting) {
                      stopSpeaking();
                      setCurrentStepIndex(p => Math.max(0, p - 1));
                    }
                  }}
                  onReset={() => {
                    if (isExporting) return;
                    stopSpeaking();
                    setAppState(AppState.IDLE);
                    setQuery('');
                  }}
                />
              </div>
            </div>

          </div>
        )}
      </main>
    </div>
  );
};

export default App;