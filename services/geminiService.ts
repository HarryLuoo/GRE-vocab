
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { ExploredWord, GeminiEvaluationResult } from "../types";
import { GEMINI_MODEL_TEXT } from "../constants";

const API_KEY = "";

const ai = API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : null;

// Renaming to reflect it's an internal type for the service
export interface WordDetailsResponseItem {
  definition: string;
  example_sentence: string;
}

interface BatchWordDetailsResponse {
  [word: string]: WordDetailsResponseItem;
}

interface WordDetailsResponse { // For single word fetch
  word: string;
  definition: string;
  example_sentence: string;
  synonyms?: string[];
  antonyms?: string[];
}

interface GeminiEvaluationResponseInternal {
  is_correct: boolean;
  feedback: string;
  confidence?: number;
}


export async function fetchWordDetails(word: string): Promise<ExploredWord | null> {
  if (!ai) {
     console.error("Gemini API client is not initialized in fetchWordDetails. API_KEY might be missing or became invalid.");
    return {
      text: word,
      definition: "API client not initialized. Check API Key.",
      exampleSentence: "Unable to fetch details.",
      synonyms: [],
      antonyms: [],
    };
  }

  const prompt = `
    For the word "${word}", provide the following information in JSON format:
    1. The word itself (key: "word").
    2. A concise definition (key: "definition").
    3. An example sentence using the word (key: "example_sentence").
    4. A list of 2-3 common synonyms if applicable (key: "synonyms", array of strings).
    5. A list of 2-3 common antonyms if applicable (key: "antonyms", array of strings).

    Ensure the output is a single JSON object. If you cannot find information, provide empty strings for values or empty arrays for lists, rather than omitting keys.
  `;

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: GEMINI_MODEL_TEXT,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.5, 
      }
    });
    
    if (!response.text) {
      throw new Error("Gemini API response text is undefined.");
    }
    let jsonStr = response.text.trim();
    const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
    const match = jsonStr.match(fenceRegex);
    if (match && match[2]) {
      jsonStr = match[2].trim();
    }

    const parsedData = JSON.parse(jsonStr) as WordDetailsResponse;

    return {
      text: parsedData.word || word,
      definition: parsedData.definition || "No definition provided by API.",
      exampleSentence: parsedData.example_sentence || "No example sentence provided by API.",
      synonyms: parsedData.synonyms || [],
      antonyms: parsedData.antonyms || [],
    };

  } catch (error) {
    console.error(`Error fetching word details for "${word}" from Gemini API:`, error);
    let defMessage = "Error fetching definition.";
    let exMessage = "Error fetching example sentence.";
    
    if (error instanceof Error) {
        if (error.message.includes("429") || error.message.includes("RESOURCE_EXHAUSTED")) {
            defMessage = "API rate limit hit for this word. Please try again after some time.";
            exMessage = "Details unavailable due to rate limit.";
        } else if (error.message.includes("API key not valid")) {
            defMessage = "Invalid API Key. Please check your configuration.";
            exMessage = "Cannot fetch details due to API key issue.";
        } else {
            defMessage = "Could not load definition for this word.";
            exMessage = "Could not load example for this word.";
        }
    }
    
    return {
      text: word,
      definition: defMessage,
      exampleSentence: exMessage,
      synonyms: [],
      antonyms: [],
    };
  }
}

