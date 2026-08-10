import os
import re
import json
import asyncio
from typing import Optional
from pathlib import Path
from dotenv import load_dotenv
from google import genai
from google.genai import types
from pydantic import BaseModel, Field

def fallback_parse_ocr(image_bytes: bytes) -> dict:
    merchant = "Scanned Receipt"
    total_amount = 0.0
    try:
        from ocr_engine import extract_ocr_data
        ocr_lines = extract_ocr_data(image_bytes)
        if ocr_lines:
            texts = [line.get("text", "") for line in ocr_lines if line.get("text")]
            if texts:
                merchant = texts[0]
                numbers = []
                for t in texts:
                    found = re.findall(r'\d+[.,]\d{2}', t)
                    for f in found:
                        try:
                            val = float(f.replace(',', '.'))
                            if val > 0:
                                numbers.append(val)
                        except ValueError:
                            pass
                if numbers:
                    total_amount = max(numbers)
    except Exception:
        pass

    return {
        "merchant": merchant,
        "receipt_date": "",
        "currency": "EUR",
        "items": [],
        "subtotal": total_amount,
        "tax": 0.0,
        "total_amount": total_amount,
        "vendor": merchant,
        "date": "",
        "purchased_items": [],
    }

class ReceiptItem(BaseModel):
    item_name: str = Field(description="Name or description of the product purchased")
    quantity: float = Field(default=1.0, description="Quantity purchased, default to 1 if unspecified")
    unit_price: Optional[float] = Field(default=None, description="Unit price per item if present on receipt, else null")
    price: float = Field(description="Total price paid for this line item")
    category: str = Field(
        description="Category derived strictly from product name. Must be one of: Groceries, Dairy, Meat & Seafood, Bakery, Fruits & Vegetables, Beverages, Snacks, Household, Cleaning, Personal Care, Pharmacy/Health, Electronics, Clothing, Restaurant/Food, Transport, Other"
    )
    confidence: Optional[float] = Field(default=0.95, description="Estimated extraction confidence between 0.0 and 1.0")

class StructuredReceiptData(BaseModel):
    merchant: str = Field(description="Store or business name")
    receipt_date: str = Field(description="Date of purchase in DD.MM.YYYY or YYYY-MM-DD format. Empty string if missing.")
    currency: str = Field(description="Currency code or symbol e.g., EUR, USD, GBP, €, $, £")
    items: list[ReceiptItem] = Field(description="List of all individual purchased product line items")
    subtotal: Optional[float] = Field(default=None, description="Receipt subtotal before taxes/discounts if present")
    tax: Optional[float] = Field(default=0.0, description="Tax or VAT amount if present")
    total_amount: float = Field(description="Grand total receipt amount paid")

async def parse_receipt_image_async(image_bytes: bytes, mime_type: str = "image/jpeg") -> dict:
    backend_env = Path(__file__).resolve().parent / ".env"
    root_env = Path(__file__).resolve().parent.parent / ".env"

    load_dotenv(dotenv_path=backend_env, override=False)
    if not os.getenv("GEMINI_API_KEY"):
        load_dotenv(dotenv_path=root_env, override=False)

    api_key = os.getenv("GEMINI_API_KEY")

    if not api_key or api_key.strip() in ["", "MY_GEMINI_API_KEY", "your_gemini_api_key_here"]:
        raise ValueError("GEMINI_API_KEY is missing or invalid! Please set your actual Gemini API key in your .env file.")

    client = genai.Client(api_key=api_key)

    prompt = (
        "You are an expert receipt parser.\n"
        "Analyze the receipt image and extract EVERY individual purchased product line item.\n"
        "Do NOT return only the receipt total.\n\n"
        "For every purchased item, extract:\n"
        "- item_name: product name/description\n"
        "- quantity: quantity purchased (default to 1 if not explicitly listed)\n"
        "- unit_price: unit price per item if specified, otherwise null\n"
        "- price: total line item price paid\n"
        "- category: categorize strictly based on item_name into ONE of the following categories:\n"
        "  [Groceries, Dairy, Meat & Seafood, Bakery, Fruits & Vegetables, Beverages, Snacks, Household, Cleaning, Personal Care, Pharmacy/Health, Electronics, Clothing, Restaurant/Food, Transport, Other]\n"
        "  Examples: Milk/Butter/Cheese -> Dairy, Bread/Croissant -> Bakery, Apples/Bananas -> Fruits & Vegetables, Chicken/Beef -> Meat & Seafood, Water/Soda/Juice -> Beverages, Chocolate/Chips -> Snacks, Dishwasher tablets -> Cleaning, Shampoo/Toothpaste -> Personal Care, Medications -> Pharmacy/Health. Use 'Other' if uncertain.\n\n"
        "CRITICAL RULES:\n"
        "1. Do NOT treat subtotal, tax, VAT, total, payment method, cash, card numbers, change, receipt number, store address, or discounts as purchased products.\n"
        "2. Parse decimal commas correctly (e.g., 1,99 and 1.99 are both 1.99).\n"
        "3. Preserve unit_price and line price when both are given.\n"
        "4. Never invent prices or items that are not on the receipt.\n"
        "5. Return valid structured JSON matching the provided schema."
    )

    # Valid models supported in Google GenAI SDK v1.x
    candidate_models = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.0-flash-lite"]
    last_exception = None
    response = None

    for target_model in candidate_models:
        for attempt in range(2):
            try:
                response = await client.aio.models.generate_content(
                    model=target_model,
                    contents=[
                        types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                        prompt,
                    ],
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=StructuredReceiptData,
                        temperature=0.1,
                    ),
                )
                if response and response.text:
                    break
            except Exception as err:
                last_exception = err
                err_str = str(err)
                if "429" in err_str:
                    # Sleep 2 seconds to let free tier quota window reset
                    await asyncio.sleep(2.0)
                    continue
                elif "404" in err_str or "NOT_FOUND" in err_str:
                    # Model ID not available for this API key/region, break to try next model
                    break
                else:
                    break

        if response and response.text:
            break

    if not response or not response.text:
        fallback = fallback_parse_ocr(image_bytes)
        if fallback:
            return fallback
        if last_exception and "429" in str(last_exception):
            raise ValueError("Google Gemini API Free Tier rate limit reached (429). Please wait 10 seconds and try scanning again.")
        raise last_exception or ValueError("Failed to parse receipt image with Gemini AI.")

    raw_data = json.loads(response.text)

    merchant = raw_data.get("merchant") or "Unknown"
    receipt_date = raw_data.get("receipt_date") or ""
    currency = raw_data.get("currency") or "EUR"
    items = raw_data.get("items", [])
    subtotal = raw_data.get("subtotal") or 0.0
    tax = raw_data.get("tax") or 0.0
    total_amount = raw_data.get("total_amount") or 0.0

    # Build backward-compatible purchased_items array
    formatted_purchased_items = [
        [
            item.get("item_name", ""),
            item.get("quantity", 1),
            item.get("price", 0.0),
            currency,
            item.get("category", "Groceries"),
        ]
        for item in items
    ]

    return {
        "merchant": merchant,
        "receipt_date": receipt_date,
        "currency": currency,
        "items": items,
        "subtotal": subtotal,
        "tax": tax,
        "total_amount": total_amount,
        # Backward compatibility fields
        "vendor": merchant,
        "date": receipt_date,
        "purchased_items": formatted_purchased_items,
    }