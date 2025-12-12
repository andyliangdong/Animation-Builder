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
    <div className="flex items-center justify-between w-full bg-stone-50 p-2 rounded-xl border-2 border-stone-200">
      <div className="flex items-center gap-3">
        <button
          onClick={onReset}
          className="p-2 text-stone-500 hover:text-stone-900 hover:bg-stone-200 rounded-lg transition-colors"
          title="Start Over"
        >
          <RotateCcw size={18} />
        </button>
        <span className="font-mono text-xs font-bold text-stone-400 tracking-wider">
          STEP {currentStep + 1} / {totalSteps}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onPrev}
          disabled={currentStep === 0}
          className={`
            flex items-center justify-center w-10 h-10 rounded-lg font-bold border-2 transition-all
            ${currentStep === 0 
              ? 'border-transparent text-stone-300 cursor-not-allowed' 
              : 'border-stone-200 bg-white text-stone-800 hover:border-stone-400 hover:shadow-sm active:translate-y-0.5'
            }
          `}
          title="Previous Step"
        >
          <ChevronLeft size={20} />
        </button>
        
        <button
          onClick={onNext}
          disabled={currentStep === totalSteps - 1}
          className={`
            flex items-center gap-1 px-4 h-10 rounded-lg font-bold border-2 transition-all shadow-sm
            ${currentStep === totalSteps - 1 
              ? 'border-stone-200 bg-stone-100 text-stone-300 cursor-not-allowed shadow-none' 
              : 'bg-stone-900 border-stone-900 text-white hover:bg-stone-800 active:translate-y-0.5 shadow-md'
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
