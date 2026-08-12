import asyncio
import json
import random
from pathlib import Path
import google.genai.errors
from ocr_engine import extract_ocr_data
from parser_engine_v2 import parse_receipt_ocr_text_async

SOURCE_DIR = Path(__file__).resolve().parent / "Dataset" / "Images"
OUTPUT_DIR = Path(__file__).resolve().parent / "Dataset" / "ocr_gemini_3.1_flash_lite"
MODEL = "gemini-3.1-flash-lite"
MAX_RETRIES = 5

RETRYABLE_STATUSES = (429, 500, 503)

def ocr_text_from_image(image_path: Path) -> str:
    image_bytes = image_path.read_bytes()
    ocr_results = extract_ocr_data(image_bytes)
    lines = [item["text"] for item in ocr_results if "text" in item]
    return "\n".join(lines)

async def process_one(image_path: Path, retries: int = 0) -> dict:
    try:
        ocr_text = ocr_text_from_image(image_path)
        result = await parse_receipt_ocr_text_async(ocr_text, model=MODEL)
    except google.genai.errors.ClientError as e:
        status = getattr(getattr(e, "response", None), "status_code", None)
        if status is None:
            status = getattr(e, "code", None)
        if status in RETRYABLE_STATUSES and retries < MAX_RETRIES:
            wait = min(60, 2 ** retries) + random.uniform(0, 1)
            print(f"  RETRY {image_path.name} (status={status}, try {retries + 1}) in {wait:.1f}s")
            await asyncio.sleep(wait)
            return await process_one(image_path, retries + 1)
        return {"filename": image_path.name, "status": "failed", "error": str(e)}
    except Exception as e:
        return {"filename": image_path.name, "status": "failed", "error": str(e)}

    output_path = OUTPUT_DIR / f"{image_path.stem}.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    return {"filename": image_path.name, "status": "success", "saved_file": str(output_path)}

async def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    image_files = sorted(
        SOURCE_DIR.glob("*.jpeg"),
        key=lambda p: int(p.stem),
    )
    existing = {p.stem for p in OUTPUT_DIR.glob("*.json")}
    todo = [p for p in image_files if p.stem not in existing]
    print(f"Total images: {len(image_files)} | already done: {len(image_files) - len(todo)} | to process: {len(todo)}")
    if not todo:
        print("Nothing to do.")
        return

    results = []
    for image_path in todo:
        result = await process_one(image_path)
        results.append(result)
        print(f"  {result['status'].upper():4} {image_path.name}")

    success = [r for r in results if r["status"] == "success"]
    failed = [r for r in results if r["status"] == "failed"]
    print(f"\nThis run -> Success: {len(success)} / {len(results)}")
    if failed:
        print("Failed files (re-running later will retry them):")
        for f in failed:
            print(f"  {f['filename']}: {f['error'][:200]}")

if __name__ == "__main__":
    asyncio.run(main())