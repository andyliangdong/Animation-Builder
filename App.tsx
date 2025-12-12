import React, { useState, useEffect, useCallback } from 'react';
import { Pencil, Search, Loader2, Volume2, StopCircle, History, Trash2, ChevronRight } from 'lucide-react';
import { generateSketchSteps } from './services/geminiService';
import { getHistory, saveHistoryItem, deleteHistoryItem } from './services/storageService';
import SketchCanvas from './components/SketchCanvas';
import StepControls from './components/StepControls';
import { SketchStep, AppState, HistoryItem } from './types';

const App: React.FC = () => {
  const [query, setQuery] = useState('');
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [steps, setSteps] = useState<SketchStep[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // Load history on mount
  useEffect(() => {
    setHistory(getHistory());
  }, []);

  // --- Speech Logic ---

  const speak = useCallback((text: string) => {
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    // Try to find a nice English voice
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
    return () => stopSpeaking();
  }, [stopSpeaking]);

  // --- Auto Play & State Effects ---

  const currentStepData = steps[currentStepIndex];

  // Auto-play audio when step changes or when we first load success state
  useEffect(() => {
    if (appState === AppState.SUCCESS && currentStepData) {
      // Small timeout to ensure smoother transition visually before audio starts
      const timer = setTimeout(() => {
        speak(`${currentStepData.title}. ${currentStepData.description}`);
      }, 500);
      return () => clearTimeout(timer);
    } else {
      stopSpeaking();
    }
  }, [currentStepIndex, appState, currentStepData, speak, stopSpeaking]);


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
        // Auto Save to history
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
            onClick={() => { stopSpeaking(); setAppState(AppState.IDLE); setQuery(''); }}
          >
            <div className="bg-stone-900 text-white p-2 rounded-lg shadow-sm group-hover:scale-105 transition-transform">
              <Pencil size={20} />
            </div>
            <h1 className="hand-font text-2xl font-bold tracking-wide select-none group-hover:text-stone-700 transition-colors">
              AI Sketchy
            </h1>
          </div>

          {/* Mini Search Bar in Header (Visible when in Success/Loading state) */}
          {!isIdle && (
            <div className="flex-1 max-w-xl mx-8 hidden md:block">
               <form onSubmit={handleSearch} className="relative">
                 <input
                   type="text"
                   value={query}
                   onChange={(e) => setQuery(e.target.value)}
                   className="w-full pl-4 pr-10 py-2 rounded-full border border-stone-300 bg-stone-50 focus:bg-white focus:border-stone-800 focus:ring-2 focus:ring-stone-100 outline-none transition-all text-sm"
                   disabled={isLoading}
                 />
                 <button type="submit" className="absolute right-2 top-1.5 text-stone-400 hover:text-stone-800">
                    <Search size={16} />
                 </button>
               </form>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 relative w-full h-full overflow-hidden">
        
        {/* IDLE STATE: Centered Search + History */}
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

              {/* Recent Sketches Grid */}
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

        {/* SUCCESS STATE: Split View Dashboard */}
        {isSuccess && currentStepData && (
          <div className="w-full h-full flex flex-col lg:flex-row animate-in fade-in slide-in-from-bottom-4 duration-700">
            
            {/* LEFT PANEL: Canvas (Takes priority) */}
            <div className="flex-1 bg-stone-100 p-4 lg:p-8 flex items-center justify-center relative overflow-hidden">
              <div className="w-full h-full max-w-[1200px] flex items-center justify-center">
                 <SketchCanvas 
                    code={currentStepData.code} 
                    width={800} 
                    height={600} 
                    className="max-h-full w-auto aspect-[4/3] shadow-2xl border-stone-800"
                  />
              </div>
            </div>

            {/* RIGHT PANEL: Sidebar for Info & Controls */}
            <div className="shrink-0 w-full lg:w-[400px] xl:w-[450px] bg-white border-l border-stone-200 flex flex-col z-10 shadow-[-10px_0_20px_-10px_rgba(0,0,0,0.05)]">
              
              {/* Content Area (Scrollable) */}
              <div className="flex-1 overflow-y-auto p-6 lg:p-8">
                
                {/* Step Indicator */}
                <div className="inline-block px-3 py-1 bg-stone-100 rounded-full text-xs font-bold text-stone-500 tracking-wider mb-6 border border-stone-200">
                  STEP {currentStepIndex + 1} OF {steps.length}
                </div>

                {/* Title (Reduced size) */}
                <div className="flex items-start gap-4 mb-6">
                  <h2 className="hand-font text-3xl lg:text-4xl font-bold text-stone-800 leading-[1.1]">
                    {currentStepData.title}
                  </h2>
                </div>

                {/* Description */}
                <div className="prose prose-stone prose-lg leading-relaxed text-stone-600">
                  <p>{currentStepData.description}</p>
                </div>

                {/* Audio Button (Status) */}
                <button
                  onClick={toggleSpeech}
                  className={`mt-6 flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold transition-all ${
                    isSpeaking 
                    ? 'bg-red-50 text-red-600 ring-2 ring-red-100' 
                    : 'bg-stone-50 text-stone-500 hover:bg-stone-100'
                  }`}
                >
                  {isSpeaking ? <StopCircle size={18} /> : <Volume2 size={18} />}
                  {isSpeaking ? 'Reading...' : 'Replay Audio'}
                </button>
              </div>

              {/* Footer Controls (Fixed at bottom of sidebar) */}
              <div className="p-6 border-t border-stone-100 bg-stone-50/50">
                <StepControls 
                  currentStep={currentStepIndex}
                  totalSteps={steps.length}
                  onNext={() => setCurrentStepIndex(p => Math.min(steps.length - 1, p + 1))}
                  onPrev={() => setCurrentStepIndex(p => Math.max(0, p - 1))}
                  onReset={() => {
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
