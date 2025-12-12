import { HistoryItem, SketchStep } from '../types';

const STORAGE_KEY = 'ai_sketchy_history';

export const getHistory = (): HistoryItem[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    console.error("Failed to load history", e);
    return [];
  }
};

export const saveHistoryItem = (query: string, steps: SketchStep[]): HistoryItem[] => {
  try {
    const history = getHistory();
    // Remove existing item with same query to bring it to top (case insensitive)
    const filteredHistory = history.filter(h => h.query.toLowerCase() !== query.toLowerCase());
    
    const newItem: HistoryItem = {
      id: Date.now().toString(), // Simple ID generation
      query,
      steps,
      timestamp: Date.now()
    };

    // Add to top, limit to 20 items
    const newHistory = [newItem, ...filteredHistory].slice(0, 20);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(newHistory));
    return newHistory;
  } catch (e) {
    console.error("Failed to save history", e);
    return [];
  }
};

export const deleteHistoryItem = (id: string): HistoryItem[] => {
  try {
    const history = getHistory();
    const newHistory = history.filter(item => item.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newHistory));
    return newHistory;
  } catch (e) {
    console.error("Failed to delete history item", e);
    return [];
  }
};
