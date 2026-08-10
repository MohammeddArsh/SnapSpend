import json
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from parser_engine import parse_receipt_image_async

app = FastAPI(title="SnapSpend API")

# Add CORS Middleware strictly for actual frontend Vite dev origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Define output directory for saving generated JSON files
OUTPUT_DIR = Path(__file__).resolve().parent / "outputs"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# --- Serve Web Frontend UI ---
@app.get("/", response_class=HTMLResponse)
async def serve_ui():
    html_path = Path(__file__).resolve().parent / "index.html"
    if not html_path.exists():
        raise HTTPException(status_code=404, detail="index.html not found.")
    return html_path.read_text(encoding="utf-8")
# -----------------------------

@app.post("/parse-receipt")
async def parse_receipts(files: list[UploadFile] = File(...)):
    if not files:
        raise HTTPException(status_code=400, detail="No files provided.")

    processed_results = []

    for file in files:
        if not file.content_type or not file.content_type.startswith("image/"):
            processed_results.append({
                "filename": file.filename,
                "status": "skipped",
                "reason": "Not an image"
            })
            continue

        try:
            image_bytes = await file.read()
            mime_type = file.content_type or "image/jpeg"

            # Parse via Gemini
            result = await parse_receipt_image_async(image_bytes, mime_type=mime_type)

            original_filename = Path(file.filename).stem if file.filename else "receipt"
            json_filename = f"{original_filename}.json"
            json_file_path = OUTPUT_DIR / json_filename

            # Save JSON file to outputs/ folder
            with open(json_file_path, "w", encoding="utf-8") as f:
                json.dump(result, f, ensure_ascii=False, indent=2)

            processed_results.append({
                "filename": file.filename,
                "status": "success",
                "saved_file": str(json_file_path),
                "data": result
            })

        except Exception as e:
            processed_results.append({
                "filename": file.filename,
                "status": "failed",
                "error": str(e)
            })

    return {
        "total_files": len(files),
        "processed": processed_results
    }