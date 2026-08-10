import os
import json
from typing import Optional
from pathlib import Path
from dotenv import load_dotenv
from google import genai
from google.genai import types
from pydantic import BaseModel, Field

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
    env_path = Path(__file__).resolve().parent / ".env"
    load_dotenv(dotenv_path=env_path, override=False)

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or api_key == "MY_GEMINI_API_KEY":
        # Fallback check system environment or parent .env
        load_dotenv(dotenv_path=env_path, override=True)
        api_key = os.getenv("GEMINI_API_KEY")

    if not api_key or api_key == "MY_GEMINI_API_KEY":
        raise ValueError("GEMINI_API_KEY is missing or invalid! Please set your actual Gemini API key in .env file.")

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

    # Use client.aio for non-blocking asynchronous calls
    response = await client.aio.models.generate_content(
        model="gemini-2.0-flash",
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