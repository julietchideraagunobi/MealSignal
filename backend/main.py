import os
import json
import time
import base64
from pathlib import Path
from typing import List, Optional, Literal
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from google import genai
from google.genai import types

env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=env_path)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise ValueError("GEMINI_API_KEY is missing from backend/.env")
client = genai.Client(api_key=GEMINI_API_KEY)


LANGUAGE_MAPPING = {"en": "English", "de": "German", "fr": "French"}

app = FastAPI(title="MealSignal Backend API", version="1.0.1")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalysisRequest(BaseModel):
    device_id: Optional[str] = "unknown_device"
    is_pro: Optional[bool] = False
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

class ChatMessage(BaseModel):
    sender: str
    text: str


class AICoachRequest(BaseModel):
    prompt: str
    history: List[ChatMessage] = Field(default=[])
    userContext: Optional[dict] = Field(default={})


@app.post("/api/v1/ai-coach")
async def ai_coach(payload: AICoachRequest):
    if not payload.prompt.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Prompt cannot be empty"
        )

    user_name = payload.userContext.get("name", "Friend") if payload.userContext else "Friend"
    user_goals = payload.userContext.get("goals", "Health & nutrition tracking") if payload.userContext else "General wellness"

    system_instruction = f"""You are MealSignal AI Coach, a supportive, knowledgeable, and empathetic nutrition assistant.
User Name: {user_name}
User Goals: {user_goals}

Guidelines:
- Provide encouraging, practical nutrition and meal planning advice.
- Keep answers concise, clear, and scannable (1-3 short paragraphs or bullet points).
- If giving recommendations, emphasize balanced whole foods and healthy habits.
"""

    # Build conversation context from previous turns
    conversation_text = ""
    for msg in payload.history[-6:]:
        role_label = "User" if msg.sender == "user" else "Coach"
        conversation_text += f"{role_label}: {msg.text}\n"

    final_prompt = f"{conversation_text}User: {payload.prompt}\nCoach:"

    model_candidates = [ "gemini-3.5-flash",]
    last_error = None

    for model_name in model_candidates:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=final_prompt,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    temperature=0.7,
                    max_output_tokens=700,
                )
            )
            return {"reply": response.text.strip()}
        except Exception as e:
            print(f"Coach call failed with model '{model_name}': {e}")
            last_error = e

    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=f"AI Coach service failed across all model attempts: {str(last_error)}"
    )

THRESHOLDS = {
    "hypertension": {"field": "sodium_mg", "amber_at": 300, "red_at": 500, "label": "sodium"},
    "kidney disease": {"field": "potassium_mg", "amber_at": 300, "red_at": 500, "label": "potassium"},
    "high cholesterol": {"field": "saturated_fat_g", "amber_at": 4, "red_at": 7, "label": "saturated fat"},
    "diabetes": {"field": "glycemic_load", "amber_at": 15, "red_at": 25, "label": "glycemic load"},
    "pcos": {"field": "glycemic_load", "amber_at": 12, "red_at": 22, "label": "glycemic load"},
}

WARNING_TEMPLATES = {
    "en": {
        "sodium": "Elevated sodium ({value}mg) — balance with plenty of water and potassium-rich foods.",
        "potassium": "Potassium estimate: {value}mg.",
        "saturated fat": "Higher saturated fat ({value}g) — consider pairing with lean sides.",
        "glycemic load": "Higher glycemic impact (~{value}) — pair with healthy fats or protein to steady absorption.",
        "default_green": "Nutritional breakdown calculated successfully."
    },
    "de": {
        "sodium": "Erhöhter Natriumgehalt ({value}mg) — trinken Sie ausreichend Wasser.",
        "potassium": "Kaliumschätzung: {value}mg.",
        "saturated fat": "Höhere gesättigte Fettsäuren ({value}g).",
        "glycemic load": "Höhere glykämische Last (~{value}) — mit Protein oder gesunden Fetten kombinieren.",
        "default_green": "Nährwertanalyse erfolgreich berechnet."
    },
    "fr": {
        "sodium": "Teneur en sodium ({value}mg) — veillez à bien vous hydrater.",
        "potassium": "Estimation du potassium: {value}mg.",
        "saturated fat": "Acides gras saturés ({value}g).",
        "glycemic load": "Impact glycémique plus élevé (~{value}) — associez avec des protéines.",
        "default_green": "Analyse nutritionnelle calculée avec succès."
    }
}

