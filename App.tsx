import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Pencil, Search, Loader2, Volume2, StopCircle, History, Trash2, ChevronRight, Video, Download } from 'lucide-react';
import { generateSketchSteps, generateSpeech } from './services/geminiService';
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
  
  // Export State
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState('');
  
  // History Dropdown State
  const [showDropdown, setShowDropdown] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  
  const canvasRef = useRef<SketchCanvasHandle>(null);

  // Audio References
  const audioContextRef = useRef<AudioContext | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  
  // CHANGE: Cache keyed by text content (string) instead of index (number)
  // This allows audio to persist when switching between history items
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

  // --- Audio Logic (Gemini TTS) ---

  const stopSpeaking = useCallback(() => {
    if (activeSourceRef.current) {
      activeSourceRef.current.stop();
      activeSourceRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  // Helper to generate a unique key for the audio cache based on content
  const getAudioKey = useCallback((step: SketchStep) => {
    return `${step.title.trim()}|${step.description.trim()}`;
  }, []);

  // Core function to load audio (checks cache -> checks in-flight -> generates)
  const ensureAudioLoaded = useCallback(async (index: number): Promise<AudioBuffer> => {
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
      } catch (e) {
        console.error(`Failed to load audio for step ${index}`, e);
        throw e;
      } finally {
        // Remove from promise map so if it failed we can try again later
        audioLoadingPromisesRef.current.delete(key);
      }
    })();

    audioLoadingPromisesRef.current.set(key, promise);
    return promise;
  }, [steps, getAudioContext, getAudioKey]);

  const playAudioForStep = useCallback(async (index: number) => {
    const step = steps[index];
    if (!step) return;

    stopSpeaking();

    try {
      const key = getAudioKey(step);
      
      // Optimistically set loading if not cached
      if (!audioCacheRef.current.has(key)) {
        setIsLoadingAudio(true);
      }

      const ctx = getAudioContext();
      // Resume context if suspended (browser requirement)
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      // Fetch or get from cache/promise
      const buffer = await ensureAudioLoaded(index);
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
      console.error("Audio Playback Error:", err);
      setIsLoadingAudio(false);
      setIsSpeaking(false);
    }
  }, [steps, getAudioContext, stopSpeaking, ensureAudioLoaded, getAudioKey]);

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

  // --- Pre-fetch Logic ---
  useEffect(() => {
    if (appState === AppState.SUCCESS && steps.length > 0) {
      // Pre-fetch the next 2 steps
      const nextIndex = currentStepIndex + 1;
      const nextNextIndex = currentStepIndex + 2;

      if (nextIndex < steps.length) {
        ensureAudioLoaded(nextIndex).catch(() => {});
      }
      if (nextNextIndex < steps.length) {
         ensureAudioLoaded(nextNextIndex).catch(() => {});
      }
    }
  }, [currentStepIndex, appState, steps, ensureAudioLoaded]);


  // --- Auto Play Logic ---

  useEffect(() => {
    // Only auto-play if we are successful, have steps, and NOT currently exporting video
    if (appState === AppState.SUCCESS && steps.length > 0 && !isExporting) {
      const timer = setTimeout(() => {
        playAudioForStep(currentStepIndex);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [currentStepIndex, appState, steps, isExporting, playAudioForStep]);


  // --- Export Video Logic (Optimized) ---

  const handleExportVideo = async () => {
    if (steps.length === 0 || isExporting) return;
    
    stopSpeaking();
    setIsExporting(true);
    setExportProgress('Preparing Audio...');

    try {
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') await ctx.resume();
      
      // Setup stream destination
      const dest = ctx.createMediaStreamDestination();

      // 1. Ensure ALL audio buffers are cached
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const key = getAudioKey(step);
        if (!audioCacheRef.current.has(key)) {
          setExportProgress(`Generating Audio (${i + 1}/${steps.length})...`);
          await ensureAudioLoaded(i);
        }
      }

      // 2. Setup MediaRecorder
      setExportProgress('Starting Recording...');
      const canvasElement = canvasRef.current?.getCanvas();
      if (!canvasElement) throw new Error("Canvas not found");
      
      const canvasStream = canvasElement.captureStream(30); // 30 FPS
      const combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...dest.stream.getAudioTracks()
      ]);

      const recorder = new MediaRecorder(combinedStream, { 
        mimeType: 'video/webm; codecs=vp9',
        videoBitsPerSecond: 2500000 // 2.5 Mbps
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
      // Helper to play a single step for export
      const playExportStep = (index: number) => {
        if (index >= steps.length) {
          // Finished
          setTimeout(() => mediaRecorderRef.current?.stop(), 1000);
          return;
        }

        setExportProgress(`Recording Step ${index + 1}/${steps.length}...`);
        
        // Set visual state
        setCurrentStepIndex(index);
        
        // Force canvas replay
        setTimeout(() => {
           canvasRef.current?.replay();
           
           // Get cached buffer
           const step = steps[index];
           const key = getAudioKey(step);
           const buffer = audioCacheRef.current.get(key);
           
           if (!buffer) return; 

           const source = ctx.createBufferSource();
           source.buffer = buffer;
           source.connect(dest);
           source.connect(ctx.destination); // Feedback to user

           source.onended = () => {
             // Delay before next step
             setTimeout(() => playExportStep(index + 1), 1000);
           };

           source.start();
        }, 100); 
      };

      // Start the chain
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
    
    // NOTE: We do NOT clear the audio cache here anymore.
    // This allows re-visiting previous queries without re-generating audio.
    
    // Close dropdown
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
    
    // NOTE: We do NOT clear the audio cache here anymore.
    
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

  const isIdle = appState === AppState.IDLE;
  const isSuccess = appState === AppState.SUCCESS;
  const isLoading = appState === AppState.LOADING;

  const currentStepData = steps[currentStepIndex];

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#f5f5f4] text-stone-900 font-sans">
      
      {/* Header */}
      <header className="shrink-0 w-full bg-white/90 backdrop-blur-sm border-b border-stone-200 z-20">
        <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div 
            className="flex items-center gap-3 cursor-pointer group shrink-0" 
            onClick={() => { if(!isExporting) { stopSpeaking(); setAppState(AppState.IDLE); setQuery(''); } }}
          >
            <div className="bg-stone-900 text-white p-2 rounded-lg shadow-sm group-hover:scale-105 transition-transform">
              <Pencil size={20} />
            </div>
            <h1 className="hand-font text-2xl font-bold tracking-wide select-none group-hover:text-stone-700 transition-colors hidden sm:block">
              AI Sketchy
            </h1>
          </div>

          {!isIdle && (
            <div className="flex-1 flex items-center justify-end gap-3 max-w-3xl">
               
               {/* Search Bar with History Dropdown */}
               <div className="relative w-full max-w-md z-30">
                 <form onSubmit={handleSearch} className="relative w-full">
                   <input
                     type="text"
                     value={query}
                     onFocus={() => setShowDropdown(true)}
                     onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                     onChange={(e) => setQuery(e.target.value)}
                     className="w-full h-10 pl-4 pr-10 rounded-full border border-stone-300 bg-stone-50 focus:bg-white focus:border-stone-800 focus:ring-2 focus:ring-stone-100 outline-none transition-all text-sm"
                     disabled={isLoading || isExporting}
                     placeholder="Ask another question..."
                   />
                   <button type="submit" disabled={isExporting} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-800">
                      <Search size={16} />
                   </button>
                 </form>

                 {/* History Dropdown */}
                 {showDropdown && (
                   <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl border border-stone-200 shadow-xl overflow-hidden max-h-[400px] overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-200">
                      {history.filter(h => !query || h.query.toLowerCase().includes(query.toLowerCase())).length > 0 ? (
                        history.filter(h => !query || h.query.toLowerCase().includes(query.toLowerCase())).map(h => (
                          <div 
                              key={h.id}
                              onMouseDown={() => {
                                loadHistoryItem(h);
                                setShowDropdown(false);
                              }}
                              className="px-4 py-3 hover:bg-stone-50 cursor-pointer border-b border-stone-100 last:border-0 flex items-center justify-between group transition-colors"
                          >
                              <div className="flex items-center gap-3 overflow-hidden">
                                <History size={14} className="text-stone-300 group-hover:text-stone-500 shrink-0" />
                                <span className="text-sm font-medium text-stone-700 truncate group-hover:text-stone-900">{h.query}</span>
                              </div>
                              <span className="text-xs text-stone-400 shrink-0">
                                  {new Date(h.timestamp).toLocaleDateString()}
                              </span>
                          </div>
                        ))
                      ) : (
                        <div className="px-4 py-4 text-center text-stone-400 text-sm italic">
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
                    className={`shrink-0 h-10 flex items-center gap-2 px-4 rounded-full text-sm font-bold transition-all border ${
                      isExporting
                      ? 'bg-blue-50 text-blue-600 border-blue-200 cursor-not-allowed'
                      : 'bg-stone-900 text-white border-stone-900 hover:bg-stone-800 hover:scale-105 active:scale-95 shadow-md'
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
              <div className="text-center mb-8 max-w-2xl animate-in fade-in zoom-in duration-500">
                <h2 className="text-5xl font-bold text-stone-800 mb-6 hand-font">What do you want to learn?</h2>
                <p className="text-stone-500 text-xl">Enter a "How to" question and I'll draw you a step-by-step guide.</p>
              </div>
              <form onSubmit={handleSearch} className="relative w-full max-w-2xl animate-in fade-in slide-in-from-bottom-4 duration-700">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="e.g., How to tie a tie?"
                  className="w-full pl-6 pr-14 py-5 text-xl rounded-2xl border-2 border-stone-200 bg-white text-stone-900 placeholder:text-stone-400 focus:border-stone-800 focus:ring-4 focus:ring-stone-100/50 outline-none shadow-2xl shadow-stone-200/50 transition-all"
                />
                <button
                  type="submit"
                  disabled={!query.trim()}
                  className="absolute right-3 top-3 bottom-3 aspect-square bg-stone-900 text-white rounded-xl flex items-center justify-center hover:bg-stone-700 hover:scale-105 active:scale-95 disabled:opacity-50 transition-all"
                >
                  <Search size={24} />
                </button>
              </form>

              {history.length > 0 && (
                <div className="w-full max-w-4xl mt-16 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-100">
                  <div className="flex items-center gap-2 mb-6 text-stone-400 font-bold tracking-wider text-sm uppercase">
                    <History size={16} />
                    <span>Recent Sketches</span>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {history.map((item) => (
                      <div 
                        key={item.id}
                        onClick={() => loadHistoryItem(item)}
                        className="group relative bg-white border border-stone-200 rounded-xl p-4 hover:border-stone-400 hover:shadow-lg transition-all cursor-pointer"
                      >
                        <h3 className="font-bold text-stone-800 mb-1 pr-8 truncate hand-font text-xl">{item.query}</h3>
                        <p className="text-sm text-stone-500 line-clamp-2">{item.steps[0]?.description}</p>
                        
                        <div className="flex items-center justify-between mt-3 pt-3 border-t border-stone-100">
                           <span className="text-xs text-stone-400">
                             {new Date(item.timestamp).toLocaleDateString()}
                           </span>
                           <span className="text-stone-400 group-hover:text-stone-800 transition-colors">
                             <ChevronRight size={16} />
                           </span>
                        </div>

                        <button 
                          onClick={(e) => deleteHistory(e, item.id)}
                          className="absolute top-3 right-3 p-1.5 text-stone-300 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
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
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/50 backdrop-blur-sm z-10">
            <div className="bg-white p-8 rounded-3xl shadow-2xl border-2 border-dashed border-stone-300 flex flex-col items-center max-w-sm animate-in fade-in zoom-in duration-300">
              <Loader2 className="animate-spin text-stone-800 mb-6" size={48} />
              <p className="hand-font text-3xl text-stone-700 font-bold">Sketching...</p>
              <p className="text-stone-500 mt-2 text-center">Breaking down your question into visual steps.</p>
            </div>
          </div>
        )}

        {/* ERROR STATE */}
        {appState === AppState.ERROR && (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="bg-red-50 border-2 border-red-100 rounded-2xl p-8 text-center max-w-md shadow-xl">
              <h3 className="text-red-900 font-bold text-xl mb-2">Oops!</h3>
              <p className="text-red-700 mb-6">{errorMsg}</p>
              <button 
                onClick={() => setAppState(AppState.IDLE)}
                className="bg-red-100 text-red-800 px-6 py-2 rounded-lg font-bold hover:bg-red-200 transition-colors"
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
            <div className="flex-1 bg-stone-100 p-4 lg:p-8 flex items-center justify-center relative overflow-hidden">
              <div className="w-full h-full max-w-[1200px] flex items-center justify-center">
                 <SketchCanvas 
                    ref={canvasRef}
                    code={currentStepData.code} 
                    width={800} 
                    height={600} 
                    className="max-h-full w-auto aspect-[4/3] shadow-2xl border-stone-800"
                  />
              </div>
            </div>

            {/* RIGHT PANEL: Sidebar */}
            <div className="shrink-0 w-full lg:w-[400px] xl:w-[450px] bg-white border-l border-stone-200 flex flex-col z-10 shadow-[-10px_0_20px_-10px_rgba(0,0,0,0.05)]">
              
              {/* Content Area */}
              <div className="flex-1 overflow-y-auto p-6 lg:p-8">
                
                <div className="inline-block px-3 py-1 bg-stone-100 rounded-full text-xs font-bold text-stone-500 tracking-wider mb-6 border border-stone-200">
                  STEP {currentStepIndex + 1} OF {steps.length}
                </div>

                <div className="flex items-start gap-4 mb-6">
                  <h2 className="hand-font text-3xl lg:text-4xl font-bold text-stone-800 leading-[1.1]">
                    {currentStepData.title}
                  </h2>
                </div>

                <div className="prose prose-stone prose-lg leading-relaxed text-stone-600">
                  <p>{currentStepData.description}</p>
                </div>

                <div className="flex flex-wrap gap-3 mt-6">
                  {/* Audio Button */}
                  <button
                    onClick={toggleSpeech}
                    disabled={isExporting}
                    className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold transition-all ${
                      isSpeaking 
                      ? 'bg-red-50 text-red-600 ring-2 ring-red-100' 
                      : 'bg-stone-50 text-stone-500 hover:bg-stone-100'
                    }`}
                  >
                    {isSpeaking ? <StopCircle size={18} /> : isLoadingAudio ? <Loader2 size={18} className="animate-spin" /> : <Volume2 size={18} />}
                    {isSpeaking ? 'Reading...' : isLoadingAudio ? 'Loading Audio...' : 'Replay Audio'}
                  </button>
                </div>
              </div>

              {/* Footer Controls */}
              <div className="p-6 border-t border-stone-100 bg-stone-50/50">
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