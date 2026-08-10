import cv2
import numpy as np
from paddleocr import PaddleOCR

# Initialize PaddleOCR without document unwarping for faster receipt parsing
ocr = PaddleOCR(
    use_angle_cls=True,
    lang='en',
    use_doc_unwarping=False
)

def extract_ocr_data(image_bytes: bytes):
    if not image_bytes:
        return []

    # 1. Convert raw bytes to numpy array and decode to BGR
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if img is None:
        raise ValueError("Could not decode image bytes.")

    # 2. Run OCR
    results = ocr.ocr(img)

    if not results or results == [None]:
        return []

    parsed_results = []
    first_res = results[0]

    # --- Case 1: PaddleX Pipeline Dictionary Output (Parallel Arrays) ---
    if isinstance(first_res, dict) and "rec_texts" in first_res:
        texts = first_res.get("rec_texts", [])
        scores = first_res.get("rec_scores", [])
        polys = first_res.get("rec_polys", []) or first_res.get("dt_polys", [])

        for i in range(len(texts)):
            text = texts[i]
            score = scores[i] if i < len(scores) else 1.0
            box = polys[i] if i < len(polys) else None

            if box is not None and len(box) > 0:
                # Extract coordinates
                x_coords = [point[0] for point in box]
                y_coords = [point[1] for point in box]

                x_min, x_max = min(x_coords), max(x_coords)
                y_min, y_max = min(y_coords), max(y_coords)
                y_center = (y_min + y_max) / 2.0

                parsed_results.append({
                    "text": str(text),
                    "confidence": float(score),
                    "bounding_box": {
                        "x_min": float(x_min),
                        "y_min": float(y_min),
                        "x_max": float(x_max),
                        "y_max": float(y_max),
                        "y_center": float(y_center)
                    }
                })

    # --- Case 2: Classic Tuple/List Format [box, (text, score)] ---
    elif isinstance(first_res, list):
        for line in first_res:
            if not line:
                continue

            box, text, score = None, "", 0.0

            if isinstance(line, (list, tuple)):
                if len(line) == 2:
                    box, text_info = line
                    if isinstance(text_info, (list, tuple)):
                        text, score = text_info[0], text_info[1]
                    else:
                        text = text_info
                elif len(line) >= 3:
                    box, text, score = line[0], line[1], line[2]

            if box is not None:
                x_coords = [point[0] for point in box]
                y_coords = [point[1] for point in box]

                x_min, x_max = min(x_coords), max(x_coords)
                y_min, y_max = min(y_coords), max(y_coords)
                y_center = (y_min + y_max) / 2.0

                parsed_results.append({
                    "text": str(text),
                    "confidence": float(score),
                    "bounding_box": {
                        "x_min": float(x_min),
                        "y_min": float(y_min),
                        "x_max": float(x_max),
                        "y_max": float(y_max),
                        "y_center": float(y_center)
                    }
                })

    return parsed_results