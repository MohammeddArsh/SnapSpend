// src/parserEngine.js
import { GoogleGenAI, Type } from "@google/genai";

// js/parserEngine.js

const receiptSchema = {
  type: "OBJECT",
  properties: {
    vendor: { type: "STRING", description: "Store or business name" },
    date: { 
      type: "STRING", 
      description: "Date of purchase in DD.MM.YYYY format, e.g., 21.05.2026. Use empty string if missing." 
    },
    total_amount: { type: "NUMBER", description: "Total receipt amount paid" },
    purchased_items: {
      type: "ARRAY",
      description: "List of itemized purchases",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", description: "Name or description of product as listed on the receipt" },
          quantity: { type: "INTEGER", description: "Quantity purchased, default to 1 if unspecified" },
          price: { type: "NUMBER", description: "Total price paid for this line item" },
          currency: { type: "STRING", description: "3-letter currency code, e.g. EUR, USD" },
          category: { 
            type: "STRING", 
            description: "Inferred granular category or tag e.g., Groceries, Pantry, Beverages, Tobacco, Deposit, Household, Apparel, Electronics, Pharmacy" 
          },
        },
        required: ["name", "quantity", "price", "currency", "category"],
      },
    },
  },
  required: ["vendor", "date", "total_amount", "purchased_items"],
};

// Convert File to Base64
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}

export async function parseReceiptDirectly(file) {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("VITE_GEMINI_API_KEY is missing in your .env file!");

  const base64Data = await fileToBase64(file);
  
  // Note: Model upgraded to gemini-2.5-flash (or gemini-3.6-flash if available)
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`;

  const prompt = "Extract structured receipt data including vendor, date, total amount, and itemized purchase details from this receipt image. Assign a clear, granular tag/category to each item.";

  const payload = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: file.type || "image/jpeg", data: base64Data } },
          { text: prompt }
        ]
      }
    ],
    generationConfig: {
      response_mime_type: "application/json",
      response_schema: receiptSchema,
      temperature: 0.1
    }
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API Error (HTTP ${response.status}): ${errorText}`);
  }

  const result = await response.json();
  const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error("Gemini returned an empty response.");

  const parsedData = JSON.parse(rawText);

  // Return formatted array matching [name, quantity, price, currency, category]
  const formattedItems = (parsedData.purchased_items || []).map((item) => [
    item.name || "Unknown Item",
    item.quantity ?? 1,
    item.price ?? 0.0,
    item.currency || "EUR",
    item.category || "General",
  ]);

  return {
    vendor: parsedData.vendor || "Unknown",
    date: parsedData.date || "",
    total_amount: parsedData.total_amount ?? 0.0,
    purchased_items: formattedItems,
  };
}