# Primary model
PRIMARY_MODEL = ["gemini-3.5-flash",]



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

from datetime import date
from collections import defaultdict

scan_tracker = defaultdict(lambda: {"count": 0, "date": str(date.today())})

@app.post("/api/v1/analyze", response_model=AnalysisResponse, status_code=status.HTTP_200_OK)
async def analyze_food(payload: AnalysisRequest):
    t_start = time.time()

    # 1. Image decoding time
    t0 = time.time()
    contents = []
    if payload.image_data:
        # Image conversion/cleanup logic
        contents.append(...)
    if payload.food_name:
        contents.append(payload.food_name)
    t_image = time.time()
    print(f"⏱️ Image prep took: {t_image - t0:.2f}s")

    # 2. Gemini API request time
    t1 = time.time()
    response = client.models.generate_content(...)
    t_gemini = time.time()
    print(f"⏱️ Gemini API call took: {t_gemini - t1:.2f}s")

    # 3. JSON parsing / validation time
    t2 = time.time()
    raw_data = json.loads(response.text)
    t_json = time.time()
    print(f"⏱️ JSON parsing took: {t_json - t2:.2f}s")

    print(f"🚀 TOTAL Backend execution: {time.time() - t_start:.2f}s")
    return raw_data


# Trial Rate Limit Check
    today_str = str(date.today())
    record = scan_tracker[payload.device_id]
    if record["date"] != today_str:
        record["count"] = 0
        record["date"] = today_str

    #if not payload.is_pro and record["count"] >= 3:
      #  #raise HTTPException(
            #status_code=status.HTTP_403_FORBIDDEN,
            #detail="Daily trial scan limit reached. Please upgrade to Pro."
        #)

    record["count"] += 1
    
    food = payload.food_name.strip() if payload.food_name else "Scanned Food Item"
    user_conditions = ", ".join(payload.conditions) if payload.conditions else "None"
    target_language = LANGUAGE_MAPPING.get(payload.language, "English")
    

    prompt = f"""
    You are an expert AI Food & Nutrition Analyzer.

    Food Hint/Name: "{food}"
    Mode: {payload.mode}
    User Dietary Focus, Preferences & Conditions: {user_conditions}
    Target Language for ALL text fields: {target_language}

    INSTRUCTIONS:
    1. If an image is provided, accurately identify the food/dish name.
    2. Estimate total meal nutrients: kcal, protein_g, carbs_g, fat_g, sodium_mg,
       potassium_mg, phosphorus_mg, saturated_fat_g, glycemic_load.
    3. Update `food_name` accurately (e.g., "Grilled Chicken Bowl").
    4. Provide `portion_estimate` (e.g., "1 bowl (~350g)").
    5. Provide a balanced, nutrient-dense recipe suggestion (`recipe_title`, `ingredients`, `steps`)
       tailored to the scanned meal and aligning with any user dietary focus or conditions.
       keep `ingredients` to max 3-4 key items and `steps` to exactly 4 short, direct sentences.
       """"""
    6. All text output MUST be in {target_language}.
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

    model_candidates = ["gemini-3.5-flash"] 
    last_error = None

    for model_name in model_candidates:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=contents,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=RawAnalysis,
                    temperature=0.1,
                    max_output_tokens=500,
                    thinking_config=types.ThinkingConfig(thinking_budget=0),  # ⚡ Disables thinking latency
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

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)