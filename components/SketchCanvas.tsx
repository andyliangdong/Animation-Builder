import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import rough from 'roughjs';

interface SketchCanvasProps {
  code: string;
  width?: number;
  height?: number;
  className?: string;
}

export interface SketchCanvasHandle {
  replay: () => void;
  getCanvas: () => HTMLCanvasElement | null;
}

const SketchCanvas = forwardRef<SketchCanvasHandle, SketchCanvasProps>(({ 
  code, 
  width = 800, 
  height = 600,
  className = ''
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Store timeout IDs to cancel animations if component unmounts or updates
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // We move the main drawing logic into a function that can be called by useEffect AND replay
  const runAnimation = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Reset canvas and timers
    // CRITICAL FIX: Fill with white instead of clearRect to ensure video background is white, not transparent/black
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];

    const rc = rough.canvas(canvas);

    // --- Command Queue for Animation ---
    // We will push closures into this array to be executed sequentially
    const commandQueue: Array<() => void> = [];
    const addToQueue = (fn: () => void) => {
      commandQueue.push(fn);
    };

    // --- Proxied Tools ---
    // Proxy 'rc' to capture method calls
    const rcProxy = new Proxy(rc, {
      get(target: any, prop: string | symbol) {
        if (typeof target[prop] === 'function') {
          return (...args: any[]) => {
            addToQueue(() => {
               target[prop](...args);
            });
          };
        }
        return target[prop];
      }
    });

    const drawArrow = (x1: number, y1: number, x2: number, y2: number, options: any = {}) => {
      addToQueue(() => {
        const { color = '#1c1917', strokeWidth = 2, arrowSize = 20 } = options;
        rc.line(x1, y1, x2, y2, { stroke: color, strokeWidth, roughness: 2 });

        const angle = Math.atan2(y2 - y1, x2 - x1);
        const x3 = x2 - arrowSize * Math.cos(angle - Math.PI / 6);
        const y3 = y2 - arrowSize * Math.sin(angle - Math.PI / 6);
        const x4 = x2 - arrowSize * Math.cos(angle + Math.PI / 6);
        const y4 = y2 - arrowSize * Math.sin(angle + Math.PI / 6);

        rc.line(x2, y2, x3, y3, { stroke: color, strokeWidth, roughness: 2 });
        rc.line(x2, y2, x4, y4, { stroke: color, strokeWidth, roughness: 2 });
      });
    };

    const drawCurve = (x1: number, y1: number, x2: number, y2: number, offset: number = 0, options: any = {}) => {
      addToQueue(() => {
         const { color = '#1c1917', strokeWidth = 2, arrow = false, arrowSize = 20 } = options;
         
         const midX = (x1 + x2) / 2;
         const midY = (y1 + y2) / 2;
         const dx = x2 - x1;
         const dy = y2 - y1;
         const len = Math.sqrt(dx * dx + dy * dy);
         const udx = -dy / len;
         const udy = dx / len;
         const cx = midX + udx * offset;
         const cy = midY + udy * offset;
         const path = `M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}`;
         rc.path(path, { stroke: color, strokeWidth, roughness: 2 });

         if (arrow) {
            const angle = Math.atan2(y2 - cy, x2 - cx);
            const x3 = x2 - arrowSize * Math.cos(angle - Math.PI / 6);
            const y3 = y2 - arrowSize * Math.sin(angle - Math.PI / 6);
            const x4 = x2 - arrowSize * Math.cos(angle + Math.PI / 6);
            const y4 = y2 - arrowSize * Math.sin(angle + Math.PI / 6);
            rc.line(x2, y2, x3, y3, { stroke: color, strokeWidth, roughness: 2 });
            rc.line(x2, y2, x4, y4, { stroke: color, strokeWidth, roughness: 2 });
         }
      });
    };

    const drawText = (text: string, x: number, y: number, options: any = {}) => {
      addToQueue(() => {
        ctx.save();
        const fontSize = options.size || options.fontSize || 24;
        ctx.font = `bold ${fontSize}px 'Patrick Hand', cursive`;
        ctx.fillStyle = options.color || "#1c1917";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(255, 255, 255, 0.8)";
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        
        const lines = String(text).split(/\r?\n|\\n/);
        const lineHeight = fontSize * 1.2; 
        const startY = y - ((lines.length - 1) * lineHeight) / 2;

        lines.forEach((line: string, i: number) => {
          ctx.fillText(line, x, startY + (i * lineHeight));
          ctx.fillText(line, x, startY + (i * lineHeight));
        });
        ctx.restore();
      });
    };

    try {
      setError(null);
      // Execute the code to populate commandQueue
      // eslint-disable-next-line no-new-func
      const drawFunction = new Function('rc', 'ctx', 'width', 'height', 'drawArrow', 'drawCurve', 'drawText', code);
      drawFunction(rcProxy, ctx, width, height, drawArrow, drawCurve, drawText);

      // Playback Animation (Staggered)
      const STAGGER_DELAY = 200; 

      commandQueue.forEach((command, index) => {
        const id = setTimeout(() => {
          requestAnimationFrame(() => {
             try {
                command();
             } catch (e) {
                console.error("Error executing command at index", index, e);
             }
          });
        }, index * STAGGER_DELAY);
        
        timeoutsRef.current.push(id);
      });

    } catch (err) {
      console.error("Failed to execute sketch code:", err);
      setError("Could not draw this step.");
      drawText("Oops! Drawing Error.", width/2, height/2, { color: '#ef4444', size: 40 });
    }
  };

  useEffect(() => {
    runAnimation();
    return () => {
      timeoutsRef.current.forEach(clearTimeout);
    };
  }, [code, width, height]);

  // Expose methods to parent
  useImperativeHandle(ref, () => ({
    replay: () => {
      runAnimation();
    },
    getCanvas: () => {
      return canvasRef.current;
    }
  }));

  return (
    <div className={`relative bg-white rounded-xl overflow-hidden border-4 border-stone-900 shadow-xl ${className}`}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="block w-full h-full object-contain bg-white"
      />
      {error && (
        <div className="absolute top-2 left-2 bg-red-100 text-red-700 px-3 py-1 rounded text-sm font-bold opacity-90 z-10">
          Error
        </div>
      )}
      <div className="absolute bottom-3 right-3 opacity-40 pointer-events-none select-none">
        <span className="hand-font text-stone-400 text-xl font-bold">AI Sketchy</span>
      </div>
    </div>
  );
});

export default SketchCanvas;