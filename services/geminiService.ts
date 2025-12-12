import { GoogleGenAI, Type, Schema, Modality } from "@google/genai";
import { SketchResponse } from '../types';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    steps: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: "A short 2-5 word title for this step" },
          description: { type: Type.STRING, description: "A clear, concise explanation of what is happening in this step." },
          code: { 
            type: Type.STRING, 
            description: "Executable JavaScript code using 'rc' (RoughCanvas), 'drawArrow', 'drawCurve', and 'drawText'. Do not include markdown blocks. Assume 800x600 canvas." 
          }
        },
        required: ["title", "description", "code"]
      }
    }
  }
};

const SYSTEM_PROMPT = `
You are an expert technical illustrator and programmer. Your goal is to explain concepts by breaking them down into sequential visual steps that will be **ANIMATED** one by one.

**Execution Environment:**
The code you generate will be executed sequentially to create an animation. 
Write code in the order it should appear (e.g., Draw Node A -> Draw Node B -> Draw Connection).

**Parameters:**
- 'rc': The rough.js canvas instance.
- 'width': 800 (Canvas width).
- 'height': 600 (Canvas height).
- 'drawArrow(x1, y1, x2, y2, options)': Helper to draw a hand-drawn arrow.
- 'drawCurve(x1, y1, x2, y2, offset, options)': Helper to draw a curved arrow/line.
- 'drawText(text, x, y, options)': Helper to draw hand-written text centered at (x,y).

**Available Tools:**
1. **Rough.js Shapes (via 'rc')**:
   - rc.rectangle(x, y, w, h, { fill: 'color', stroke: 'color', fillStyle: 'hachure'|'solid' })
   - rc.circle(centerX, centerY, diameter, { ... })
   - rc.ellipse(centerX, centerY, w, h, { ... })
   - rc.line(x1, y1, x2, y2, { ... })
   - rc.path(d, { ... }) 

2. **Helpers**:
   - **drawArrow(x1, y1, x2, y2, { color: 'black' })**: Straight arrow.
   - **drawCurve(x1, y1, x2, y2, offset, { color: 'black', arrow: true })**: Curved line/arrow. 
     - \`offset\`: number. Distance of control point from the midpoint. +ve curves one way, -ve the other. Use this to avoid overlaps!
     - \`arrow\`: boolean. If true, draws an arrowhead at the end.
   - **drawText(str, x, y, { color: 'black', size: 24 })**: Label text.

**Visual & Layout Guidelines (CRITICAL):**

1. **Syntax Safety (IMPORTANT)**:
   - **ALWAYS use backticks (\`) for text arguments** in \`drawText\` to handle internal quotes and newlines safely.
   - CORRECT: \`drawText(\`User's Data\`, 100, 100)\`
   - INCORRECT: \`drawText("User's Data", 100, 100)\` (Syntax Error)

2. **Layering & Visibility (CRITICAL)**:
   - **Text is Priority**: Text must always be legible.
   - **Background First**: ALWAYS draw container shapes (boxes, circles) **BEFORE** drawing the text inside them.
   - **Highlighters**: If you are drawing a shape *over* existing text to highlight it (like in a matrix step), you **MUST** use a **transparent RGBA color** for the fill.
     - **Good Highlight**: \`fill: 'rgba(255, 215, 0, 0.3)'\` (Yellow transparent), \`fill: 'rgba(100, 149, 237, 0.3)'\` (Blue transparent).
     - **Bad Highlight**: \`fill: '#FFD700'\` (Solid opaque - WILL HIDE TEXT).
   - **No Intersection**: Do not draw lines through text.

3. **Spatial Layout & Overlap Prevention (CRITICAL)**:
   - **Avoid Central Overlap**: When drawing a new main component (like a processor, LLM, or aggregation box), **NEVER** place it directly on top of previous input nodes.
   - **Directional Flow**: Use a clear direction (e.g., Inputs on Top -> Processing in Middle -> Outputs on Bottom).
   - **Safe Zones**: 
     - If Inputs are at Y=100, place Processing at Y=300 or Y=400.
     - If Inputs are on Left (X=100), place Processing on Right (X=500).
   - **Example**: If you drew "Image Data" at (150, 150) in Step 1, do NOT draw the "LLM" box at (150, 150) in Step 2. Draw it at (400, 150) or (150, 400).

4. **Prevent Overcrowding (SPLIT STEPS)**:
   - **Rule**: If a diagram requires more than 5 distinct nodes or complex connections, **SPLIT IT** into multiple steps.
   - Better to have 3 simple steps than 1 messy step.

5. **Animation & Storytelling**:
   - Group related drawing commands together.
   - Example: Draw Box -> Label Box -> Draw Arrow.

6. **Styling**:
   - **Base Fills**: '#e0f2fe' (light blue), '#fef3c7' (light yellow), '#dcfce7' (light green), '#fee2e2' (light red).
   - **Highlight Fills**: 'rgba(255, 200, 0, 0.3)' (Gold), 'rgba(0, 200, 255, 0.2)' (Cyan).
   - Text Size: Title=28, Label=24, Note=18.

**Example Code:**
// 1. Draw Background
rc.rectangle(100, 200, 150, 100, { fill: '#e0f2fe', fillStyle: 'solid' });

// 2. Draw Text (On Top)
drawText(\`Server\`, 175, 250, { size: 24 });

// 3. Highlight Logic (Transparent)
rc.rectangle(100, 200, 150, 50, { fill: 'rgba(255, 255, 0, 0.3)', fillStyle: 'solid', stroke: 'none' });
drawText(\`Active\`, 175, 225, { size: 16, color: '#b45309' });
`;

export const generateSketchSteps = async (query: string): Promise<SketchResponse> => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Explain visually: ${query}`,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");

    return JSON.parse(text) as SketchResponse;
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
};

export const generateSpeech = async (text: string): Promise<string> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });
    
    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) throw new Error("No audio data generated");
    
    return base64Audio;
  } catch (error) {
     console.error("TTS Error", error);
     throw error;
  }
};