export async function fetchMultipleWordDetails(words: string[]): Promise<Record<string, WordDetailsResponseItem>> {
  if (!ai) {
    console.error("Gemini API client is not initialized in fetchMultipleWordDetails. API_KEY might be missing.");
    const errorResult: Record<string, WordDetailsResponseItem> = {};
    words.forEach(word => {
      errorResult[word] = {
        definition: "API client not initialized. Check API Key.",
        // FIX: Correct property name to example_sentence
        example_sentence: "Unable to fetch details for batch.",
      };
    });
    return errorResult;
  }
  if (words.length === 0) {
    return {};
  }

  const prompt = `
    For each word in the following list, provide a JSON object containing its definition and an example sentence.
    The main response should be a single JSON object where each key is one of the input words, and its value is an object with two keys: "definition" and "example_sentence".

    Example structure for input ["word1", "word2"]:
    {
      "word1": {
        "definition": "Definition of word1.",
        "example_sentence": "Example sentence for word1."
      },
      "word2": {
        "definition": "Definition of word2.",
        "example_sentence": "Example sentence for word2."
      }
    }

    If you cannot find information for a specific word, provide a standard placeholder like "No definition found." or "No example sentence found." for its values. Ensure all requested words are present as keys in your response.

    Input words:
    ${JSON.stringify(words)}
  `;

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: GEMINI_MODEL_TEXT,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.3, // Slightly lower temperature for more factual, consistent output
      }
    });

    if (!response.text) {
      throw new Error("Gemini API response text is undefined.");
    }
    let jsonStr = response.text.trim();
    const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
    const match = jsonStr.match(fenceRegex);
    if (match && match[2]) {
      jsonStr = match[2].trim();
    }

    const parsedData = JSON.parse(jsonStr) as BatchWordDetailsResponse;
    
    // Ensure all requested words have an entry, even if API omits some
    const result: Record<string, WordDetailsResponseItem> = {};
    words.forEach(word => {
      if (parsedData[word]) {
        result[word] = {
          definition: parsedData[word].definition || "No definition provided by API.",
          // FIX: Correct property name to example_sentence
          example_sentence: parsedData[word].example_sentence || "No example sentence provided by API."
        };
      } else {
        // Fallback if a word was in the request but missing in the response
        result[word] = {
          definition: "Details not found in API response for this word.",
          // FIX: Correct property name to example_sentence
          example_sentence: "Example not found in API response for this word."
        };
      }
    });
    return result;

  } catch (error) {
    console.error(`Error fetching batch word details from Gemini API for words: ${words.join(', ')}`, error);
    const errorResult: Record<string, WordDetailsResponseItem> = {};
    let defMessage = "Error fetching definition for batch.";
    let exMessage = "Error fetching example sentence for batch.";

    if (error instanceof Error) {
        if (error.message.includes("429") || error.message.includes("RESOURCE_EXHAUSTED")) {
            defMessage = "API rate limit hit during batch fetch. Please try again after some time.";
            exMessage = "Batch details unavailable due to rate limit.";
        } else if (error.message.includes("API key not valid")) {
            defMessage = "Invalid API Key. Cannot fetch batch details.";
            exMessage = "Please check your API key configuration.";
        }
    }

    words.forEach(word => {
      errorResult[word] = {
        definition: defMessage,
        // FIX: Correct property name to example_sentence
        example_sentence: exMessage,
      };
    });
    return errorResult;
  }
}


export async function evaluateUserExplanation(word: string, definition: string, exampleSentence: string, userExplanation: string): Promise<GeminiEvaluationResult> {
  if (!ai) {
    console.error("Gemini API client is not initialized in evaluateUserExplanation. API_KEY might be missing.");
    return {
      isCorrect: false,
      feedback: "Evaluation service not available: API client not initialized. Check API Key.",
    };
  }

  const prompt = `
    The target word is "${word}".
    Its definition is: "${definition}"
    An example sentence is: "${exampleSentence}"
    The user provided the following explanation or example sentence: "${userExplanation}"

    Based on the word's actual definition and example, evaluate the user's input.
    Determine if the user's input correctly and adequately demonstrates understanding of the word.
    The user's input could be their own definition, or their own example sentence.

    Respond in JSON format with the following keys:
    - "is_correct": boolean (true if the user's input is substantially correct, false otherwise).
    - "feedback": string (a brief explanation for your evaluation, providing constructive feedback to the user. If incorrect, explain why. If correct, confirm and perhaps highlight what was good.).
    - "confidence": number (optional, a score from 0.0 to 1.0 indicating your confidence in the evaluation).
    
    Example for good user input:
    Word: "Ephemeral"
    User input: "It means something that doesn't last long, like a mayfly's life."
    Expected response: {"is_correct": true, "feedback": "Correct! You've captured the essence of 'ephemeral' meaning short-lived.", "confidence": 0.9}
    
    Example for bad user input:
    Word: "Ephemeral"
    User input: "It's a type of ghost."
    Expected response: {"is_correct": false, "feedback": "Not quite. 'Ephemeral' refers to things that last for a very short time, not necessarily supernatural beings.", "confidence": 0.95}

    Focus on the core meaning and appropriate usage.
  `;

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: GEMINI_MODEL_TEXT,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.6, 
      }
    });

    if (!response.text) {
      throw new Error("Gemini API response text is undefined.");
    }
    let jsonStr = response.text.trim();
    const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
    const match = jsonStr.match(fenceRegex);
    if (match && match[2]) {
      jsonStr = match[2].trim();
    }
    
    const parsedData = JSON.parse(jsonStr) as GeminiEvaluationResponseInternal;

    return {
      isCorrect: parsedData.is_correct,
      feedback: parsedData.feedback,
      confidence: parsedData.confidence,
    };

  } catch (error) {
    console.error("Error evaluating user explanation with Gemini API:", error);
    let feedbackMessage = "Failed to evaluate your explanation.";
    if (error instanceof Error) {
        if (error.message.includes("429") || error.message.includes("RESOURCE_EXHAUSTED")) {
            feedbackMessage = "API rate limit hit. Evaluation failed. Please try again after some time.";
        } else if (error.message.includes("API key not valid")) {
            feedbackMessage = "Evaluation failed due to invalid API Key. Please check your configuration.";
        } else {
            feedbackMessage = "Could not evaluate due to an API error.";
        }
    }
    return {
      isCorrect: false, // Default to incorrect on error
      feedback: feedbackMessage,
    };
  }
}
