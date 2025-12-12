import React from 'react';
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';

interface StepControlsProps {
  currentStep: number;
  totalSteps: number;
  onNext: () => void;
  onPrev: () => void;
  onReset: () => void;
}

const StepControls: React.FC<StepControlsProps> = ({ 
  currentStep, 
  totalSteps, 
  onNext, 
  onPrev,
  onReset
}) => {
  return (
    <div className="flex items-center justify-between w-full bg-white p-2 rounded-2xl border border-slate-200 shadow-sm">
      <div className="flex items-center gap-3">
        <button
          onClick={onReset}
          className="p-2.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
          title="Start Over"
        >
          <RotateCcw size={20} />
        </button>
        <span className="font-mono text-xs font-bold text-slate-400 tracking-wider">
          {currentStep + 1} / {totalSteps}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onPrev}
          disabled={currentStep === 0}
          className={`
            flex items-center justify-center w-10 h-10 rounded-xl font-bold transition-all
            ${currentStep === 0 
              ? 'text-slate-200 cursor-not-allowed' 
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 active:scale-95'
            }
          `}
          title="Previous Step"
        >
          <ChevronLeft size={24} />
        </button>
        
        <button
          onClick={onNext}
          disabled={currentStep === totalSteps - 1}
          className={`
            flex items-center gap-2 px-5 h-10 rounded-xl font-bold transition-all shadow-sm
            ${currentStep === totalSteps - 1 
              ? 'bg-slate-100 text-slate-300 cursor-not-allowed shadow-none' 
              : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-95 shadow-blue-200'
            }
          `}
        >
          <span>Next</span>
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
};

export default StepControls;