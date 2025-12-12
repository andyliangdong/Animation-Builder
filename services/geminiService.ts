import { GoogleGenAI, Type, Schema } from "@google/genai";
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

2. **Prevent Overcrowding (SPLIT STEPS)**:
   - **Rule**: If a diagram requires more than 5 distinct nodes or complex connections, **SPLIT IT** into multiple steps.
   - Better to have 3 simple steps than 1 messy step.
   - Step 1: "Setup/Inputs", Step 2: "Process", Step 3: "Outputs".

3. **Avoid Overlaps**:
   - **Use Curves**: Use \`drawCurve\` with different offsets to route connections *around* other boxes or text.
   - **Spacing**: Keep at least 50px buffer between shapes.
   - **Text Safety**: Never draw a line or arrow through a text label.

4. **Animation & Storytelling**:
   - Group related drawing commands together.
   - Example order: Draw Box A -> Label Box A -> Draw Box B -> Label Box B -> Draw Arrow A to B.

5. **Styling**:
   - Fills: '#e0f2fe' (blue), '#fef3c7' (yellow), '#dcfce7' (green), '#fee2e2' (red).
   - Text Size: Title=28, Label=24, Note=18. **Keep text small enough to fit inside shapes.**

**Example Code:**
rc.rectangle(100, 200, 150, 100, { fill: '#e0f2fe', fillStyle: 'solid' });
drawText(\`Server\`, 175, 250, { size: 24 });

rc.rectangle(500, 200, 150, 100, { fill: '#fef3c7', fillStyle: 'solid' });
drawText(\`Database\`, 575, 250, { size: 24 });

// Curve avoids hitting the center area
drawCurve(250, 250, 500, 250, -100, { color: 'red', arrow: true }); 
drawText(\`Query\`, 375, 180, { size: 18, color: 'red' });
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
