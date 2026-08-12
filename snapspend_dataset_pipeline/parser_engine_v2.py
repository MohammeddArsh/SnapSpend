import os
import json
from pathlib import Path
from dotenv import load_dotenv
from google import genai
from google.genai import types
from pydantic import BaseModel, Field
from categories import map_to_canonical

DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite"

DEFAULT_SYSTEM_PROMPT = (
    "Extract structured receipt data including vendor, date, total amount, "
    "and itemized purchase details from this receipt image. "
    "Assign a clear category tag to each item."
)

DEFAULT_OCR_SYSTEM_PROMPT = (
    "Extract structured receipt data including vendor, date, total amount, "
    "and itemized purchase details from this receipt OCR text. "
    "Assign a clear category tag to each item."
)

CATEGORY_DESCRIPTION = (
    "Category tag for the item. MUST be one of: Groceries, Pharmacy, Travel, "
    "Households, Miscellaneous"
)

class InternalItem(BaseModel):
    name: str = Field(description="Name or description of product as listed on the receipt")
    quantity: int = Field(description="Quantity purchased, default to 1 if unspecified")
    price: float = Field(description="Total price paid for this line item")
    currency: str = Field(description="3-letter currency code, e.g. EUR, USD")
    category: str = Field(description=CATEGORY_DESCRIPTION)

class InternalReceiptData(BaseModel):
    vendor: str = Field(description="Store or business name")
    date: str = Field(
        description="Date of purchase in DD.MM.YYYY format, e.g., 21.05.2026. Use empty string if missing."
    )
    total_amount: float = Field(description="Total receipt amount paid")
    purchased_items: list[InternalItem]

def _get_client() -> genai.Client:
    env_path = Path(__file__).resolve().parent / ".env"
    load_dotenv(dotenv_path=env_path, override=True)
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY is missing from your .env file!")
    return genai.Client(api_key=api_key)

def normalize_receipt_output(parsed_data: dict) -> dict:
    def to_num(value, fallback=0):
        try:
            n = float(value)
        except (TypeError, ValueError):
            return fallback
        return n if n == n and n != float("inf") else fallback

    formatted_items = []
    for item in parsed_data.get("purchased_items") or []:
        quantity = to_num(item.get("quantity"), 1)
        formatted_items.append([
            item.get("name") or "Unknown Item",
            int(quantity) if quantity > 0 else 1,
            to_num(item.get("price"), 0),
            item.get("currency") or "EUR",
            map_to_canonical(item.get("category")),
        ])

    return {
        "vendor": parsed_data.get("vendor") or "Unknown",
        "date": parsed_data.get("date") or "",
        "total_amount": to_num(parsed_data.get("total_amount"), 0),
        "purchased_items": formatted_items,
    }

async def parse_receipt_image_async(
    image_bytes: bytes,
    mime_type: str = "image/jpeg",
    model: str = DEFAULT_GEMINI_MODEL,
    system_prompt: str = DEFAULT_SYSTEM_PROMPT,
    temperature: float = 0.1,
) -> dict:
    client = _get_client()
    response = await client.aio.models.generate_content(
        model=model,
        contents=[
            types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
            system_prompt,
        ],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=InternalReceiptData,
            temperature=temperature,
        ),
    )
    raw_data = json.loads(response.text)
    return normalize_receipt_output(raw_data)

async def parse_receipt_ocr_text_async(
    ocr_text: str,
    model: str = DEFAULT_GEMINI_MODEL,
    system_prompt: str = DEFAULT_OCR_SYSTEM_PROMPT,
    temperature: float = 0.1,
) -> dict:
    client = _get_client()
    response = await client.aio.models.generate_content(
        model=model,
        contents=[
            types.Part(text=system_prompt),
            types.Part(text=ocr_text),
        ],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=InternalReceiptData,
            temperature=temperature,
        ),
    )
    raw_data = json.loads(response.text)
    return normalize_receipt_output(raw_data)