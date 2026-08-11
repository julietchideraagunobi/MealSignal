import os
import json
import base64
import importlib
from pathlib import Path
from typing import List, Optional, Literal
from fastapi import FastAPI, Request, HTTPException, Header, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from google import genai
from google.genai import types

try:
    stripe = importlib.import_module("stripe")
except ModuleNotFoundError:
    stripe = None

env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=env_path)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise ValueError("GEMINI_API_KEY is missing from backend/.env")
client = genai.Client(api_key=GEMINI_API_KEY)

# Stripe API Keys
if stripe is not None:
    stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET")

LANGUAGE_MAPPING = {"en": "English", "de": "German", "fr": "French"}

app = FastAPI(title="MealSignal Backend API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalysisRequest(BaseModel):
    food_name: Optional[str] = Field(default=None, max_length=100)
    image_data: Optional[str] = Field(default=None)
    conditions: List[str] = Field(default=[])
    language: Literal["en", "de", "fr"] = Field(default="en")
    mode: Optional[str] = Field(default="standard")


class RecipeDetails(BaseModel):
    ingredients: List[str]
    steps: List[str]


class RawAnalysis(BaseModel):
    food_name: str
    portion_estimate: str
    kcal: int
    protein_g: int
    carbs_g: int
    fat_g: int
    sodium_mg: int
    potassium_mg: int = 0
    phosphorus_mg: int = 0
    saturated_fat_g: int = 0
    glycemic_load: int
    recipe_title: str
    recipe_details: RecipeDetails


class AnalysisResponse(BaseModel):
    food_name: str
    portion_estimate: str
    kcal: int
    protein_g: int
    carbs_g: int
    fat_g: int
    saturated_fat_g: int
    sodium_mg: int
    potassium_mg: int
    glycemic_load: int
    verdict: Literal["green", "amber", "red"]
    warning: str
    recipe_title: str
    recipe_details: RecipeDetails


class PortionFeedbackRequest(BaseModel):
    foodName: Optional[str] = None
    feedback: str


THRESHOLDS = {
    "hypertension": {"field": "sodium_mg", "amber_at": 300, "red_at": 500, "label": "sodium"},
    "kidney disease": {"field": "potassium_mg", "amber_at": 300, "red_at": 500, "label": "potassium"},
    "high cholesterol": {"field": "saturated_fat_g", "amber_at": 4, "red_at": 7, "label": "saturated fat"},
    "diabetes": {"field": "glycemic_load", "amber_at": 15, "red_at": 25, "label": "glycemic load"},
    "pcos": {"field": "glycemic_load", "amber_at": 12, "red_at": 22, "label": "glycemic load"},
}

WARNING_TEMPLATES = {
    "en": {
        "sodium": "High sodium ({value}mg) — go easy today if you're managing blood pressure.",
        "potassium": "High potassium ({value}mg) — check your daily limits if you're managing kidney health.",
        "saturated fat": "Elevated saturated fat ({value}g) — watch total daily intake to protect your lipids.",
        "glycemic load": "Higher glycemic load (~{value}) — pair with protein or fiber to soften the impact.",
        "default_green": "No major concerns flagged for your active condition profile."
    },
    "de": {
        "sodium": "Hoher Natriumgehalt ({value}mg) — vorsichtig bei Bluthochdruck.",
        "potassium": "Hoher Kaliumgehalt ({value}mg) — Achten Sie auf Ihre Tagesgrenzen bei Nierenerkrankungen.",
        "saturated fat": "Erhöhte gesättigte Fettsäuren ({value}g) — auf Cholesterinwerte achten.",
        "glycemic load": "Höhere glykämische Last (~{value}) — mit Protein oder Ballaststoffen kombinieren.",
        "default_green": "Keine Bedenken für Ihr aktives Gesundheitsprofil festgestellt."
    },
    "fr": {
        "sodium": "Teneur élevée en sodium ({value}mg) — modérez votre consommation si vous surveillez votre tension.",
        "potassium": "Teneur élevée en potassium ({value}mg) — vérifiez vos limites si vous surveillez vos reins.",
        "saturated fat": "Acides gras saturés élevés ({value}g) — surveillez votre apport quotidien.",
        "glycemic load": "Charge glycémique élevée (~{value}) — associez avec des protéines ou des fibres.",
        "default_green": "Aucun problème majeur signalé pour votre profil de santé actif."
    }
}


def evaluate_conditions(raw: dict, conditions: list[str], lang: str = "en") -> tuple[str, str]:
    worst_severity = "green"
    worst_message = None
    severity_rank = {"green": 0, "amber": 1, "red": 2}
    lang_templates = WARNING_TEMPLATES.get(lang, WARNING_TEMPLATES["en"])

    for cond in conditions:
        cond_key = cond.strip().lower()
        rule = THRESHOLDS.get(cond_key)
        if not rule:
            continue

        value = raw.get(rule["field"], 0)
        if value >= rule["red_at"]:
            severity = "red"
        elif value >= rule["amber_at"]:
            severity = "amber"
        else:
            severity = "green"

        if severity_rank[severity] > severity_rank[worst_severity]:
            worst_severity = severity
            template = lang_templates[rule["label"]]
            worst_message = template.format(value=value)

    if worst_message is None:
        worst_message = lang_templates["default_green"]

    return worst_severity, worst_message


@app.get("/")
def read_root():
    return {"status": "MealSignal API is live"}


@app.post("/api/v1/analyze", response_model=AnalysisResponse, status_code=status.HTTP_200_OK)
async def analyze_food(payload: AnalysisRequest):
    food = payload.food_name.strip() if payload.food_name else "Scanned Food Item"
    user_conditions = ", ".join(payload.conditions) if payload.conditions else "None"
    target_language = LANGUAGE_MAPPING.get(payload.language, "English")

    prompt = f"""
    You are a food identification and nutrition estimation assistant.

    Food Hint/Name: "{food}"
    Mode: {payload.mode}
    Target Language for ALL text fields: {target_language}

    INSTRUCTIONS:
    1. If an image is provided, identify the exact food item/dish name from the image.
    2. Estimate total meal nutrients: kcal, protein_g, carbs_g, fat_g, sodium_mg,
       potassium_mg, phosphorus_mg, saturated_fat_g, glycemic_load.
    3. Update `food_name` accurately (e.g., "Pepper Sauce (Shito)").
    4. Provide `portion_estimate` (e.g., "1 portion (~300g)").
    5. Provide a healthier alternative recipe (`recipe_title`, `ingredients`, `steps`)
       that is naturally lower in sodium/sugar/saturated fat than the scanned item —
       do NOT include added salt or sugar in the alternative recipe's ingredients.
    6. Do NOT evaluate health risk, do NOT mention any medical condition, and do NOT
       write any warning or verdict — only return the raw fields listed above.
    7. All text output MUST be in {target_language}.
    """

    contents = [prompt]
    if payload.image_data:
        try:
            raw_base64 = payload.image_data
            if "," in raw_base64:
                raw_base64 = raw_base64.split(",")[1]
            image_bytes = base64.b64decode(raw_base64)
            image_part = types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg")
            contents.append(image_part)
        except Exception as img_err:
            print(f"Failed to process image attachment: {img_err}")

    model_candidates = ["gemini-flash-latest", "gemini-2.0-flash-lite", "gemini-2.0-flash"]
    last_error = None

    for model_name in model_candidates:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=contents,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=RawAnalysis,
                    temperature=0.2,
                ),
            )
            raw_data = json.loads(response.text)

            verdict, warning = evaluate_conditions(raw_data, payload.conditions, payload.language)

            final_response = {
                "food_name": raw_data["food_name"],
                "portion_estimate": raw_data["portion_estimate"],
                "kcal": raw_data["kcal"],
                "protein_g": raw_data["protein_g"],
                "carbs_g": raw_data["carbs_g"],
                "fat_g": raw_data["fat_g"],
                "saturated_fat_g": raw_data["saturated_fat_g"],
                "sodium_mg": raw_data["sodium_mg"],
                "potassium_mg": raw_data["potassium_mg"],
                "glycemic_load": raw_data["glycemic_load"],
                "verdict": verdict,
                "warning": warning,
                "recipe_title": raw_data["recipe_title"],
                "recipe_details": raw_data["recipe_details"],
            }
            return final_response

        except Exception as e:
            print(f"Attempt with model '{model_name}' failed: {e}")
            last_error = e

    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=f"AI Analysis failed across all model attempts: {str(last_error)}"
    )


@app.post("/api/v1/analyze/portion-feedback")
async def portion_feedback(payload: PortionFeedbackRequest):
    print(f"Portion feedback received for '{payload.foodName}': {payload.feedback}")
    return {"status": "ok", "message": "Feedback recorded"}


@app.post("/api/v1/webhook")
async def stripe_webhook(request: Request, stripe_signature: str = Header(None)):
    payload = await request.body()

    try:
        if stripe is None and WEBHOOK_SECRET:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Stripe integration is unavailable",
            )
        if WEBHOOK_SECRET:
            event = stripe.Webhook.construct_event(
                payload, stripe_signature, WEBHOOK_SECRET
            )
        else:
            data = json.loads(payload)
            event = data
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Webhook Error: {str(e)}"
        )
    except stripe.error.SignatureVerificationError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Webhook Error: {str(e)}"
        )

    if event.get("type") == "checkout.session.completed":
        session = event["data"]["object"]
        customer_email = session.get("customer_details", {}).get("email")
        print(f"🎉 Payment successful for user: {customer_email}")

    return {"status": "success"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)