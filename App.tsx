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
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  
  const canvasRef = useRef<SketchCanvasHandle>(null);

  // Refs for export process
  const exportCtxRef = useRef<AudioContext | null>(null);
  const exportDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioBuffersRef = useRef<AudioBuffer[]>([]);
  const chunksRef = useRef<Blob[]>([]);

  // Load history on mount
  useEffect(() => {
    setHistory(getHistory());
  }, []);

  // --- Speech Logic (Standard) ---

  const speak = useCallback((text: string) => {
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(v => v.lang.startsWith('en') && v.name.includes('Google')) || 
                           voices.find(v => v.lang.startsWith('en'));
    if (preferredVoice) utterance.voice = preferredVoice;
    
    utterance.rate = 1.0;
    
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    
    window.speechSynthesis.speak(utterance);
  }, []);

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, []);

  const toggleSpeech = () => {
    if (isSpeaking) {
      stopSpeaking();
    } else if (currentStepData) {
      speak(`${currentStepData.title}. ${currentStepData.description}`);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopSpeaking();
      if (exportCtxRef.current) exportCtxRef.current.close();
    };
  }, [stopSpeaking]);

  // --- Auto Play (when not exporting) ---

  const currentStepData = steps[currentStepIndex];

  useEffect(() => {
    if (appState === AppState.SUCCESS && currentStepData && !isExporting) {
      const timer = setTimeout(() => {
        speak(`${currentStepData.title}. ${currentStepData.description}`);
      }, 500);
      return () => clearTimeout(timer);
    } else if (!isExporting) {
      stopSpeaking();
    }
  }, [currentStepIndex, appState, currentStepData, speak, stopSpeaking, isExporting]);


  // --- Export Video Logic (All Steps) ---

  const handleExportVideo = async () => {
    if (steps.length === 0 || isExporting) return;
    
    stopSpeaking();
    setIsExporting(true);
    setExportProgress('Preparing Audio...');

    try {
      // 1. Initialize Audio Context & Recorder
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 24000});
      exportCtxRef.current = ctx;
      
      const dest = ctx.createMediaStreamDestination();
      exportDestRef.current = dest;

      // 2. Pre-generate ALL audio buffers
      const buffers: AudioBuffer[] = [];
      for (let i = 0; i < steps.length; i++) {
        setExportProgress(`Generating Audio (${i + 1}/${steps.length})...`);
        const step = steps[i];
        const text = `${step.title}. ${step.description}`;
        const b64 = await generateSpeech(text);
        const bytes = base64ToBytes(b64);
        const buffer = pcmToAudioBuffer(bytes, ctx);
        buffers.push(buffer);
      }
      audioBuffersRef.current = buffers;

      // 3. Setup MediaRecorder with Canvas Stream
      setExportProgress('Starting Recording...');
      const canvasElement = canvasRef.current?.getCanvas();
      if (!canvasElement) throw new Error("Canvas not found");
      
      const canvasStream = canvasElement.captureStream(30);
      const combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...dest.stream.getAudioTracks()
      ]);

      const recorder = new MediaRecorder(combinedStream, { mimeType: 'video/webm; codecs=vp9' });
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
        if (exportCtxRef.current) {
            exportCtxRef.current.close();
            exportCtxRef.current = null;
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();

      // 4. Start the Sequence at Step 0
      // We explicitly set index to 0. The useEffect below handles the playback logic.
      if (currentStepIndex !== 0) {
        setCurrentStepIndex(0);
      } else {
        // Force trigger if we are already at 0
        playExportStep(0);
      }

    } catch (err) {
      console.error("Export failed", err);
      setIsExporting(false);
      setExportProgress('');
      alert("Failed to export video. Please try again.");
    }
  };

  const playExportStep = (index: number) => {
    const ctx = exportCtxRef.current;
    const dest = exportDestRef.current;
    const buffer = audioBuffersRef.current[index];

    if (!ctx || !dest || !buffer) return;

    setExportProgress(`Recording Step ${index + 1}/${steps.length}...`);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(dest);
    source.connect(ctx.destination); // Play on speakers too

    source.onended = () => {
      if (index < steps.length - 1) {
        // Move to next step after a short pause
        setTimeout(() => {
          setCurrentStepIndex(index + 1);
        }, 800);
      } else {
        // Finish recording after a short tail
        setTimeout(() => {
          mediaRecorderRef.current?.stop();
        }, 1000);
      }
    };

    // Force canvas replay to sync with audio start
    // Note: If 'currentStepIndex' just changed, the canvas is already replaying via its own useEffect.
    // If we call replay() here, it might restart it. 
    // Optimization: Only manual replay if needed, but since we just changed index, it should be fine.
    // However, if we are at step 0 and triggered manually, we might want to replay.
    canvasRef.current?.replay();
    
    source.start(0);
  };

  // Watch for step changes during export to trigger playback
  useEffect(() => {
    if (isExporting && audioBuffersRef.current.length > 0) {
      playExportStep(currentStepIndex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStepIndex, isExporting]); 
  // We exclude playExportStep from deps to avoid infinite loops, relying on index change.


  // --- Search Logic ---

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    stopSpeaking();
    setAppState(AppState.LOADING);
    setSteps([]);
    setErrorMsg('');
    setCurrentStepIndex(0);

    try {
      const data = await generateSketchSteps(query);
      if (data.steps && data.steps.length > 0) {
        setSteps(data.steps);
        setAppState(AppState.SUCCESS);
        const updatedHistory = saveHistoryItem(query, data.steps);
        setHistory(updatedHistory);
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
    setQuery(item.query);
    setSteps(item.steps);
    setCurrentStepIndex(0);
    setAppState(AppState.SUCCESS);
  };

  const deleteHistory = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const updated = deleteHistoryItem(id);
    setHistory(updated);
  };

  const isIdle = appState === AppState.IDLE;
  const isSuccess = appState === AppState.SUCCESS;
  const isLoading = appState === AppState.LOADING;

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#f5f5f4] text-stone-900 font-sans">
      
      {/* Header */}
      <header className="shrink-0 w-full bg-white/90 backdrop-blur-sm border-b border-stone-200 z-20">
        <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center justify-between">
          <div 
            className="flex items-center gap-3 cursor-pointer group" 
            onClick={() => { if(!isExporting) { stopSpeaking(); setAppState(AppState.IDLE); setQuery(''); } }}
          >
            <div className="bg-stone-900 text-white p-2 rounded-lg shadow-sm group-hover:scale-105 transition-transform">
              <Pencil size={20} />
            </div>
            <h1 className="hand-font text-2xl font-bold tracking-wide select-none group-hover:text-stone-700 transition-colors">
              AI Sketchy
            </h1>
          </div>

          {!isIdle && (
            <div className="flex-1 max-w-xl mx-8 hidden md:block">
               <form onSubmit={handleSearch} className="relative">
                 <input
                   type="text"
                   value={query}
                   onChange={(e) => setQuery(e.target.value)}
                   className="w-full pl-4 pr-10 py-2 rounded-full border border-stone-300 bg-stone-50 focus:bg-white focus:border-stone-800 focus:ring-2 focus:ring-stone-100 outline-none transition-all text-sm"
                   disabled={isLoading || isExporting}
                 />
                 <button type="submit" disabled={isExporting} className="absolute right-2 top-1.5 text-stone-400 hover:text-stone-800">
                    <Search size={16} />
                 </button>
               </form>
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
                    {isSpeaking ? <StopCircle size={18} /> : <Volume2 size={18} />}
                    {isSpeaking ? 'Reading...' : 'Replay Audio'}
                  </button>

                  {/* Export Button */}
                  <button
                    onClick={handleExportVideo}
                    disabled={isExporting}
                    className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold transition-all border border-stone-200 ${
                      isExporting
                      ? 'bg-blue-50 text-blue-600 ring-2 ring-blue-100 cursor-not-allowed'
                      : 'bg-white text-stone-600 hover:bg-stone-50 hover:text-stone-900 hover:border-stone-300'
                    }`}
                  >
                    {isExporting ? <Loader2 size={18} className="animate-spin" /> : <Video size={18} />}
                    {isExporting ? exportProgress || 'Exporting...' : 'Export Video'}
                  </button>
                </div>
              </div>

              {/* Footer Controls */}
              <div className="p-6 border-t border-stone-100 bg-stone-50/50">
                <StepControls 
                  currentStep={currentStepIndex}
                  totalSteps={steps.length}
                  onNext={() => !isExporting && setCurrentStepIndex(p => Math.min(steps.length - 1, p + 1))}
                  onPrev={() => !isExporting && setCurrentStepIndex(p => Math.max(0, p - 1))}
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
